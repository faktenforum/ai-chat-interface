/**
 * Server-wide config (config.yaml). Loaded by the MCP server only.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { ConfigSchema, type Config, type WorkspaceTemplate } from './schemas/config.schema.ts';

export type { WorkspaceTemplate };

let cached: Config | null = null;

function getConfigPath(): string {
  const fromEnv = process.env.MCP_LINUX_CONFIG;
  if (fromEnv) return fromEnv;
  return join(process.cwd(), 'config.yaml');
}

function loadConfig(): Config {
  if (cached !== null) return cached;
  let path = getConfigPath();
  if (!existsSync(path)) {
    const examplePath = join(process.cwd(), 'config.example.yaml');
    if (existsSync(examplePath)) path = examplePath;
  }
  if (!existsSync(path)) {
    cached = { administrators: [], workspace_templates: {} };
    return cached;
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = yamlLoad(raw) as unknown;
    cached = ConfigSchema.parse(parsed ?? {});
    return cached;
  } catch {
    cached = { administrators: [], workspace_templates: {} };
    return cached;
  }
}

export function getWorkspaceTemplate(name: string): WorkspaceTemplate | undefined {
  const config = loadConfig();
  return config.workspace_templates[name];
}

export function getAdministrators(): string[] {
  const config = loadConfig();
  return config.administrators ?? [];
}
