#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/** MCP YTPTube: YTPTube-backed MCP (media URL → transcript or download; video or audio-only). Streamable HTTP transport. */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { YTPTubeConfig } from './clients/ytptube.ts';
import type { TranscriptionConfig } from './clients/transcription.ts';
import { requestTranscript, type RequestTranscriptDeps } from './tools/request-transcript.ts';
import { getStatus } from './tools/get-status.ts';
import { requestDownloadLink } from './tools/request-download-link.ts';
import { listRecentDownloads } from './tools/list-recent-downloads.ts';
import { getMediaInfo } from './tools/get-media-info.ts';
import { getThumbnailUrl } from './tools/get-thumbnail-url.ts';
import { RequestTranscriptSchema } from './schemas/request-transcript.schema.ts';
import { GetStatusSchema } from './schemas/get-status.schema.ts';
import { RequestDownloadLinkSchema } from './schemas/request-download-link.schema.ts';
import { ListRecentDownloadsSchema } from './schemas/list-recent-downloads.schema.ts';
import { GetMediaInfoSchema } from './schemas/get-media-info.schema.ts';
import { GetThumbnailUrlSchema } from './schemas/get-thumbnail-url.schema.ts';
import { waitForYTPTube, ensureMcpPreset } from './clients/ytptube-presets.ts';
import { logger } from './utils/logger.ts';
import { VideoTranscriptsError } from './utils/errors.ts';
import { formatErrorResponse } from './utils/response-format.ts';
import { setupMcpEndpoints, setupGracefulShutdown } from './utils/http-server.ts';
import { MCP_INSTRUCTIONS, COOKIES_USAGE_PROMPT_TEXT } from './instructions.ts';

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

function getTranscriptionConfig(): TranscriptionConfig | null {
  const baseUrl = (process.env.TRANSCRIPTION_BASE_URL ?? '').trim();
  const apiKey = (process.env.TRANSCRIPTION_API_KEY ?? '').trim();
  if (!baseUrl || !apiKey) return null;
  const model = (process.env.TRANSCRIPTION_MODEL ?? 'whisper-1').trim() || undefined;
  return { baseUrl, apiKey, model };
}

function createMcpServer(): McpServer {
  const ytptube = getYTPTubeConfig();
  const transcription = getTranscriptionConfig();
  const deps: RequestTranscriptDeps = { ytptube, transcription };

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: MCP_INSTRUCTIONS,
    },
  );

  type ToolHandler = (args: unknown, deps: RequestTranscriptDeps) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
  const withErrorHandler = (toolName: string, handler: ToolHandler) => {
    return async (args: unknown) => {
      const safe =
        args != null && typeof args === 'object'
          ? {
              media_url: (args as { media_url?: string }).media_url,
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
    'request_transcript',
    {
      description:
        'Get transcript for a media URL (video or audio-only). Any yt-dlp-supported URL (YouTube, SoundCloud, etc.). If result exists → transcript; else starts job and returns status. Poll get_status; when finished call again for transcript. Video-only items start a transcript job automatically. language_hint (e.g. "de") forces language; omit → language=unknown + instruction to ask user and re-call if wrong. Optional cookies (Netscape format) for age-restricted or login-required; user can paste content or upload file – see server instructions.',
      inputSchema: RequestTranscriptSchema,
    },
    withErrorHandler('request_transcript', (a, d) => requestTranscript(a, d)),
  );

  server.registerTool(
    'get_status',
    {
      description:
        'Poll status of a YTPTube item (transcript or download). Use media_url (the URL you requested) or job_id (the UUID from a prior response; not the platform media id). When status=finished, call request_transcript or request_download_link again to get transcript or link.',
      inputSchema: GetStatusSchema,
    },
    withErrorHandler('get_status', (a, d) => getStatus(a, { ytptube: d.ytptube })),
  );

  const publicDownloadBaseUrl = process.env.YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL?.trim() || undefined;
  server.registerTool(
    'request_download_link',
    {
      description:
        'Get download link (video or audio) for a media URL. If the file exists, returns download_url; otherwise starts download and returns status=queued. Poll with get_status; when finished call this tool again for the link. Use type=video for video file, type=audio for audio-only (e.g. when only transcript/audio exists). Optional cookies (Netscape format) for age-restricted or login-required; user can paste content or upload file – see server instructions.',
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
    'get_media_info',
    {
      description:
        'Fetch metadata (title, duration, extractor) for a media URL (video or audio-only) without downloading. Use to preview or check support before requesting transcript or download.',
      inputSchema: GetMediaInfoSchema,
    },
    withErrorHandler('get_media_info', (a) => getMediaInfo(a, { ytptube })),
  );

  server.registerTool(
    'get_thumbnail_url',
    {
      description: 'Get the thumbnail image URL for a media item (from yt-dlp). Use for preview or UI; may be empty for audio-only.',
      inputSchema: GetThumbnailUrlSchema,
    },
    withErrorHandler('get_thumbnail_url', (a) => getThumbnailUrl(a, { ytptube })),
  );

  server.registerPrompt(
    'cookies_usage',
    {
      title: 'How to use cookies with YTPTube',
      description:
        'Instructions for using Netscape-format cookies with request_transcript and request_download_link (403, age-restricted, login-only). Cookies are not stored; reuse from conversation for multiple items.',
    },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: COOKIES_USAGE_PROMPT_TEXT } }],
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
  const ytptube = getYTPTubeConfig();
  const startupMaxWaitMs = parseInt(
    process.env.YTPTUBE_STARTUP_MAX_WAIT_MS ?? String(5 * 60 * 1000),
    10,
  );

  try {
    await waitForYTPTube(ytptube, { maxWaitMs: startupMaxWaitMs });
  } catch (e) {
    logger.error({ error: e }, 'YTPTube not reachable at startup');
    process.exit(1);
  }

  const skipPresetSync = process.env.YTPTUBE_SKIP_PRESET_SYNC === '1' || process.env.YTPTUBE_SKIP_PRESET_SYNC === 'true';
  if (!skipPresetSync) {
    try {
      await ensureMcpPreset(ytptube);
    } catch (e) {
      logger.error({ error: e }, 'Failed to ensure transcript preset');
      process.exit(1);
    }
  } else {
    logger.info('YTPTUBE_SKIP_PRESET_SYNC set; skipping preset sync');
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
