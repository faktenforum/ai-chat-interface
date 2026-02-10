/**
 * MCP Embedded Resources for workspace files
 *
 * Exposes workspace files as navigable MCP resources via a URI template:
 *   workspace://{workspace}/{path}
 *
 * - resources/list: Lists files in a workspace (or subdirectory)
 * - resources/read: Reads a file and returns it as a text or blob resource
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, extname, relative } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logger.ts';
import type { UserManager } from '../user-manager.ts';
import { sessionEmailMap } from '../tools/workspace.ts';

/** Extensions treated as text (return as text resource) */
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
  '.log', '.diff', '.patch', '.svg',
]);

/** MIME type lookup by extension */
const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.md': 'text/markdown',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.py': 'text/x-python',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.sh': 'text/x-shellscript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function guessMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Recursively list files in a directory (up to a depth limit and entry limit).
 */
function listFilesRecursive(
  dir: string,
  baseDir: string,
  maxDepth: number,
  maxEntries: number,
  depth = 0,
): Array<{ relativePath: string; size: number; mimeType: string }> {
  if (depth > maxDepth) return [];

  const results: Array<{ relativePath: string; size: number; mimeType: string }> = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (results.length >= maxEntries) break;

    // Skip hidden files/dirs and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const fullPath = join(dir, entry.name);

    if (entry.isFile()) {
      const stat = statSync(fullPath);
      results.push({
        relativePath: relative(baseDir, fullPath),
        size: stat.size,
        mimeType: guessMimeType(entry.name),
      });
    } else if (entry.isDirectory() && depth < maxDepth) {
      const subResults = listFilesRecursive(fullPath, baseDir, maxDepth, maxEntries - results.length, depth + 1);
      results.push(...subResults);
    }
  }

  return results;
}

/**
 * Registers MCP resource templates for workspace file access.
 */
export function registerWorkspaceResources(
  server: McpServer,
  userManager: UserManager,
): void {
  const template = new ResourceTemplate('workspace://{workspace}/{+path}', {
    list: async (extra) => {
      try {
        const email = resolveEmail(extra);
        const mapping = await userManager.ensureUser(email);
        const workspacesRoot = join('/home', mapping.username, 'workspaces');

        // List files across all workspaces (default first)
        const resources: Array<{
          uri: string;
          name: string;
          mimeType?: string;
          description?: string;
        }> = [];

        let workspaces: string[];
        try {
          workspaces = readdirSync(workspacesRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
        } catch {
          workspaces = [];
        }

        // Sort so 'default' comes first
        workspaces.sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)));

        for (const ws of workspaces) {
          const wsPath = join(workspacesRoot, ws);
          const files = listFilesRecursive(wsPath, wsPath, 3, 200);

          for (const file of files) {
            resources.push({
              uri: `workspace://${ws}/${file.relativePath}`,
              name: `${ws}/${file.relativePath}`,
              mimeType: file.mimeType,
              description: `${file.size} bytes`,
            });
          }
        }

        return { resources };
      } catch (error) {
        logger.error({ error }, 'Failed to list workspace resources');
        return { resources: [] };
      }
    },
    complete: {
      workspace: async (value) => {
        // Autocomplete is limited without email context, return empty
        return [];
      },
      path: async (value) => {
        return [];
      },
    },
  });

  server.registerResource(
    'workspace_file',
    template,
    {
      description: 'Files in user workspaces. URI format: workspace://{workspace}/{path}',
      mimeType: 'application/octet-stream',
    },
    async (uri, variables, extra) => {
      try {
        const email = resolveEmail(extra);
        const mapping = await userManager.ensureUser(email);

        const workspace = variables.workspace as string;
        const filePath = variables.path as string;

        if (!workspace || !filePath) {
          throw new Error('workspace and path are required in the resource URI');
        }

        const workspaceRoot = join('/home', mapping.username, 'workspaces', workspace);
        const absolutePath = resolve(workspaceRoot, filePath);

        // Security: ensure path is within workspace
        if (!absolutePath.startsWith(workspaceRoot + '/') && absolutePath !== workspaceRoot) {
          throw new Error('Path traversal denied');
        }

        if (!existsSync(absolutePath)) {
          throw new Error(`File not found: ${filePath} in workspace "${workspace}"`);
        }

        const stat = statSync(absolutePath);
        if (!stat.isFile()) {
          throw new Error(`Not a file: ${filePath}`);
        }

        const ext = extname(absolutePath).toLowerCase();
        const mimeType = guessMimeType(absolutePath);

        if (TEXT_EXTENSIONS.has(ext) || ext === '') {
          // Return as text resource
          const content = readFileSync(absolutePath, 'utf-8');
          return {
            contents: [
              {
                uri: uri.href,
                mimeType,
                text: content,
              },
            ],
          };
        }

        // Return as blob resource (base64)
        const data = readFileSync(absolutePath).toString('base64');
        return {
          contents: [
            {
              uri: uri.href,
              mimeType,
              blob: data,
            },
          ],
        };
      } catch (error) {
        logger.error({ error }, 'Failed to read workspace resource');
        const message = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${message}`,
            },
          ],
        };
      }
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveEmail(extra: unknown): string {
  const ctx = extra as Record<string, unknown> | undefined;

  if (ctx?.sessionId && typeof ctx.sessionId === 'string') {
    const email = sessionEmailMap.get(ctx.sessionId);
    if (email) return email;
  }

  if (ctx && typeof (ctx as Record<string, unknown>).email === 'string') {
    return (ctx as Record<string, unknown>).email as string;
  }

  throw new Error('User email not found in request context. Ensure X-User-Email header is sent.');
}
