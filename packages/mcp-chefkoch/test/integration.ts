#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '../..');

const PORT = process.env.PORT || '3014';

async function main(): Promise<void> {
  console.log('Checking if server is running...');
  try {
    const out = execSync(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${PORT}/health`, {
      encoding: 'utf-8',
      cwd: WORKSPACE_ROOT,
    });
    if (out.trim() === '200') {
      console.log('Server is running, health OK');
      return;
    }
    console.error('Server returned:', out.trim());
    process.exit(1);
  } catch {
    console.error('Server not reachable. Start it with: npm run start:local');
    process.exit(1);
  }
}

main();
