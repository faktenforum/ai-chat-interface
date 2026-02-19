import { existsSync, readFileSync, writeFileSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * Replaces config IDs in modelSpecs preset.agent_id with real API agent IDs in the runtime config.
 * Used by init (from persisted map) and post-init (from current idMap).
 */
export function patchModelSpecAgentIds(
  configPath: string,
  idMap: Map<string, string>
): void {
  if (!existsSync(configPath)) {
    console.log(`  ℹ Config file not found (${configPath}), skipping modelSpec agent_id patch`);
    return;
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = parseYaml(raw) as {
      modelSpecs?: { list?: Array<{ preset?: { agent_id?: string } }> };
    };
    const list = config?.modelSpecs?.list;
    if (!list?.length) {
      return;
    }
    let patched = 0;
    for (const spec of list) {
      const aid = spec.preset?.agent_id;
      if (aid && idMap.has(aid)) {
        spec.preset!.agent_id = idMap.get(aid)!;
        patched++;
      }
    }
    if (patched > 0) {
      writeFileSync(configPath, stringifyYaml(config), 'utf-8');
      console.log(`  ✓ Patched ${patched} modelSpec(s) with real agent IDs.`);
    }
  } catch (err) {
    console.error(
      '  ⚠ Failed to patch config agent IDs:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Loads the persisted config-ID → API agent-ID map from JSON. Returns null if file is missing or invalid.
 */
export function loadAgentIdMap(filePath: string): Map<string, string> | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, string>;
    if (obj === null || typeof obj !== 'object') {
      return null;
    }
    return new Map(Object.entries(obj));
  } catch (err) {
    console.warn(
      `  ℹ Could not load agent ID map from ${filePath}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * Persists the config-ID → API agent-ID map as JSON (overwrites). Used by post-init.
 */
export function saveAgentIdMap(filePath: string, idMap: Map<string, string>): void {
  const obj = Object.fromEntries(idMap);
  writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
}
