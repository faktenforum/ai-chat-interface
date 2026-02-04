/**
 * Tool: get_history_item
 * Full details of a single YTPTube queue/history item by job_id. For debugging.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetHistoryItemSchema, type GetHistoryItemInput } from '../schemas/get-history-item.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import { getHistoryById, type HistoryItem } from '../clients/ytptube.ts';
import { VideoTranscriptsError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

export interface GetHistoryItemDeps {
  ytptube: YTPTubeConfig;
}

function formatHistoryItem(item: HistoryItem): string {
  const lines: string[] = ['result=history_item'];
  const keys = Object.keys(item)
    .filter((k) => item[k] !== undefined && item[k] !== null)
    .sort();
  for (const k of keys) {
    const v = item[k];
    const value =
      typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    lines.push(`${k}=${value}`);
  }
  lines.push('relay=Full item above. Use get_status for status summary.');
  return lines.join('\n');
}

export async function getHistoryItemTool(
  input: unknown,
  deps: GetHistoryItemDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = GetHistoryItemSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  const { job_id } = parsed.data as GetHistoryItemInput;

  try {
    const item = await getHistoryById(deps.ytptube, job_id);
    return { content: [{ type: 'text', text: formatHistoryItem(item) }] };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (String(err.message).includes('not found')) {
      const relay = `No item found for job_id=${job_id}. Check get_status or list_recent_downloads for valid IDs.`;
      return { content: [{ type: 'text', text: `result=history_item\nrelay=${relay}` }] };
    }
    logger.warn({ err, job_id }, 'YTPTube GET /api/history/{id} failed');
    throw new VideoTranscriptsError(err.message, 'YTPTUBE_ERROR');
  }
}
