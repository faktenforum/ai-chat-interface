/**
 * Workspace file tool registration for MCP server
 *
 * Registers the read_workspace_file tool that returns file contents
 * as the appropriate MCP content type (text, image, audio, or
 * auto-creates a download link for large/binary files).
 */

import fs from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { UserManager } from '../user-manager.ts';
import type { DownloadManager } from '../download/download-manager.ts';
import { resolveEmail, errorResult } from './helpers.ts';
import { ReadWorkspaceFileSchema, ListWorkspaceFilesSchema } from '../schemas/file.schema.ts';
import { resolveSafePath, ensureFileExists, ensureDirExists } from '../utils/fs-helper.ts';

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.venv', 'venv']);

/**
 * Lines returned when the caller asks for no particular range.
 *
 * A whole file used to be inlined up to 1 MB, which is roughly 250k tokens - more than a provider
 * grants per minute, so one read could make the rest of the turn impossible. Paging is the same
 * bargain other coding agents strike: enough to work with, and an explicit way to ask for more.
 */
const DEFAULT_LINE_LIMIT = 1200;

/** Format text with line numbers (1-based) for diffing or discussion. Optionally restrict to line ranges (1-based inclusive). */
function formatTextWithLineNumbers(
  content: string,
  lineRanges?: Array<[number, number]>,
): string {
  const lines = content.split(/\r?\n/);
  if (!lineRanges || lineRanges.length === 0) {
    return lines.map((line, i) => `${i + 1} | ${line}`).join('\n');
  }
  const out: string[] = [];
  for (const [start, end] of lineRanges) {
    const from = Math.max(1, start);
    const to = Math.min(lines.length, end);
    for (let i = from; i <= to; i++) {
      out.push(`${i} | ${lines[i - 1] ?? ''}`);
    }
  }
  return out.join('\n');
}

/** Renders a page of a text file with line numbers, plus a note when more lines exist. */
function formatTextPage(content: string, offset: number, limit: number): string {
  const lines = content.split(/\r?\n/);
  const from = Math.min(Math.max(1, offset), Math.max(1, lines.length));
  const to = Math.min(lines.length, from + limit - 1);

  const body: string[] = [];
  for (let i = from; i <= to; i++) {
    body.push(`${i} | ${lines[i - 1] ?? ''}`);
  }

  if (from === 1 && to === lines.length) {
    return body.join('\n');
  }

  const rest =
    to < lines.length
      ? ` Read on with offset=${to + 1}.`
      : '';
  return (
    `[lines ${from}-${to} of ${lines.length}.${rest}]\n` + body.join('\n')
  );
}

/**
 * Whether a file with an unrecognised extension is really text.
 *
 * The extension list can never be complete - `env.prod.example`, `Dockerfile.tpl`, `.env.secret`
 * and friends all read as unknown, and handing back a download link for them makes the agent fall
 * back to `cat` in the terminal: another round trip, and the output arrives without line numbers.
 * A NUL byte is the same signal `file` and git use to call something binary.
 */
export async function looksLikeText(absolutePath: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(absolutePath, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(8192), 0, 8192, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample.includes(0)) {
      return false;
    }
    /* Control characters other than tab, newline and carriage return point at binary content. */
    let suspicious = 0;
    for (const byte of sample) {
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
        suspicious++;
      }
    }
    return bytesRead === 0 || suspicious / bytesRead < 0.05;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

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
        'Read a file from a workspace and return its contents. Returns content with line numbers for diffing or discussion. Use optional line_ranges to read specific sections only. ' +
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

        const absolutePath = await resolveSafePath(mapping.username, args.workspace, args.file_path);
        await ensureFileExists(absolutePath);

        const stat = await fs.stat(absolutePath);
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

          const rawContent = await fs.readFile(absolutePath, 'utf-8');
          /* Explicit line_ranges are a deliberate request and are honoured as given; everything
           * else is paged so a long file cannot swallow the turn's token budget. */
          const text = args.line_ranges?.length
            ? formatTextWithLineNumbers(rawContent, args.line_ranges)
            : formatTextPage(rawContent, args.offset ?? 1, args.limit ?? DEFAULT_LINE_LIMIT);
          return {
            content: [{ type: 'text' as const, text }],
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

          const data = (await fs.readFile(absolutePath)).toString('base64');
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

          const data = (await fs.readFile(absolutePath)).toString('base64');
          return {
            content: [{ type: 'audio' as const, data, mimeType: AUDIO_EXTENSIONS[ext] }],
          };
        }

        // ── Unknown extension: decide by content ───────────────────
        if (fileSize <= MAX_TEXT_SIZE && (await looksLikeText(absolutePath))) {
          const rawContent = await fs.readFile(absolutePath, 'utf-8');
          const text = args.line_ranges?.length
            ? formatTextWithLineNumbers(rawContent, args.line_ranges)
            : formatTextPage(rawContent, args.offset ?? 1, args.limit ?? DEFAULT_LINE_LIMIT);
          return {
            content: [{ type: 'text' as const, text }],
          };
        }

        // ── Binary files ───────────────────────────────────────────
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

  server.registerTool(
    'list_workspace_files',
    {
      description:
        'List files and directories in a workspace path. Use this to explore directory structure; more effective than running ls in the terminal for a structured file list. ' +
        'Path is relative to workspace root. Set recursive to true for full tree. Skips .git, node_modules, .venv, venv.',
      inputSchema: ListWorkspaceFilesSchema.shape,
    },
    async (args, extra) => {
      try {
        const email = resolveEmail(extra);
        const mapping = await userManager.ensureUser(email);
        const dirPath = args.path || '.';
        const absoluteDir = await resolveSafePath(mapping.username, args.workspace, dirPath);
        await ensureDirExists(absoluteDir);

        const workspaceRoot = join('/home', mapping.username, 'workspaces', args.workspace);
        const entries = await listWorkspaceFiles(absoluteDir, workspaceRoot, args.recursive);
        const text = JSON.stringify(entries, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

async function listWorkspaceFiles(
  dir: string,
  baseDir: string,
  recursive: boolean,
): Promise<Array<{ path: string; type: 'file' | 'dir' }>> {
  const results: Array<{ path: string; type: 'file' | 'dir' }> = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const relPath = relative(baseDir, join(dir, entry.name));
    if (entry.isFile()) {
      results.push({ path: relPath, type: 'file' });
    } else if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue;
      results.push({ path: relPath, type: 'dir' });
      if (recursive) {
        const sub = await listWorkspaceFiles(join(dir, entry.name), baseDir, true);
        results.push(...sub);
      }
    }
  }
  return results;
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
  const { session } = await downloadManager.createLink(email, username, workspace, filePath);

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
