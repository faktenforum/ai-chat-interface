/**
 * Tool: get_system_configuration
 * YTPTube instance overview for debugging: version, presets, queue, history_count, paused, folders.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetSystemConfigurationSchema } from '../schemas/get-system-configuration.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import {
  getSystemConfiguration,
  type HistoryItem,
  type SystemConfigurationResponse,
} from '../clients/ytptube.ts';
import { VideoTranscriptsError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

export interface GetSystemConfigurationDeps {
  ytptube: YTPTubeConfig;
}

function presetOrFolderName(obj: unknown): string | null {
  return obj != null && typeof obj === 'object' && 'name' in obj
    ? (obj as { name?: string }).name ?? null
    : null;
}

function formatConfig(config: SystemConfigurationResponse): string {
  const lines: string[] = ['result=system_configuration'];
  const app = config.app;
  if (app && typeof app === 'object') {
    if (typeof app.version === 'string') lines.push(`version=${app.version}`);
    if (typeof app.download_path === 'string') lines.push(`download_path=${app.download_path}`);
    if (typeof app.base_path === 'string') lines.push(`base_path=${app.base_path}`);
  }
  if (typeof config.paused === 'boolean') lines.push(`paused=${config.paused}`);
  if (typeof config.history_count === 'number') lines.push(`history_count=${config.history_count}`);
  const queue = config.queue ?? [];
  const queueLen = Array.isArray(queue) ? queue.length : 0;
  lines.push(`queue_count=${queueLen}`);
  const presetNames = (config.presets ?? [])
    .map(presetOrFolderName)
    .filter((n): n is string => typeof n === 'string');
  if (presetNames.length > 0) lines.push(`presets=${presetNames.join(', ')}`);
  const folderNames = (config.folders ?? []).map(presetOrFolderName).filter((n): n is string => typeof n === 'string');
  if (folderNames.length > 0) lines.push(`folders=${folderNames.join(', ')}`);
  if (queueLen > 0 && Array.isArray(queue)) {
    lines.push('', 'Queue (first 10):');
    for (let i = 0; i < Math.min(10, queue.length); i++) {
      const item = queue[i] as HistoryItem | undefined;
      if (item && typeof item === 'object') {
        const id = (item as { _id?: string })._id ?? item.id;
        const status = typeof item.status === 'string' ? item.status : '?';
        const title = typeof item.title === 'string' ? item.title : '(no title)';
        lines.push(`  ${String(id)}  ${status}  ${title}`);
      }
    }
  }
  lines.push('relay=System configuration above. Use get_logs or get_history_item for more detail.');
  return lines.join('\n');
}

export async function getSystemConfigurationTool(
  input: unknown,
  deps: GetSystemConfigurationDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = GetSystemConfigurationSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  try {
    const config = await getSystemConfiguration(deps.ytptube);
    return { content: [{ type: 'text', text: formatConfig(config) }] };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err }, 'YTPTube GET /api/system/configuration failed');
    throw new VideoTranscriptsError(err.message, 'YTPTUBE_ERROR');
  }
}
