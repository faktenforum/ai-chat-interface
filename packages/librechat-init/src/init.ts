#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { setupPermissions } from './setup-permissions.ts';
import { initializeRoles } from './init-roles.ts';
import { deepMerge } from './utils/merge.ts';
import {
  CONFIG_SOURCE,
  CONFIG_TARGET,
  CONFIG_DIR,
  AGENT_ID_MAP_PATH,
  ASSETS_DIR,
  IMAGES_DIR,
  INIT_TIME_ENV_VARS,
} from './utils/constants.ts';
import {
  loadAgentIdMap,
  patchModelSpecAgentIds,
} from './utils/patch-model-spec-agent-ids.ts';

function resolveConfigPlaceholders(content: string): string {
  let resolved = content;

  for (const varName of INIT_TIME_ENV_VARS) {
    const envValue = process.env[varName];
    const regex = new RegExp(`\\$\\$\\{${varName}\\}`, 'g');
    resolved = resolved.replace(regex, envValue ?? '');
  }

  resolved = resolved.replace(/\$\$\{([^}]+)\}/g, '${$1}');
  return resolved;
}

function injectConstructedBaseURLs(content: string): string {
  let resolved = content;
  const scalewayProjectId = process.env.SCALEWAY_PROJECT_ID?.trim();

  if (scalewayProjectId) {
    const constructedBaseURL = `https://api.scaleway.ai/${scalewayProjectId}/v1`;
    resolved = resolved.replace(
      /baseURL:\s*"\$\{SCALEWAY_BASE_URL\}"/g,
      `baseURL: "${constructedBaseURL}"`
    );
    resolved = resolved.replace(
      /\$\{SCALEWAY_STT_URL\}/g,
      `${constructedBaseURL}/audio/transcriptions`
    );
    process.env.SCALEWAY_BASE_URL = constructedBaseURL;
    console.log(`✓ Constructed Scaleway baseURL with project ID: ${constructedBaseURL.replace(scalewayProjectId, '***')}`);
  }

  return resolved;
}

async function main() {
  console.log('=========================================');
  console.log('LibreChat Initialization Started');
  console.log('=========================================\n');

  try {
    console.log('[1/4] Setting up LibreChat configuration...');
    if (existsSync(CONFIG_SOURCE)) {
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
        console.log('✓ Created config directory');
      }

      const libreachEnv = process.env.LIBRECHAT_ENV ?? 'prod';
      const configSourceDir = dirname(CONFIG_SOURCE);
      const overridePath = join(configSourceDir, `librechat.${libreachEnv}.yaml`);

      let configObj = parseYaml(readFileSync(CONFIG_SOURCE, 'utf-8')) as object;
      if (existsSync(overridePath)) {
        const overrideObj = parseYaml(readFileSync(overridePath, 'utf-8')) as object;
        configObj = deepMerge(configObj, overrideObj) as object;
        console.log(`✓ Merged override: librechat.${libreachEnv}.yaml`);
      }

      let resolvedContent = stringifyYaml(configObj);
      resolvedContent = resolveConfigPlaceholders(resolvedContent);
      resolvedContent = injectConstructedBaseURLs(resolvedContent);
      writeFileSync(CONFIG_TARGET, resolvedContent, 'utf-8');
      console.log('✓ Config written and placeholders resolved successfully');

      if (existsSync(AGENT_ID_MAP_PATH)) {
        const map = loadAgentIdMap(AGENT_ID_MAP_PATH);
        if (map && map.size > 0) {
          patchModelSpecAgentIds(CONFIG_TARGET, map);
          console.log(`  Applied persisted agent ID mapping (${map.size} entries).`);
        }
      }
    } else {
      throw new Error(`Config file not found: ${CONFIG_SOURCE}`);
    }

    console.log('\n[2/4] Copying MCP and group icons...');
    if (!existsSync(IMAGES_DIR)) {
      mkdirSync(IMAGES_DIR, { recursive: true });
      console.log('✓ Created images directory');
    }

    if (existsSync(ASSETS_DIR)) {
      const assets = readdirSync(ASSETS_DIR);
      const iconFiles = assets.filter((file) => file.endsWith('.svg'));

      if (iconFiles.length === 0) {
        console.log('⚠ No SVG icons found in assets directory (optional)');
      } else {
        for (const iconFile of iconFiles) {
          const sourcePath = join(ASSETS_DIR, iconFile);
          const targetPath = join(IMAGES_DIR, iconFile);
          copyFileSync(sourcePath, targetPath);
          console.log(`✓ Copied ${iconFile}`);
        }
      }
    } else {
      console.log('⚠ Assets directory not found (optional):', ASSETS_DIR);
    }

    console.log('\n[3/4] Setting up file permissions...');
    await setupPermissions();

    console.log('\n[4/4] Initializing MongoDB roles...');
    await initializeRoles();

    console.log('\n=========================================');
    console.log('✓ LibreChat Initialization Completed');
    console.log('=========================================');
    process.exit(0);

  } catch (error) {
    console.error('\n✗ Initialization failed:', error);
    process.exit(1);
  }
}

main();
