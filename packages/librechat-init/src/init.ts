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
    // Support both $${VAR} and $${VAR:-default} syntax
    const regex = new RegExp(`\\$\\$\\{${varName}(?::-([^}]+))?\\}`, 'g');
    resolved = resolved.replace(regex, (match, defaultValue) => {
      const result = envValue ?? defaultValue ?? '';
      if (varName === 'STACK_NAME') {
        console.log(`  Resolved ${match} -> ${result} (envValue: ${envValue ?? 'undefined'}, defaultValue: ${defaultValue ?? 'none'})`);
      }
      return result;
    });
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

  // Ensure STACK_NAME is set (fallback based on LIBRECHAT_ENV or 'prod')
  // This is needed for resolving placeholders in librechat.yaml
  // MUST be set BEFORE reading config files
  if (!process.env.STACK_NAME) {
    // Default based on LIBRECHAT_ENV: local -> 'local', dev -> 'dev', prod -> 'prod'
    const libreachEnv = process.env.LIBRECHAT_ENV ?? 'prod';
    process.env.STACK_NAME = libreachEnv === 'local' ? 'local' : (libreachEnv === 'dev' ? 'dev' : 'prod');
    console.log(`ℹ️  STACK_NAME not set, defaulting to "${process.env.STACK_NAME}" (based on LIBRECHAT_ENV=${libreachEnv})`);
  } else {
    console.log(`ℹ️  STACK_NAME=${process.env.STACK_NAME}`);
  }

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

      let configObj = parseYaml(readFileSync(CONFIG_SOURCE, 'utf-8')) as Record<string, unknown>;
      if (existsSync(overridePath)) {
        const overrideObj = parseYaml(readFileSync(overridePath, 'utf-8')) as object;
        configObj = deepMerge(configObj, overrideObj) as Record<string, unknown>;
        console.log(`✓ Merged override: librechat.${libreachEnv}.yaml`);
      }

      // Omit Checkbot RAG MCP server when URL is not set (avoids "Invalid URL" in LibreChat)
      const checkbotRagUrl = process.env.CHECKBOT_RAG_MCP_URL?.trim();
      const mcpServers = configObj?.mcpServers as Record<string, { url?: string }> | undefined;
      if (mcpServers && 'checkbot-rag' in mcpServers) {
        if (!checkbotRagUrl) {
          delete mcpServers['checkbot-rag'];
          console.log('✓ Checkbot RAG MCP omitted (CHECKBOT_RAG_MCP_URL not set)');
        } else {
          mcpServers['checkbot-rag'].url = checkbotRagUrl;
        }
      }

      let resolvedContent = stringifyYaml(configObj);
      // STACK_NAME is already set above, so placeholders will resolve correctly
      resolvedContent = resolveConfigPlaceholders(resolvedContent);
      resolvedContent = injectConstructedBaseURLs(resolvedContent);

      // Remove empty URLs and empty allowedDomains to avoid "Invalid URL" in LibreChat
      let finalObj = parseYaml(resolvedContent) as Record<string, unknown>;
      const mcpSettings = finalObj?.mcpSettings as { allowedDomains?: string[] } | undefined;
      if (Array.isArray(mcpSettings?.allowedDomains)) {
        const before = mcpSettings.allowedDomains.length;
        mcpSettings.allowedDomains = mcpSettings.allowedDomains.filter(
          (d) => d != null && typeof d === 'string' && d.trim() !== ''
        );
        if (mcpSettings.allowedDomains.length < before) {
          console.log('✓ Removed empty/null entries from mcpSettings.allowedDomains');
        }
      }
      const servers = finalObj?.mcpServers as Record<string, { url?: string }> | undefined;
      if (servers && typeof servers === 'object') {
        for (const [name, entry] of Object.entries(servers)) {
          if (entry && typeof entry === 'object' && (!entry.url || String(entry.url).trim() === '')) {
            delete servers[name];
            console.log(`✓ MCP server "${name}" omitted (empty url)`);
          }
        }
      }
      resolvedContent = stringifyYaml(finalObj);

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
