/**
 * Code index orchestrator: scan, filter, chunk, embed, store, search.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync, type Dirent } from 'node:fs';
import { join, relative, extname } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { CodeBlock, SearchResult, IndexState, IndexStatus } from './types.ts';
import {
  INDEX_DIR,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_FILENAMES,
  DIRS_TO_IGNORE,
  FILES_TO_IGNORE,
  MAX_FILE_SIZE_BYTES,
  EMBEDDING_BATCH_SIZE,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_MIN_SCORE,
} from './constants.ts';
import { createFileHash, chunkFile } from './chunking-service.ts';
import { embedBatch, getEmbeddingDimensions, isEmbeddingConfigured } from './embedding-service.ts';
import { LanceDBStore } from './lancedb-store.ts';

const FILE_HASHES_FILENAME = 'file_hashes.json';

/**
 * Recursively list files under dir, skipping ignored dirs and applying extension filter.
 * Returns relative paths from workspaceRoot.
 */
function addNestedGitignore(
  dir: string,
  workspaceRoot: string,
  ignoreInstance: Ignore,
): void {
  if (dir === workspaceRoot) return;
  const gitignorePath = join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) return;
  try {
    const content = readFileSync(gitignorePath, 'utf-8');
    const relDir = relative(workspaceRoot, dir).replace(/\\/g, '/');
    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('!')) {
        const pattern = line.slice(1);
        ignoreInstance.add(`!${relDir}/${pattern.startsWith('/') ? pattern.slice(1) : pattern}`);
      } else if (line.startsWith('/')) {
        ignoreInstance.add(`${relDir}${line}`);
      } else {
        ignoreInstance.add(`${relDir}/${line}`);
      }
    }
  } catch {
    // ignore read errors
  }
}

function listFilesRecursive(
  dir: string,
  workspaceRoot: string,
  ignoreInstance: Ignore,
): string[] {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
  } catch {
    return results;
  }

  addNestedGitignore(dir, workspaceRoot, ignoreInstance);

  for (const entry of entries) {
    const name = entry.name as unknown as string;
    const fullPath = join(dir, name);
    const relPath = relative(workspaceRoot, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (DIRS_TO_IGNORE.has(name)) continue;
      if (ignoreInstance.ignores(relPath + '/')) continue;
      results.push(...listFilesRecursive(fullPath, workspaceRoot, ignoreInstance));
    } else if (entry.isFile()) {
      if (FILES_TO_IGNORE.has(name)) continue;
      const ext = extname(name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext) && !SUPPORTED_FILENAMES.has(name)) continue;
      if (ignoreInstance.ignores(relPath)) continue;
      results.push(relPath);
    }
  }
  return results;
}

function loadIgnorePatterns(workspacePath: string): Ignore {
  const ig = ignore();
  const gitignorePath = join(workspacePath, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      const content = readFileSync(gitignorePath, 'utf-8');
      ig.add(content);
      ig.add('.gitignore');
    } catch {
      // ignore read errors
    }
  }
  const codeIndexIgnorePath = join(workspacePath, INDEX_DIR, 'code-index.ignore');
  if (existsSync(codeIndexIgnorePath)) {
    try {
      ig.add(readFileSync(codeIndexIgnorePath, 'utf-8'));
    } catch {
      // ignore
    }
  }
  return ig;
}

function loadFileHashes(workspacePath: string): Record<string, string> {
  const path = join(workspacePath, INDEX_DIR, FILE_HASHES_FILENAME);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as Record<string, string>;
    return typeof data === 'object' && data !== null ? data : {};
  } catch {
    return {};
  }
}

function saveFileHashes(workspacePath: string, hashes: Record<string, string>): void {
  const dir = join(workspacePath, INDEX_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FILE_HASHES_FILENAME), JSON.stringify(hashes, null, 0), 'utf-8');
}

const statusByWorkspace = new Map<string, { status: IndexStatus; message: string; files_processed: number; files_total: number }>();

function setStatus(
  workspacePath: string,
  status: IndexStatus,
  message: string,
  files_processed: number,
  files_total: number,
): void {
  statusByWorkspace.set(workspacePath, { status, message, files_processed, files_total });
}

export function getIndexStatus(workspacePath: string): IndexState {
  const cached = statusByWorkspace.get(workspacePath);
  if (cached) {
    return {
      status: cached.status,
      message: cached.message,
      files_processed: cached.files_processed,
      files_total: cached.files_total,
    };
  }
  return {
    status: 'standby',
    message: '',
    files_processed: 0,
    files_total: 0,
  };
}

export function isCodeIndexEnabled(): boolean {
  if (process.env.CODE_INDEX_ENABLED === 'false') return false;
  return isEmbeddingConfigured();
}

