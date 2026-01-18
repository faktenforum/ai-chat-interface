#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setupPermissions } from './setup-permissions.ts';
import { initializeRoles } from './init-roles.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Source config is copied to /app/data during build to avoid volume mount conflicts
// The librechat-config volume mounts to /app/config, which would overwrite the source file
const CONFIG_SOURCE = '/app/data/librechat.yaml';
const CONFIG_TARGET = '/app/config/librechat.yaml';
const CONFIG_DIR = '/app/config';

/**
 * Environment variables that must be resolved at initialization time.
 * These variables are used in interface configuration sections that LibreChat
 * reads once at startup and does not re-evaluate at runtime.
 *
 * Variables not in this list are converted from $${VAR} to ${VAR} format
 * so LibreChat can resolve them dynamically at runtime (e.g., webSearch config).
 */
const INIT_TIME_ENV_VARS = [
  'LIBRECHAT_CUSTOM_WELCOME',
  'LIBRECHAT_PRIVACY_POLICY_URL',
  'LIBRECHAT_TERMS_OF_SERVICE_URL',
] as const;

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

async function main() {
  console.log('=========================================');
  console.log('LibreChat Initialization Started');
  console.log('=========================================\n');

  try {
    // Task 1: Copy LibreChat config and resolve placeholders
    console.log('[1/3] Setting up LibreChat configuration...');
    if (existsSync(CONFIG_SOURCE)) {
      // Ensure target directory exists (named volumes are empty by default)
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
        console.log('✓ Created config directory');
      }

      // Read source config
      const sourceContent = readFileSync(CONFIG_SOURCE, 'utf-8');
      
      // Resolve environment variable placeholders
      const resolvedContent = resolveConfigPlaceholders(sourceContent);
      
      // Write resolved config to target
      writeFileSync(CONFIG_TARGET, resolvedContent, 'utf-8');
      console.log('✓ Config copied and placeholders resolved successfully');
    } else {
      throw new Error(`Config file not found: ${CONFIG_SOURCE}`);
    }

    // Task 2: Setup file permissions
    console.log('\n[2/3] Setting up file permissions...');
    await setupPermissions();

    // Task 3: Initialize MongoDB roles
    console.log('\n[3/3] Initializing MongoDB roles...');
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
