#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings
import { initializeAgents } from './init-agents.ts';
import { initializePrompts } from './init-prompts.ts';

async function main() {
  console.log('=========================================');
  console.log('LibreChat Post-Init Started');
  console.log('=========================================\n');

  try {
    await initializeAgents();
    await initializePrompts();

    console.log('\n=========================================');
    console.log('✓ LibreChat Post-Init Completed');
    console.log('=========================================');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Post-init failed:', error);
    process.exit(1);
  }
}

main();
