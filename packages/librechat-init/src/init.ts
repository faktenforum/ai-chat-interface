#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { setupPermissions } from './setup-permissions.ts';
import { initializeRoles } from './init-roles.ts';
import {
  CONFIG_SOURCE,
  CONFIG_TARGET,
  CONFIG_DIR,
  ASSETS_DIR,
  IMAGES_DIR,
  MCP_ICON_PATTERN,
  INIT_TIME_ENV_VARS,
} from './utils/constants.ts';

/**
 * Resolves environment variable placeholders in YAML configuration content.
 *
 * Two-phase resolution:
 * 1. Resolves init-time variables (replaces $${VAR} with actual values)
 * 2. Converts remaining $${VAR} to ${VAR} for LibreChat runtime resolution
 *
 * @param content - Raw YAML content with $${VAR} placeholders
 * @returns YAML content with resolved placeholders
 */
function resolveConfigPlaceholders(content: string): string {
  let resolved = content;

  // Phase 1: Resolve init-time variables with actual environment values
  for (const varName of INIT_TIME_ENV_VARS) {
    const envValue = process.env[varName];
    // Replace all occurrences of $${VAR} with actual value (or empty string if unset)
    const regex = new RegExp(`\\$\\$\\{${varName}\\}`, 'g');
    resolved = resolved.replace(regex, envValue ?? '');
  }

  // Phase 2: Convert remaining $${VAR} to ${VAR} for LibreChat runtime resolution
  // Docker Compose escapes ${VAR} to $${VAR} in YAML, so we convert them back
  resolved = resolved.replace(/\$\$\{([^}]+)\}/g, '${$1}');

  return resolved;
}

/**
 * Constructs and injects service-specific BASE_URL values into YAML configuration.
 * 
 * Some services require dynamic BASE_URL construction based on environment variables
 * (e.g., Scaleway requires project ID in the URL path).
 * 
 * @param content - YAML content with ${VAR} placeholders (after resolveConfigPlaceholders)
 * @returns YAML content with constructed BASE_URL values injected
 */
function injectConstructedBaseURLs(content: string): string {
  let resolved = content;

  // Scaleway: Construct BASE_URL with project ID if provided
  // Format: https://api.scaleway.ai/{project_id}/v1
  const scalewayProjectId = process.env.SCALEWAY_PROJECT_ID?.trim();
  if (scalewayProjectId) {
    const constructedBaseURL = `https://api.scaleway.ai/${scalewayProjectId}/v1`;
    // Replace ${SCALEWAY_BASE_URL} placeholder with constructed URL
    resolved = resolved.replace(
      /baseURL:\s*"\$\{SCALEWAY_BASE_URL\}"/g,
      `baseURL: "${constructedBaseURL}"`
    );
    // Update environment variable for consistency
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
    // Task 1: Copy LibreChat config and resolve placeholders
    console.log('[1/4] Setting up LibreChat configuration...');
    if (existsSync(CONFIG_SOURCE)) {
      // Ensure target directory exists (named volumes are empty by default)
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
        console.log('✓ Created config directory');
      }

      // Read source config
      const sourceContent = readFileSync(CONFIG_SOURCE, 'utf-8');
      
      // Step 1: Resolve environment variable placeholders (converts $${VAR} to ${VAR})
      let resolvedContent = resolveConfigPlaceholders(sourceContent);
      
      // Step 2: Inject constructed BASE_URL values (e.g., Scaleway with project ID)
      resolvedContent = injectConstructedBaseURLs(resolvedContent);
      
      // Write resolved config to target
      writeFileSync(CONFIG_TARGET, resolvedContent, 'utf-8');
      console.log('✓ Config copied and placeholders resolved successfully');
    } else {
      throw new Error(`Config file not found: ${CONFIG_SOURCE}`);
    }

    // Task 2: Copy MCP icons to images directory
    console.log('\n[2/4] Copying MCP icons...');
    if (!existsSync(IMAGES_DIR)) {
      mkdirSync(IMAGES_DIR, { recursive: true });
      console.log('✓ Created images directory');
    }

    if (existsSync(ASSETS_DIR)) {
      const assets = readdirSync(ASSETS_DIR);
      const iconFiles = assets.filter((file) => MCP_ICON_PATTERN.test(file));
      
      if (iconFiles.length === 0) {
        console.log('⚠ No MCP icons found in assets directory (optional)');
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

    // Task 3: Setup file permissions
    console.log('\n[3/4] Setting up file permissions...');
    await setupPermissions();

    // Task 4: Initialize MongoDB roles
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
