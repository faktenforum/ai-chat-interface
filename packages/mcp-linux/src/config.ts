/**
 * Server-wide config (config.yaml). Loaded by the MCP server only.
 */

import fs from 'node:fs/promises';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { ConfigSchema, type Config, type WorkspaceTemplate } from './schemas/config.schema.ts';

export type { WorkspaceTemplate };

let cached: Config | null = null;
let loading: Promise<Config> | null = null;

function getConfigPath(): string {
  const fromEnv = process.env.MCP_LINUX_CONFIG;
  if (fromEnv) return fromEnv;
  return join(process.cwd(), 'config.yaml');
}

async function loadConfig(): Promise<Config> {
  if (cached !== null) return cached;
  if (loading) return loading;
  loading = (async () => {
    let path = getConfigPath();
    try {
      await fs.access(path);
    } catch {
      const examplePath = join(process.cwd(), 'config.example.yaml');
      try {
        await fs.access(examplePath);
        path = examplePath;
      } catch {
        cached = { administrators: [], workspace_templates: {} };
        return cached;
      }
    }
    try {
      const raw = await fs.readFile(path, 'utf-8');
      const parsed = yamlLoad(raw) as unknown;
      cached = ConfigSchema.parse(parsed ?? {});
      return cached;
    } catch {
      cached = { administrators: [], workspace_templates: {} };
      return cached;
    }
  })();
  return loading;
}

export async function getWorkspaceTemplate(name: string): Promise<WorkspaceTemplate | undefined> {
  const config = await loadConfig();
  return config.workspace_templates[name];
}

export async function getAdministrators(): Promise<string[]> {
  const config = await loadConfig();
  return config.administrators ?? [];
}
