#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings
import { initializeAgents } from './init-agents.ts';

async function main() {
  console.log('=========================================');
  console.log('LibreChat Agent Initialization Started');
  console.log('=========================================\n');

  try {
    await initializeAgents();

    console.log('\n=========================================');
    console.log('✓ LibreChat Agent Initialization Completed');
    console.log('=========================================');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Agent initialization failed:', error);
    process.exit(1);
  }
}

main();
