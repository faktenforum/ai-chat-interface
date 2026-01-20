#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = join(__dirname, '../../..');

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const YELLOW = '\u001b[1;33m';
const NC = '\u001b[0m';

interface CommandResult {
  success: boolean;
  output: string;
  error?: string;
}

function runCommand(command: string, ignoreErrors = false): CommandResult {
  try {
    const output = execSync(command, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/sh'
    });
    return { success: true, output: output.trim() };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = err.stdout ? (Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf-8') : err.stdout) : '';
    const stderr = err.stderr ? (Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf-8') : err.stderr) : '';
    if (ignoreErrors) {
      return { 
        success: false, 
        output: stdout, 
        error: stderr || err.message 
      };
    }
    return { 
      success: false, 
      output: stdout, 
      error: stderr || err.message || 'Unknown error'
    };
  }
}

function commandExists(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { 
      stdio: 'ignore',
      shell: '/bin/sh'
    });
    return true;
  } catch {
    return false;
  }
}

function logSuccess(message: string): void {
  console.log(`${GREEN}✓${NC} ${message}`);
}

function logWarning(message: string): void {
  console.log(`${YELLOW}⚠${NC} ${message}`);
}

function logError(message: string): void {
  console.log(`${RED}✗${NC} ${message}`);
}

async function testHealthEndpoint(): Promise<void> {
  console.log('1. Testing health endpoint...');
  const result = runCommand('curl -s -f http://localhost:3001/health', true);
  if (result.success) {
    logSuccess('Health endpoint is accessible');
    const healthResult = runCommand('curl -s http://localhost:3001/health', true);
    if (healthResult.success) {
      if (commandExists('jq')) {
        const jqResult = runCommand(`echo '${healthResult.output.replace(/'/g, "'\\''")}' | jq .`, true);
        if (jqResult.success) {
          console.log(jqResult.output);
        } else {
          console.log(healthResult.output);
        }
      } else {
        try {
          const parsed = JSON.parse(healthResult.output);
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(healthResult.output);
        }
      }
    }
  } else {
    logWarning('Health endpoint is not accessible');
  }
  console.log('');
}

async function testDockerNetwork(): Promise<void> {
  console.log('2. Checking Docker network connectivity...');
  if (commandExists('docker')) {
    const containersResult = runCommand('docker ps --format "{{.Names}}"', true);
    if (containersResult.success) {
      const containers = containersResult.output.split('\n');
      const mcpContainer = containers.find(c => 
        c.includes('mcp-image-gen') || c.includes('prod-mcp-image-gen')
      );
      
      if (mcpContainer) {
        logSuccess(`MCP Image Generation container is running: ${mcpContainer}`);
        const ipResult = runCommand(
          `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${mcpContainer}"`,
          true
        );
        if (ipResult.success && ipResult.output) {
          console.log(`   Container IP: ${ipResult.output}`);
        }
      } else {
        logWarning('MCP Image Generation container is not running');
      }
    }
  } else {
    logWarning('Docker not available, skipping network check');
  }
  console.log('');
}

async function testLibreChatConfig(): Promise<void> {
  console.log('3. Checking LibreChat configuration...');
  const librechatConfig = join(WORKSPACE_ROOT, 'packages/librechat-init/config/librechat.yaml');
  
  if (existsSync(librechatConfig)) {
    const grepResult = runCommand(`grep -q "mcp-image-gen" "${librechatConfig}"`, true);
    if (grepResult.success) {
      logSuccess('MCP Image Generation is configured in LibreChat');
      const typeResult = runCommand(
        `grep -A 5 "image-gen:" "${librechatConfig}" | grep -q "type: streamable-http"`,
        true
      );
      if (typeResult.success) {
        logSuccess('Streamable HTTP transport is configured');
      } else {
        logError('Streamable HTTP transport not found in configuration');
      }
    } else {
      logError('MCP Image Generation not found in LibreChat configuration');
    }
  } else {
    logWarning(`LibreChat config file not found: ${librechatConfig}`);
  }
  console.log('');
}

async function testLibreChatConnectivity(): Promise<void> {
  console.log('4. Testing network connectivity from LibreChat...');
  if (commandExists('docker')) {
    const containersResult = runCommand('docker ps --format "{{.Names}}"', true);
    if (containersResult.success) {
      const containers = containersResult.output.split('\n');
      const librechatContainer = containers.find(c => 
        (c.toLowerCase().includes('librechat') || c.toLowerCase().includes('api')) &&
        !c.toLowerCase().includes('init')
      );
      
      if (librechatContainer) {
        const curlCheck = runCommand(
          `docker exec "${librechatContainer}" sh -c "command -v curl >/dev/null 2>&1"`,
          true
        );
        
        if (curlCheck.success) {
          const healthCheck = runCommand(
            `docker exec "${librechatContainer}" curl -s -f http://mcp-image-gen:3001/health`,
            true
          );
          if (healthCheck.success) {
            logSuccess('LibreChat can reach MCP Image Generation');
          } else {
            logError('LibreChat cannot reach MCP Image Generation');
            console.log('   Check Docker network configuration');
          }
        } else {
          logWarning('No HTTP client available in LibreChat container, skipping connectivity test');
        }
      } else {
        logWarning('LibreChat container not found, skipping connectivity test');
      }
    }
  } else {
    logWarning('Docker not available, skipping connectivity test');
  }
  console.log('');
}

async function testEnvironmentVariables(): Promise<void> {
  console.log('5. Checking environment variables...');
  const openRouterKey = process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    logSuccess('OPENROUTER_KEY is set');
  } else {
    logWarning('OPENROUTER_KEY is not set - image generation will not work');
  }
  console.log('');
}

async function main(): Promise<void> {
  console.log('🔍 MCP Image Generation Integration Test');
  console.log('========================================');
  console.log('');

  await testHealthEndpoint();
  await testDockerNetwork();
  await testLibreChatConfig();
  await testLibreChatConnectivity();
  await testEnvironmentVariables();

  console.log('========================================');
  logSuccess('Integration test completed');
  console.log('');
  console.log('Next steps:');
  console.log('1. Start LibreChat and verify MCP Image Generation appears in agent configuration');
  console.log('2. Create an agent and enable the image-gen MCP server');
  console.log('3. Test image generation in a chat conversation');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
