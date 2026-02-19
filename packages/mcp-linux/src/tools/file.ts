/**
 * Workspace file tool registration for MCP server
 *
 * Registers the read_workspace_file tool that returns file contents
 * as the appropriate MCP content type (text, image, audio, or
 * auto-creates a download link for large/binary files).
 */

import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserManager } from '../user-manager.ts';
import type { DownloadManager } from '../download/download-manager.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import { ReadWorkspaceFileSchema } from '../schemas/file.schema.ts';
import { resolveSafePath, ensureFileExists } from '../utils/fs-helper.ts';

/** Maximum text file size to inline (1 MB) */
const MAX_TEXT_SIZE = 1 * 1024 * 1024;
/** Maximum binary file size to inline as base64 (10 MB) */
const MAX_BINARY_SIZE = 10 * 1024 * 1024;

/** Extensions treated as text (readable inline) */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.csv', '.tsv', '.json', '.jsonl', '.ndjson',
  '.xml', '.html', '.htm', '.css', '.md', '.markdown',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.env', '.properties', '.gitignore', '.dockerignore',
  '.py', '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.gql',
  '.rs', '.go', '.java', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.php', '.pl', '.pm', '.lua', '.r', '.R',
  '.swift', '.m', '.mm',
  '.makefile', '.cmake', '.dockerfile',
  '.log', '.diff', '.patch',
  '.svg', // SVG is text-based
]);

/** Extensions that map to image MIME types */
const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

/** Extensions that map to audio MIME types */
const AUDIO_EXTENSIONS: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
};

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string };

/**
 * Registers the read_workspace_file tool on the MCP server.
 */
export function registerFileTools(
  server: McpServer,
  userManager: UserManager,
  downloadManager: DownloadManager,
): void {
  server.registerTool(
    'read_workspace_file',
    {
      description:
        'Read a file from a workspace and return its contents. ' +
        'Text files are returned inline. Images and audio are returned as base64-encoded content. ' +
        'Large or binary files automatically get a download link instead. ' +
        'Supported text: .txt, .csv, .json, .md, .py, .js, .ts, etc. ' +
        'Supported images: .png, .jpg, .gif, .webp. ' +
        'Supported audio: .wav, .mp3, .ogg, .flac.',
      inputSchema: ReadWorkspaceFileSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const mapping = await userManager.ensureUser(email);

        const absolutePath = resolveSafePath(mapping.username, args.workspace, args.file_path);
        ensureFileExists(absolutePath);

        const stat = statSync(absolutePath);
        const ext = extname(absolutePath).toLowerCase();
        const fileSize = stat.size;

        // ── Text files ─────────────────────────────────────────────
        if (TEXT_EXTENSIONS.has(ext) || ext === '') {
          if (fileSize > MAX_TEXT_SIZE) {
            // Too large: create download link
            return await createDownloadFallback(
              email, mapping.username, args.workspace, args.file_path,
              fileSize, downloadManager,
              `Text file is too large to inline (${formatSize(fileSize)}, limit ${formatSize(MAX_TEXT_SIZE)}). A download link has been created.`,
            );
          }

          const content = readFileSync(absolutePath, 'utf-8');
          return {
            content: [{ type: 'text' as const, text: content }],
          };
        }

        // ── Image files ────────────────────────────────────────────
        if (ext in IMAGE_EXTENSIONS) {
          if (fileSize > MAX_BINARY_SIZE) {
            return await createDownloadFallback(
              email, mapping.username, args.workspace, args.file_path,
              fileSize, downloadManager,
              `Image file is too large to inline (${formatSize(fileSize)}, limit ${formatSize(MAX_BINARY_SIZE)}). A download link has been created.`,
            );
          }

          const data = readFileSync(absolutePath).toString('base64');
          return {
            content: [{ type: 'image' as const, data, mimeType: IMAGE_EXTENSIONS[ext] }],
          };
        }

        // ── Audio files ────────────────────────────────────────────
        if (ext in AUDIO_EXTENSIONS) {
          if (fileSize > MAX_BINARY_SIZE) {
            return await createDownloadFallback(
              email, mapping.username, args.workspace, args.file_path,
              fileSize, downloadManager,
              `Audio file is too large to inline (${formatSize(fileSize)}, limit ${formatSize(MAX_BINARY_SIZE)}). A download link has been created.`,
            );
          }

          const data = readFileSync(absolutePath).toString('base64');
          return {
            content: [{ type: 'audio' as const, data, mimeType: AUDIO_EXTENSIONS[ext] }],
          };
        }

        // ── Unknown / binary files ─────────────────────────────────
        return await createDownloadFallback(
          email, mapping.username, args.workspace, args.file_path,
          fileSize, downloadManager,
          `Binary file (${ext || 'unknown type'}, ${formatSize(fileSize)}). A download link has been created.`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createDownloadFallback(
  email: string,
  username: string,
  workspace: string,
  filePath: string,
  fileSize: number,
  downloadManager: DownloadManager,
  reason: string,
): Promise<{ content: ContentBlock[] }> {
  const { session } = downloadManager.createLink(email, username, workspace, filePath);

  return {
    content: [
      {
        type: 'text',
        text: `${reason}\n\nDownload URL: ${session.download_url}\nFilename: ${session.filename}\nSize: ${formatSize(fileSize)}\nExpires: ${session.expires_at}`,
      },
    ],
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
