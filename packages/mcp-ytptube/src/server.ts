#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/** MCP YTPTube: YTPTube-backed MCP (video URL → transcript via Scaleway STT; extensible for more YTPTube features). Streamable-http. */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import type { YTPTubeConfig } from './clients/ytptube.ts';
import type { ScalewayConfig } from './clients/scaleway.ts';
import { requestVideoTranscript, type RequestVideoTranscriptDeps } from './tools/request-video-transcript.ts';
import { getTranscriptStatus } from './tools/get-transcript-status.ts';
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
      instructions: `Video transcripts: request_video_transcript(video_url) → result=transcript (metadata + transcript in second block) or result=status (queued|downloading). get_transcript_status(video_url?, job_id?) → result=status. Relay the relay= line. For status use get_transcript_status(video_url=url or status_url from response)—do not use job_id (often platform video id, lookup fails). When status=finished, user can request transcript. Never invent transcript text.`,
    },
  );

  type ToolHandler = (args: unknown, deps: RequestVideoTranscriptDeps) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
  const withErrorHandler = (toolName: string, handler: ToolHandler) => {
    return async (args: unknown) => {
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

  const requestVideoTranscriptSchema = {
    video_url: z.string().url().describe('URL of the video to transcribe'),
    preset: z.string().optional().describe('YTPTube preset name (e.g. for audio-only)'),
    language_hint: z.string().optional().describe('Optional language hint for transcription'),
  };

  const getTranscriptStatusSchema = {
    job_id: z.string().optional().describe('YTPTube history item ID to check'),
    video_url: z.string().url().optional().describe('Video URL to look up by URL'),
  };

  server.registerTool(
    'request_video_transcript',
    {
      description: 'Transcript for video URL. Returns result=transcript (metadata + transcript block) when ready, or result=status (queued|downloading). Use get_transcript_status for progress; when finished, request transcript again.',
      inputSchema: requestVideoTranscriptSchema,
    },
    withErrorHandler('request_video_transcript', (a, d) => requestVideoTranscript(a, d)),
  );

  server.registerTool(
    'get_transcript_status',
    {
      description: 'Status by video_url (preferred) or job_id. Returns result=status, relay. Use video_url from prior response for reliable lookup; if status=finished, user can request transcript.',
      inputSchema: getTranscriptStatusSchema,
    },
    withErrorHandler('get_transcript_status', (a, d) => getTranscriptStatus(a, { ytptube: d.ytptube })),
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
