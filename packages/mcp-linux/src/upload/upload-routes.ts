/**
 * Upload HTTP Routes
 *
 * Provides Express routes for the file upload feature:
 * - GET  /upload/:token        Serves the upload HTML page (Pug template)
 * - POST /upload/:token        Accepts the multipart file upload
 * - GET  /upload/:token/status Returns session status as JSON
 */

import { type Request, type Response } from 'express';
import type express from 'express';
import { createWriteStream, existsSync, mkdirSync, chownSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import Busboy from 'busboy';
import { logger } from '../utils/logger.ts';
import type { UploadManager } from './upload-manager.ts';
import type { UserManager } from '../user-manager.ts';

/**
 * Sanitise a filename: strip path traversal, control chars, limit length, keep extension.
 */
function sanitiseFilename(raw: string): string {
  // Take only the basename (strip directory components)
  let name = basename(raw);

  // Remove control characters and path separators
  name = name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_');

  // Collapse multiple underscores / dots
  name = name.replace(/_{2,}/g, '_').replace(/\.{2,}/g, '.');

  // Trim leading/trailing dots and whitespace
  name = name.replace(/^[\s.]+|[\s.]+$/g, '');

  // Limit total length (preserve extension)
  const MAX_LEN = 200;
  if (name.length > MAX_LEN) {
    const ext = extname(name);
    const stem = name.slice(0, MAX_LEN - ext.length);
    name = stem + ext;
  }

  return name || 'upload';
}

/**
 * Resolves a non-colliding file path. Appends -1, -2, etc. if needed.
 */
function resolveFilePath(dir: string, filename: string): string {
  let target = join(dir, filename);
  if (!existsSync(target)) return target;

  const ext = extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let counter = 1;
  while (existsSync(target)) {
    target = join(dir, `${stem}-${counter}${ext}`);
    counter++;
  }
  return target;
}

/**
 * Extracts a route param as a single string (Express 5 params may be string | string[]).
 */
function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Registers upload routes on the Express app.
 */
export function setupUploadRoutes(
  app: express.Application,
  uploadManager: UploadManager,
  userManager: UserManager,
): void {
  // ── GET /upload/:token — serve the upload page ─────────────────────────────
  app.get('/upload/:token', (req: Request, res: Response) => {
    const token = paramString(req.params.token);
    const session = uploadManager.getSession(token);

    if (!session) {
      res.status(404).render('upload-error', {
        pageTitle: 'Session Not Found',
        errorTitle: 'Session Not Found',
        errorMessage: 'This upload link is invalid or has been removed.',
      });
      return;
    }

    if (session.status === 'expired') {
      res.status(410).render('upload-error', {
        pageTitle: 'Session Expired',
        errorTitle: 'Session Expired',
        errorMessage: 'This upload session has expired. Please request a new upload link.',
      });
      return;
    }

    if (session.status === 'completed') {
      res.status(410).render('upload-error', {
        pageTitle: 'Upload Complete',
        errorTitle: 'Upload Complete',
        errorMessage: 'A file has already been uploaded in this session. The session is now closed.',
      });
      return;
    }

    if (session.status === 'closed') {
      res.status(410).render('upload-error', {
        pageTitle: 'Session Closed',
        errorTitle: 'Session Closed',
        errorMessage: 'This upload session has been closed. Please request a new upload link.',
      });
      return;
    }

    res.render('upload', {
      pageTitle: 'File Upload',
      token: session.token,
      workspace: session.workspace,
      maxFileSizeMb: Math.round(session.maxFileSize / (1024 * 1024)),
      allowedExtensions: session.allowedExtensions ?? [],
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  // ── GET /upload/:token/status — session status as JSON ─────────────────────
  app.get('/upload/:token/status', (req: Request, res: Response) => {
    const token = paramString(req.params.token);
    const session = uploadManager.getSession(token);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({
      status: session.status,
      uploaded_file: session.uploadedFile
        ? { name: session.uploadedFile.originalName, size: session.uploadedFile.size, path: session.uploadedFile.path }
        : null,
    });
  });

  // ── POST /upload/:token — handle file upload ──────────────────────────────
  app.post('/upload/:token', async (req: Request, res: Response) => {
    const token = paramString(req.params.token);
    const session = uploadManager.getActiveSession(token);

    if (!session) {
      res.status(400).json({ error: 'Upload session is not active (expired, closed, or not found).' });
      return;
    }

    // Resolve user and target directory
    let mapping;
    try {
      mapping = await userManager.ensureUser(session.email);
    } catch (error) {
      logger.error({ error, email: session.email }, 'Failed to resolve user for upload');
      res.status(500).json({ error: 'Failed to resolve user account.' });
      return;
    }

    const uploadsDir = join('/home', mapping.username, 'workspaces', session.workspace, 'uploads');

    // Ensure uploads directory exists
    try {
      mkdirSync(uploadsDir, { recursive: true });
      chownSync(uploadsDir, mapping.uid, mapping.uid);
    } catch (error) {
      logger.error({ error, uploadsDir }, 'Failed to create uploads directory');
      res.status(500).json({ error: 'Failed to prepare upload directory.' });
      return;
    }

    // Parse multipart form data with busboy
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: session.maxFileSize },
      });
    } catch (error) {
      res.status(400).json({ error: 'Invalid request. Expected multipart/form-data.' });
      return;
    }

    let fileProcessed = false;
    let fileTooLarge = false;
    let uploadError: string | null = null;

    const uploadPromise = new Promise<{ filename: string; size: number; path: string } | null>((resolve) => {
      busboy.on('file', (_fieldname: string, fileStream: NodeJS.ReadableStream, info: { filename: string; encoding: string; mimeType: string }) => {
        if (fileProcessed) {
          // Skip additional files
          (fileStream as NodeJS.ReadableStream & { resume: () => void }).resume();
          return;
        }
        fileProcessed = true;

        const sanitised = sanitiseFilename(info.filename || 'upload');

        // Validate extension
        if (session.allowedExtensions?.length) {
          const ext = extname(sanitised).toLowerCase();
          if (!session.allowedExtensions.includes(ext)) {
            uploadError = `File type ${ext} is not allowed.`;
            (fileStream as NodeJS.ReadableStream & { resume: () => void }).resume();
            resolve(null);
            return;
          }
        }

        const targetPath = resolveFilePath(uploadsDir, sanitised);
        const finalName = basename(targetPath);
        const writeStream = createWriteStream(targetPath);
        let bytesWritten = 0;

        fileStream.on('data', (chunk: Buffer) => {
          bytesWritten += chunk.length;
        });

        (fileStream as NodeJS.ReadableStream & { on: (event: string, cb: () => void) => void }).on('limit', () => {
          fileTooLarge = true;
          writeStream.destroy();
          // Clean up partial file
          try {
            const fs = require('node:fs');
            fs.unlinkSync(targetPath);
          } catch { /* ignore */ }
        });

        fileStream.pipe(writeStream);

        writeStream.on('finish', () => {
          if (fileTooLarge) {
            resolve(null);
            return;
          }

          // Set correct ownership
          try {
            chownSync(targetPath, mapping.uid, mapping.uid);
          } catch (error) {
            logger.warn({ error, targetPath }, 'Failed to chown uploaded file');
          }

          resolve({
            filename: finalName,
            size: bytesWritten,
            path: `~/workspaces/${session.workspace}/uploads/${finalName}`,
          });
        });

        writeStream.on('error', (error) => {
          logger.error({ error, targetPath }, 'Write stream error during upload');
          uploadError = 'Failed to write file to disk.';
          resolve(null);
        });
      });

      busboy.on('error', (error: Error) => {
        logger.error({ error }, 'Busboy parsing error');
        uploadError = 'Failed to parse upload.';
        resolve(null);
      });

      busboy.on('finish', () => {
        if (!fileProcessed) {
          uploadError = 'No file was included in the upload.';
          resolve(null);
        }
      });
    });

    req.pipe(busboy);

    const result = await uploadPromise;

    if (fileTooLarge) {
      const maxMb = Math.round(session.maxFileSize / (1024 * 1024));
      res.status(413).json({ error: `File exceeds the maximum size of ${maxMb} MB.` });
      return;
    }

    if (uploadError || !result) {
      res.status(400).json({ error: uploadError || 'Upload failed.' });
      return;
    }

    // Mark session complete
    uploadManager.completeSession(token, {
      originalName: result.filename,
      size: result.size,
      path: result.path,
    });

    logger.info(
      { token, filename: result.filename, size: result.size, workspace: session.workspace },
      'File uploaded successfully',
    );

    res.json({
      success: true,
      filename: result.filename,
      size: result.size,
      path: result.path,
    });
  });
}
