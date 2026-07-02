/**
 * Download HTTP Routes
 *
 * Provides Express routes for the file download feature:
 * - GET /download/:token       Streams the file to the browser
 * - GET /download/:token/info  Returns session metadata as JSON
 */

import { type Request, type Response } from 'express';
import type express from 'express';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { logger } from '../utils/logger.ts';
import { paramString } from '../utils/route-helpers.ts';
import { renderErrorPage } from '../ui/error-page.ts';
import type { DownloadManager } from './download-manager.ts';

/**
 * Registers download routes on the Express app.
 */
export function setupDownloadRoutes(
  app: express.Application,
  downloadManager: DownloadManager,
): void {
  function sendError(res: Response, status: number, title: string, message: string): void {
    res.status(status).type('html').send(renderErrorPage(title, message));
  }

  // ── GET /download/:token — stream the file ─────────────────────────────────
  app.get('/download/:token', async (req: Request, res: Response) => {
    const token = paramString(req.params.token);
    const session = downloadManager.getSession(token);

    if (!session) {
      sendError(res, 404, 'Link Not Found', 'This download link is invalid or has been removed.');
      return;
    }

    if (session.status === 'expired') {
      sendError(res, 410, 'Link Expired', 'This download link has expired. Please request a new download link.');
      return;
    }

    if (session.status === 'downloaded') {
      sendError(res, 410, 'Already Downloaded', 'This file has already been downloaded. The link is now closed.');
      return;
    }

    if (session.status === 'closed') {
      sendError(res, 410, 'Link Closed', 'This download link has been revoked. Please request a new one.');
      return;
    }

    // Verify the file still exists
    try {
      await fs.access(session.absolutePath);
    } catch {
      logger.error({ token, path: session.absolutePath }, 'Download file no longer exists');
      sendError(res, 404, 'File Not Found', 'The file is no longer available. It may have been moved or deleted.');
      return;
    }

    // Set headers for file download
    res.setHeader('Content-Type', session.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(session.filename)}"`);
    res.setHeader('Content-Length', session.fileSize);
    res.setHeader('Cache-Control', 'no-store');

    const fileStream = createReadStream(session.absolutePath);

    fileStream.on('error', (error) => {
      logger.error({ error, token, path: session.absolutePath }, 'Error streaming download file');
      if (!res.headersSent) {
        sendError(res, 500, 'Download Error', 'An error occurred while streaming the file. Please try again.');
      }
    });

    fileStream.on('end', () => {
      // Mark session as downloaded
      downloadManager.completeSession(token);
    });

    fileStream.pipe(res);
  });

  // ── GET /download/:token/info — session metadata as JSON ───────────────────
  app.get('/download/:token/info', (req: Request, res: Response) => {
    const token = paramString(req.params.token);
    const session = downloadManager.getSession(token);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({
      status: session.status,
      filename: session.filename,
      file_size: session.fileSize,
      mime_type: session.mimeType,
      workspace: session.workspace,
      file_path: session.relativePath,
    });
  });
}
