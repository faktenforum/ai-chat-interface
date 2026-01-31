#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/** MCP YTPTube: YTPTube-backed MCP (video URL → transcript via Scaleway STT; extensible). Streamable HTTP transport. */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { YTPTubeConfig } from './clients/ytptube.ts';
import type { ScalewayConfig } from './clients/scaleway.ts';
import { requestVideoTranscript, type RequestVideoTranscriptDeps } from './tools/request-video-transcript.ts';
import { getStatus } from './tools/get-status.ts';
import { requestDownloadLink } from './tools/request-download-link.ts';
import { listRecentDownloads } from './tools/list-recent-downloads.ts';
import { getVideoInfo } from './tools/get-video-info.ts';
import { getThumbnailUrl } from './tools/get-thumbnail-url.ts';
import { CreateVideoTranscriptSchema } from './schemas/create-video-transcript.schema.ts';
import { GetStatusSchema } from './schemas/get-status.schema.ts';
import { RequestDownloadLinkSchema } from './schemas/request-download-link.schema.ts';
import { ListRecentDownloadsSchema } from './schemas/list-recent-downloads.schema.ts';
import { GetVideoInfoSchema } from './schemas/get-video-info.schema.ts';
import { GetThumbnailUrlSchema } from './schemas/get-thumbnail-url.schema.ts';
import { logger } from './utils/logger.ts';
import { VideoTranscriptsError } from './utils/errors.ts';
import { formatErrorResponse } from './utils/response-format.ts';
import { setupMcpEndpoints, setupGracefulShutdown } from './utils/http-server.ts';

const PORT = parseInt(
  process.env.MCP_YTPTUBE_PORT ?? process.env.PORT ?? '3010',
  10,
);
const SERVER_NAME = 'mcp-ytptube';
const SERVER_VERSION = '1.0.0';

const transports = new Map<string, StreamableHTTPServerTransport>();

function getYTPTubeConfig(): YTPTubeConfig {
  const baseUrl = (process.env.YTPTUBE_URL ?? 'http://ytptube:8081').replace(/\/+$/, '');
  const apiKey = process.env.YTPTUBE_API_KEY ?? process.env.YTPTUBE_BASIC_AUTH;
  const pollIntervalMs = parseInt(process.env.YTPTUBE_POLL_INTERVAL_MS ?? '3000', 10);
  const maxWaitMs = parseInt(process.env.YTPTUBE_MAX_WAIT_MS ?? String(60 * 60 * 1000), 10);
  return { baseUrl, apiKey: apiKey || undefined, pollIntervalMs, maxWaitMs };
}

function getScalewayConfig(): ScalewayConfig {
  const baseUrl = process.env.SCALEWAY_BASE_URL ?? '';
  const apiKey = process.env.SCALEWAY_API_KEY ?? '';
  if (!baseUrl || !apiKey) {
    throw new Error('SCALEWAY_BASE_URL and SCALEWAY_API_KEY must be set');
  }
  const model = process.env.SCALEWAY_TRANSCRIPTION_MODEL ?? 'whisper-large-v3';
  return { baseUrl, apiKey, model };
}

