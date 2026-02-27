/**
 * Serves the SPA index.html without using sendFile (avoids issues with bind mounts).
 * Uses async readFile so the event loop is not blocked.
 */

import { type Response } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logger.ts';

const BUILD_HINT =
  'From repo root run: cd packages/mcp-linux && npm run build:frontend then restart the container.';

/**
 * Sends the SPA index from the given directory. Non-blocking (uses fs.promises.readFile).
 * On missing file: 503 with build hint. On read error: 500.
 */
export async function serveSpaIndex(
  spaDir: string,
  res: Response,
  logContext = 'SPA index',
): Promise<void> {
  const indexPath = join(spaDir, 'index.html');
  try {
    const html = await readFile(indexPath, 'utf-8');
    res.type('html').send(html);
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT') {
      logger.error({ spaDir, indexPath }, `${logContext} not found (run: cd packages/mcp-linux && npm run build:frontend)`);
      if (!res.headersSent) {
        res.status(503).setHeader('Content-Type', 'text/plain').send(`SPA not built. ${BUILD_HINT}`);
      }
      return;
    }
    logger.error({ err, spaDir, indexPath }, `Failed to send ${logContext}`);
    if (!res.headersSent) res.status(500).send('SPA not available');
  }
}