/**
 * Full index of a workspace. Call from worker.
 */
export async function indexWorkspace(workspacePath: string, force = false): Promise<IndexState> {
  if (!isCodeIndexEnabled()) {
    setStatus(workspacePath, 'standby', 'Code index is disabled', 0, 0);
    return getIndexStatus(workspacePath);
  }

  const vectorSize = getEmbeddingDimensions();
  const store = new LanceDBStore({ workspacePath, vectorSize });

  try {
    setStatus(workspacePath, 'indexing', 'Listing files...', 0, 0);
    const ignoreInstance = loadIgnorePatterns(workspacePath);
    const filePaths = listFilesRecursive(workspacePath, workspacePath, ignoreInstance);
    const total = filePaths.length;
    setStatus(workspacePath, 'indexing', 'Initializing store...', 0, total);

    await store.initialize();
    if (!force) {
      await store.markIndexingIncomplete();
    }

    const prevHashes = force ? {} : loadFileHashes(workspacePath);
    const currentHashes: Record<string, string> = {};
    const toIndex: string[] = [];
    const toDelete: string[] = [];
    const contentCache = new Map<string, string>();

    for (const relPath of filePaths) {
      const absPath = join(workspacePath, relPath);
      let stat;
      try {
        stat = statSync(absPath);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE_BYTES) continue;
      const content = readFileSync(absPath, 'utf-8');
      const hash = createFileHash(content);
      currentHashes[relPath] = hash;
      if (prevHashes[relPath] !== hash) {
        toIndex.push(relPath);
        contentCache.set(relPath, content);
      }
    }
    for (const relPath of Object.keys(prevHashes)) {
      if (!currentHashes[relPath]) toDelete.push(relPath);
    }

    if (toDelete.length > 0) {
      await store.deleteByFilePaths(toDelete);
    }

    let processed = 0;
    const batchSize = EMBEDDING_BATCH_SIZE;
    for (let i = 0; i < toIndex.length; i += batchSize) {
      const batchPaths = toIndex.slice(i, i + batchSize);
      const allBlocks: CodeBlock[] = [];
      for (const relPath of batchPaths) {
        const cached = contentCache.get(relPath);
        const content = cached ?? readFileSync(join(workspacePath, relPath), 'utf-8');
        if (cached) contentCache.delete(relPath);
        const fileHash = currentHashes[relPath]!;
        const blocks = chunkFile(relPath, content, fileHash);
        allBlocks.push(...blocks);
      }
      if (allBlocks.length > 0) {
        const texts = allBlocks.map((b) => b.content);
        const vectors = await embedBatch(texts);
        await store.upsert(allBlocks, vectors);
      }
      processed += batchPaths.length;
      setStatus(workspacePath, 'indexing', `Indexed ${processed}/${toIndex.length} files`, processed, total);
    }

    saveFileHashes(workspacePath, currentHashes);
    await store.markIndexingComplete();
    await store.optimize();
    await store.close();
    setStatus(workspacePath, 'indexed', 'Index complete', total, total);
    return getIndexStatus(workspacePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(workspacePath, 'error', message, 0, 0);
    await store.close().catch(() => {});
    return getIndexStatus(workspacePath);
  }
}

/**
 * Semantic search in workspace code index.
 */
export async function searchWorkspace(
  workspacePath: string,
  query: string,
  options?: { pathPrefix?: string; limit?: number; minScore?: number },
): Promise<SearchResult[]> {
  if (!isCodeIndexEnabled()) return [];

  const vectorSize = getEmbeddingDimensions();
  const store = new LanceDBStore({ workspacePath, vectorSize });

  try {
    await store.initialize();
    const data = await store.hasData();
    if (!data) {
      await store.close();
      return [];
    }
    const [queryVector] = await embedBatch([query]);
    const results = await store.search(queryVector, {
      pathPrefix: options?.pathPrefix,
      limit: options?.limit ?? DEFAULT_SEARCH_LIMIT,
      minScore: options?.minScore ?? DEFAULT_MIN_SCORE,
    });
    await store.close();
    return results;
  } catch (err) {
    console.warn('[CodeIndexService] search failed:', (err as Error).message);
    await store.close().catch(() => {});
    return [];
  }
}

/**
 * Whether the workspace has an existing index (with data and marked complete).
 */
export async function hasIndex(workspacePath: string): Promise<boolean> {
  if (!isCodeIndexEnabled()) return false;
  const vectorSize = getEmbeddingDimensions();
  const store = new LanceDBStore({ workspacePath, vectorSize });
  try {
    await store.initialize();
    const complete = await store.isIndexComplete();
    const hasData = await store.hasData();
    await store.close();
    return complete && hasData;
  } catch {
    return false;
  }
}
