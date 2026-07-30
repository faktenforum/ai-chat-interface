#!/usr/bin/env -S node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Validates librechat.yaml against LibreChat's own Zod schema, for every
 * environment, before the config can reach a container.
 *
 * This exists because a valid YAML file is not a valid config. LibreChat refuses
 * to start on a schema violation - `mcpServers.*.title` for instance has to match
 * /^[a-zA-Z0-9 ]+$/, so a hyphen in a display name is enough to crashloop the
 * API - and the merge that init performs means the file that ships is not any of
 * the files in the repo.
 *
 * The schema comes from the fork in dev/librechat, so what passes here is what
 * the deployed image accepts. A schema change in the fork changes this check with
 * it, which is the point.
 *
 *   npm run validate:config
 */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
/* The merge init performs, not a reimplementation of it - an override that merges
 * differently here would validate a config nobody ever ships. */
import { deepMerge } from '../packages/librechat-init/src/utils/merge.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONFIG_DIR = join(ROOT, 'packages/librechat-init/config');
const DATA_PROVIDER = join(
  ROOT,
  'dev/librechat/packages/data-provider/dist/index.js',
);

const require = createRequire(import.meta.url);

/**
 * Fills in the placeholders so the schema sees the shape it will see in the
 * container. init resolves `$${VAR:-default}` at build time and leaves `${VAR}`
 * for LibreChat to resolve at load time, and neither form is a valid URL - which
 * is what the schema checks. Names that read like a URL get a URL-shaped
 * stand-in; everything else gets a hostname-safe token.
 */
function resolvePlaceholders(raw: string): string {
  const substitute = (name: string, fallback: string | undefined): string => {
    if (fallback != null && fallback !== '') {
      return fallback;
    }
    return /URL|URI/.test(name)
      ? 'https://placeholder.invalid'
      : `placeholder-${name.toLowerCase().replace(/_/g, '-')}`;
  };

  return raw
    .replace(/\$\$\{([A-Za-z0-9_]+)(?::-([^}]*))?\}/g, (_match, name, fallback) =>
      substitute(name, fallback),
    )
    .replace(/\$\{([A-Za-z0-9_]+)(?::-([^}]*))?\}/g, (_match, name, fallback) =>
      substitute(name, fallback),
    );
}

function load(file: string): unknown {
  return yaml.load(resolvePlaceholders(readFileSync(join(CONFIG_DIR, file), 'utf8')));
}

function main(): void {
  if (!existsSync(DATA_PROVIDER)) {
    console.error(
      `Cannot validate: ${DATA_PROVIDER} is missing.\nBuild the fork first: npm run build:dev (or cd dev/librechat && npm run build).`,
    );
    process.exit(1);
  }

  const { configSchema } = require(DATA_PROVIDER) as {
    configSchema: { safeParse: (value: unknown) => SafeParseResult };
  };

  const base = load('librechat.yaml');
  let failed = false;

  for (const env of ['local', 'dev', 'prod'] as const) {
    const overrideFile = `librechat.${env}.yaml`;
    const config = existsSync(join(CONFIG_DIR, overrideFile))
      ? deepMerge(
          base as Record<string, unknown>,
          load(overrideFile) as Record<string, unknown>,
        )
      : base;

    const result = configSchema.safeParse(config);
    if (result.success) {
      console.log(`✓ ${env}`);
      continue;
    }

    failed = true;
    console.error(`✗ ${env}`);
    for (const issue of result.error.issues) {
      console.error(`    ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  if (failed) {
    console.error(
      '\nLibreChat exits on these instead of starting. Fix them before deploying.',
    );
    process.exit(1);
  }

  console.log('\nAll environments validate against the deployed schema.');
}

interface SafeParseResult {
  success: boolean;
  error?: { issues: { path: (string | number)[]; message: string }[] };
}

main();
