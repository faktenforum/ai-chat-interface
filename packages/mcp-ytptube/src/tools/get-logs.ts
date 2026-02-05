/**
 * Tool: get_logs
 * Recent YTPTube application logs for debugging. Requires file logging enabled.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetLogsSchema, type GetLogsInput } from '../schemas/get-logs.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import { getLogs, type LogEntry } from '../clients/ytptube.ts';
import { VideoTranscriptsError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

export interface GetLogsDeps {
  ytptube: YTPTubeConfig;
}

/** Format one log entry. Prefers line+datetime (YTPTube stream format), else timestamp+level+message. */
function formatLogEntry(entry: LogEntry): string {
  if (typeof entry.line === 'string' && entry.line.length > 0) {
    const dt = typeof entry.datetime === 'string' ? entry.datetime : '';
    return dt ? `${dt} ${entry.line}` : entry.line;
  }
  const ts = typeof entry.timestamp === 'string' ? entry.timestamp : '';
  const level = (typeof entry.level === 'string' ? entry.level : '').toUpperCase();
  const msg = typeof entry.message === 'string' ? entry.message : JSON.stringify(entry);
  return `${ts} ${level} ${msg}`.trim();
}

export async function getLogsTool(
  input: unknown,
  deps: GetLogsDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = GetLogsSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  const { offset, limit } = parsed.data as GetLogsInput;

  try {
    const data = await getLogs(deps.ytptube, { offset, limit });
    const lines = (data.logs ?? []).map(formatLogEntry);
    const next = data.next_offset ?? data.offset + lines.length;
    if (data.end_is_reached !== undefined) {
      lines.push(`end_is_reached=${data.end_is_reached}`);
    }
    const summary = `offset=${data.offset} limit=${data.limit} count=${lines.length}`;
    const relay =
      lines.length > 0
        ? `Recent logs (${summary}). Use get_logs with offset=${next} for more.`
        : `No log entries (${summary}). File logging may be disabled or no entries in range.`;
    const text = lines.length > 0 ? lines.join('\n') + `\nrelay=${relay}` : `relay=${relay}`;
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err }, 'YTPTube GET /api/logs failed');
    throw new VideoTranscriptsError(err.message, 'YTPTUBE_ERROR');
  }
}
