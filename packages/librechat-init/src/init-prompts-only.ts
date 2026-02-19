#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings
import { initializePrompts } from './init-prompts.ts';

async function main() {
  console.log('=========================================');
  console.log('LibreChat Prompt Initialization Started');
  console.log('=========================================\n');

  try {
    await initializePrompts();

    console.log('\n=========================================');
    console.log('✓ LibreChat Prompt Initialization Completed');
    console.log('=========================================');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Prompt initialization failed:', error);
    process.exit(1);
  }
}

main();
