/**
 * Download HTTP Routes
 *
 * Provides Express routes for the file download feature:
 * - GET /download/:token       Streams the file to the browser
 * - GET /download/:token/info  Returns session metadata as JSON
 */

import { type Request, type Response } from 'express';
import type express from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { logger } from '../utils/logger.ts';
import type { DownloadManager } from './download-manager.ts';

/**
 * Extracts a route param as a single string (Express 5 params may be string | string[]).
 */
function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Registers download routes on the Express app.
 */
export function setupDownloadRoutes(
  app: express.Application,
  downloadManager: DownloadManager,
): void {
  // ── GET /download/:token — stream the file ─────────────────────────────────
  app.get('/download/:token', (req: Request, res: Response) => {
    const token = paramString(req.params.token);
    const session = downloadManager.getSession(token);

    if (!session) {
      res.status(404).render('download-error', {
        pageTitle: 'Link Not Found',
        errorTitle: 'Link Not Found',
        errorMessage: 'This download link is invalid or has been removed.',
      });
      return;
    }

    if (session.status === 'expired') {
      res.status(410).render('download-error', {
        pageTitle: 'Link Expired',
        errorTitle: 'Link Expired',
        errorMessage: 'This download link has expired. Please request a new download link.',
      });
      return;
    }

    if (session.status === 'downloaded') {
      res.status(410).render('download-error', {
        pageTitle: 'Already Downloaded',
        errorTitle: 'Already Downloaded',
        errorMessage: 'This file has already been downloaded. The link is now closed.',
      });
      return;
    }

    if (session.status === 'closed') {
      res.status(410).render('download-error', {
        pageTitle: 'Link Closed',
        errorTitle: 'Link Closed',
        errorMessage: 'This download link has been revoked. Please request a new one.',
      });
      return;
    }

    // Verify the file still exists
    if (!existsSync(session.absolutePath)) {
      logger.error({ token, path: session.absolutePath }, 'Download file no longer exists');
      res.status(404).render('download-error', {
        pageTitle: 'File Not Found',
        errorTitle: 'File Not Found',
        errorMessage: 'The file is no longer available. It may have been moved or deleted.',
      });
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
        res.status(500).render('download-error', {
          pageTitle: 'Download Error',
          errorTitle: 'Download Error',
          errorMessage: 'An error occurred while streaming the file. Please try again.',
        });
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