function createMcpServer(): McpServer {
  const ytptube = getYTPTubeConfig();
  const scaleway = getScalewayConfig();
  const deps: RequestVideoTranscriptDeps = { ytptube, scaleway };

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: `YTPTube MCP: video URL to transcript or download link.

Request flow: (1) request_video_transcript for transcript only; (2) request_download_link for download link (video or audio) only. Both tools check if the result exists; if yes return it; if not they start the job and return status. Poll with get_status(video_url=...) or get_status(job_id=<UUID>). When status=finished, call the same request tool again to get transcript or link.

LibreChat: No automatic MCP polling. Tell the user to ask for status (e.g. "What is the status?"); then call get_status and reply. Do not promise to monitor or check back automatically.

Important: job_id is the internal UUID (36-char). Use get_status(job_id=...) or get_status(video_url=...); not the platform video id. Relay the relay= line to the user.

Video-only: If the item was only downloaded as video, request_video_transcript starts a transcript job and returns queued; poll get_status then call request_video_transcript again when finished.

Transcript language: Without language_hint, responses include language=unknown and language_instruction. Tell the user the language was unspecified and may be wrong; if wrong, ask for the correct language and re-call with language_hint (e.g. "de"). Pass language_hint proactively when the user already indicated the video language.

Cookies: Optional cookies (Netscape HTTP Cookie format) help with 403, age-restricted, login-only, or geo-blocked videos. First line of the file must be "# HTTP Cookie File" or "# Netscape HTTP Cookie File" (see yt-dlp FAQ). User can export from browser (e.g. extension "Get cookies.txt LOCALLY" / "cookies.txt" for Firefox, or yt-dlp --cookies-from-browser … --cookies file.txt) then paste the content in chat or upload the file. In LibreChat, a cookies file exported via the browser extension can be uploaded as "Upload as Text". If the user uploads a file, read its content and pass it as the cookies parameter to request_video_transcript or request_download_link. Cookies are not stored server-side; for multiple videos in the same conversation, reuse the cookie content the user provided and pass it again in each request. When the user asks about cookies or reports 403/age-restriction, explain these steps and use the provided cookie content on the next request. Cookie content is sensitive; advise sharing only in trusted chats.

Never invent or hallucinate transcript text. Use get_video_info for metadata without downloading; use list_recent_downloads to see queue/history (job_id there is UUID).`,
    },
  );

  type ToolHandler = (args: unknown, deps: RequestVideoTranscriptDeps) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
  const withErrorHandler = (toolName: string, handler: ToolHandler) => {
    return async (args: unknown) => {
      const safe =
        args != null && typeof args === 'object'
          ? {
              video_url: (args as { video_url?: string }).video_url,
              job_id: (args as { job_id?: string }).job_id,
            }
          : {};
      logger.debug({ tool: toolName, ...safe }, 'Tool invoked');
      try {
        return await handler(args, deps);
      } catch (error) {
        logger.error(
          {
            tool: toolName,
            args,
            error: error instanceof Error ? error.message : String(error),
          },
          'Tool execution failed',
        );
        const message =
          error instanceof VideoTranscriptsError
            ? error.message
            : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
        return {
          content: [{ type: 'text' as const, text: formatErrorResponse(message) }],
          isError: true,
        };
      }
    };
  };

  server.registerTool(
    'request_video_transcript',
    {
      description:
        'Get transcript for a video URL. If exists → transcript; else starts job and returns status. Poll get_status; when finished call again for transcript. Video-only items start a transcript job automatically. language_hint (e.g. "de") forces language; omit → language=unknown + instruction to ask user and re-call if wrong. Optional cookies (Netscape format) for age-restricted or login-required videos; user can paste content or upload file – see server instructions.',
      inputSchema: CreateVideoTranscriptSchema,
    },
    withErrorHandler('request_video_transcript', (a, d) => requestVideoTranscript(a, d)),
  );

  server.registerTool(
    'get_status',
    {
      description:
        'Poll status of a YTPTube item (transcript or download). Use video_url (the URL you requested) or job_id (the UUID from a prior response; not the platform video id). When status=finished, call request_video_transcript or request_download_link again to get transcript or link.',
      inputSchema: GetStatusSchema,
    },
    withErrorHandler('get_status', (a, d) => getStatus(a, { ytptube: d.ytptube })),
  );

  const publicDownloadBaseUrl = process.env.YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL?.trim() || undefined;
  server.registerTool(
    'request_download_link',
    {
      description:
        'Get download link (video or audio) for a video URL. If the file exists, returns download_url; otherwise starts download and returns status=queued. Poll with get_status; when finished call this tool again for the link. Use type=video for video file, type=audio for audio-only (e.g. when only transcript/audio exists). Optional cookies (Netscape format) for age-restricted or login-required videos; user can paste content or upload file – see server instructions.',
      inputSchema: RequestDownloadLinkSchema,
    },
    withErrorHandler('request_download_link', (a) =>
      requestDownloadLink(a, { ytptube, publicDownloadBaseUrl }),
    ),
  );

  server.registerTool(
    'list_recent_downloads',
    {
      description:
        'List last N YTPTube history items (queue and/or finished). Each item has title, status, url, job_id (UUID; use with get_status), and download_url when finished. Use status_filter: all, finished, or queue.',
      inputSchema: ListRecentDownloadsSchema,
    },
    withErrorHandler('list_recent_downloads', (a) =>
      listRecentDownloads(a, { ytptube, publicDownloadBaseUrl }),
    ),
  );

  server.registerTool(
    'get_video_info',
    {
      description:
        'Fetch metadata (title, duration, extractor) for a video URL without downloading. Use to preview or check support before requesting transcript or download.',
      inputSchema: GetVideoInfoSchema,
    },
    withErrorHandler('get_video_info', (a) => getVideoInfo(a, { ytptube })),
  );

  server.registerTool(
    'get_thumbnail_url',
    {
      description: 'Get the thumbnail image URL for a video (from yt-dlp). Use for preview or UI.',
      inputSchema: GetThumbnailUrlSchema,
    },
    withErrorHandler('get_thumbnail_url', (a) => getThumbnailUrl(a, { ytptube })),
  );

  const cookiesUsagePromptText = [
    'Use cookies (Netscape HTTP Cookie format) with request_video_transcript or request_download_link when the user hits 403, age-restriction, or login-only.',
    'Format: first line "# HTTP Cookie File" or "# Netscape HTTP Cookie File"; data lines tab-separated (domain, flag, path, secure, expires, name, value).',
    'User can export from browser (extension "Get cookies.txt LOCALLY" / "cookies.txt" for Firefox, or yt-dlp --cookies-from-browser … --cookies file.txt), then paste in chat or upload the file. In LibreChat, a cookies file exported via the browser extension can be uploaded as "Upload as Text".',
    'Read file content and pass it as the cookies parameter. Cookies are not stored server-side; for multiple videos in the same conversation, reuse the cookie content the user provided and pass it again in each request.',
    'Advise sharing cookies only in trusted chats. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp',
  ].join(' ');

  server.registerPrompt(
    'cookies_usage',
    {
      title: 'How to use cookies with YTPTube',
      description:
        'Instructions for using Netscape-format cookies with request_video_transcript and request_download_link (403, age-restricted, login-only). Cookies are not stored; reuse from conversation for multiple videos.',
    },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: cookiesUsagePromptText } }],
    }),
  );

  return server;
}

function createSession(): { server: McpServer; transport: StreamableHTTPServerTransport } {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId: string) => {
      logger.info({ sessionId, totalSessions: transports.size + 1 }, 'Session initialized');
      transports.set(sessionId, transport);
    },
  });

  server.server.onclose = async () => {
    const sid = transport.sessionId;
    if (sid && transports.has(sid)) {
      logger.info({ sessionId: sid, totalSessions: transports.size - 1 }, 'Session closed');
      transports.delete(sid);
    }
  };

  return { server, transport };
}

function createApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.disable('x-powered-by');

  setupMcpEndpoints(app, {
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    port: PORT,
    transports,
    createServer: createSession,
    logger,
  });

  return app;
}

async function main(): Promise<void> {
  try {
    getScalewayConfig();
  } catch (e) {
    logger.error({ error: e }, 'SCALEWAY_BASE_URL / SCALEWAY_API_KEY not set');
    process.exit(1);
  }

  try {
    const app = createApp();
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT, service: SERVER_NAME, version: SERVER_VERSION }, 'MCP YTPTube Server started');
    });

    setupGracefulShutdown(server, transports, logger);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    logger.error({ error }, 'Fatal error');
    process.exit(1);
  });
}

export { createApp, createMcpServer };
