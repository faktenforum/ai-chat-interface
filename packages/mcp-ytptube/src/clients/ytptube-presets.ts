/**
 * YTPTube health check and presets API: wait for reachability, list/create/update presets.
 * Used at MCP server startup to ensure the transcript preset exists and is up to date.
 */

import type { YTPTubeConfig } from './ytptube.ts';
import { ensureSlash, getAuthHeaders } from './ytptube.ts';
import { PRESET_TRANSCRIPT } from '../utils/env.ts';
import { logger } from '../utils/logger.ts';

const DEFAULT_WAIT_INTERVAL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes

export interface PresetItem {
  id: number;
  name: string;
  description?: string;
  folder?: string;
  template?: string;
  cookies?: string;
  cli?: string;
  default?: boolean;
  priority?: number;
}

export interface PresetBody {
  name: string;
  description?: string;
  folder?: string;
  template?: string;
  cookies?: string;
  cli?: string;
  priority?: number;
}

/** Transcript preset CLI: archive_audio.log (so video can be requested later), Ogg Vorbis (Scaleway-supported). */
const MCP_AUDIO_PRESET_CLI =
  '--socket-timeout 30 --download-archive %(config_path)s/archive_audio.log\n--extract-audio --audio-format vorbis --add-chapters --embed-metadata --embed-thumbnail --format \'bestaudio/best\'';

export function getMcpAudioPresetBody(): PresetBody {
  return {
    name: PRESET_TRANSCRIPT,
    description:
      'Audio-only for MCP transcript jobs. Uses archive_audio.log so the same URL can later be downloaded as video.',
    folder: '',
    template: '',
    cookies: '',
    cli: MCP_AUDIO_PRESET_CLI,
    priority: 0,
  };
}

export interface WaitForYTPTubeOptions {
  intervalMs?: number;
  maxWaitMs?: number;
}

/**
 * Poll GET api/ping/ until YTPTube responds successfully or maxWaitMs is exceeded.
 */
export async function waitForYTPTube(
  config: YTPTubeConfig,
  options: WaitForYTPTubeOptions = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const base = ensureSlash(config.baseUrl);
  const url = `${base}api/ping/`;
  const headers = getAuthHeaders(config.apiKey);
  const deadline = Date.now() + maxWaitMs;

  logger.info({ baseUrl: config.baseUrl, maxWaitMs }, 'Waiting for YTPTube…');

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        logger.info({ baseUrl: config.baseUrl }, 'YTPTube is reachable');
        return;
      }
      const text = await res.text();
      logger.debug({ status: res.status, body: text.slice(0, 200) }, 'YTPTube ping non-OK');
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'YTPTube ping failed');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `YTPTube did not become reachable within ${maxWaitMs}ms. Check YTPTUBE_URL and that the service is running.`,
  );
}

interface PresetListResponse {
  items?: PresetItem[];
  pagination?: { total?: number; page?: number; per_page?: number; total_pages?: number };
}

/**
 * GET api/presets/ and return all items (paginated fetch if needed).
 */
export async function listPresets(config: YTPTubeConfig): Promise<PresetItem[]> {
  const base = ensureSlash(config.baseUrl);
  const headers = getAuthHeaders(config.apiKey);
  const all: PresetItem[] = [];
  let page = 1;
  const perPage = 100;

  for (;;) {
    const res = await fetch(`${base}api/presets/?page=${page}&per_page=${perPage}`, { headers });
    if (!res.ok) {
      const text = await res.text();
      let err: string;
      try {
        const j = JSON.parse(text) as { error?: string };
        err = j.error ?? text;
      } catch {
        err = text || res.statusText;
      }
      throw new Error(`YTPTube GET /api/presets/ failed (${res.status}): ${err}`);
    }
    const data = (await res.json()) as PresetListResponse;
    const items = Array.isArray(data.items) ? data.items : [];
    all.push(...items);
    const totalPages = data.pagination?.total_pages ?? 1;
    if (page >= totalPages || items.length === 0) break;
    page += 1;
  }
  return all;
}

/**
 * POST api/presets/ – create a preset.
 */
export async function createPreset(
  config: YTPTubeConfig,
  body: PresetBody,
): Promise<PresetItem> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/presets/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(config.apiKey),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube POST /api/presets/ failed (${res.status}): ${err}`);
  }
  return (await res.json()) as PresetItem;
}

/**
 * PUT api/presets/{id} – full update (default presets cannot be modified).
 */
export async function updatePreset(
  config: YTPTubeConfig,
  id: number,
  body: PresetBody,
): Promise<PresetItem> {
  const base = ensureSlash(config.baseUrl);
  const res = await fetch(`${base}api/presets/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(config.apiKey),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let err: string;
    try {
      const j = JSON.parse(text) as { error?: string };
      err = j.error ?? text;
    } catch {
      err = text || res.statusText;
    }
    throw new Error(`YTPTube PUT /api/presets/${id} failed (${res.status}): ${err}`);
  }
  return (await res.json()) as PresetItem;
}

function presetNeedsUpdate(existing: PresetItem, canonical: PresetBody): boolean {
  return (
    (canonical.description ?? '') !== (existing.description ?? '') ||
    (canonical.cli ?? '') !== (existing.cli ?? '') ||
    (canonical.priority ?? 0) !== (existing.priority ?? 0)
  );
}

/**
 * Ensure the transcript preset (PRESET_TRANSCRIPT) exists and matches the canonical definition.
 * Create if missing; PUT update if fields differ.
 */
export async function ensureMcpPreset(config: YTPTubeConfig): Promise<void> {
  const canonical = getMcpAudioPresetBody();
  const presets = await listPresets(config);
  const existing = presets.find((p) => p.name === canonical.name);

  if (!existing) {
    await createPreset(config, canonical);
    logger.info({ preset: canonical.name }, 'Preset created');
    return;
  }

  if (presetNeedsUpdate(existing, canonical)) {
    await updatePreset(config, existing.id, canonical);
    logger.info({ preset: canonical.name, id: existing.id }, 'Preset updated');
    return;
  }

  logger.debug({ preset: canonical.name }, 'Preset already up to date');
}
