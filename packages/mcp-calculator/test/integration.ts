#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Script is in packages/mcp-calculator/test, so go up 2 levels to get workspace root
const WORKSPACE_ROOT = join(__dirname, '../..');

// Colors for terminal output
const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const YELLOW = '\u001b[1;33m';
const NC = '\u001b[0m'; // No Color

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
  const result = runCommand('curl -s -f http://localhost:3000/health', true);
  if (result.success) {
    logSuccess('Health endpoint is accessible');
    const healthResult = runCommand('curl -s http://localhost:3000/health', true);
    if (healthResult.success) {
      // Try to format with jq if available, otherwise try to parse and format JSON
      if (commandExists('jq')) {
        const jqResult = runCommand(`echo '${healthResult.output.replace(/'/g, "'\\''")}' | jq .`, true);
        if (jqResult.success) {
          console.log(jqResult.output);
        } else {
          console.log(healthResult.output);
        }
      } else {
        // Try to parse and format JSON manually
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
        c.includes('mcp-calculator') || c.includes('prod-mcp-calculator')
      );
      
      if (mcpContainer) {
        logSuccess(`MCP Calculator container is running: ${mcpContainer}`);
        const ipResult = runCommand(
          `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${mcpContainer}"`,
          true
        );
        if (ipResult.success && ipResult.output) {
          console.log(`   Container IP: ${ipResult.output}`);
        }
      } else {
        logWarning('MCP Calculator container is not running');
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
    const grepResult = runCommand(`grep -q "mcp-calculator" "${librechatConfig}"`, true);
    if (grepResult.success) {
      logSuccess('MCP Calculator is configured in LibreChat');
      const typeResult = runCommand(
        `grep -A 5 "calculator:" "${librechatConfig}" | grep -q "type: streamable-http"`,
        true
      );
      if (typeResult.success) {
        logSuccess('Streamable HTTP transport is configured');
      } else {
        logError('Streamable HTTP transport not found in configuration');
      }
    } else {
      logError('MCP Calculator not found in LibreChat configuration');
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
        // Check if curl is available
        const curlCheck = runCommand(
          `docker exec "${librechatContainer}" sh -c "command -v curl >/dev/null 2>&1"`,
          true
        );
        
        if (curlCheck.success) {
          const healthCheck = runCommand(
            `docker exec "${librechatContainer}" curl -s -f http://mcp-calculator:3000/health`,
            true
          );
          if (healthCheck.success) {
            logSuccess('LibreChat can reach MCP Calculator');
          } else {
            logError('LibreChat cannot reach MCP Calculator');
            console.log('   Check Docker network configuration');
          }
        } else {
          // Try wget
          const wgetCheck = runCommand(
            `docker exec "${librechatContainer}" sh -c "command -v wget >/dev/null 2>&1"`,
            true
          );
          if (wgetCheck.success) {
            const healthCheck = runCommand(
              `docker exec "${librechatContainer}" wget -q -O- --timeout=5 http://mcp-calculator:3000/health`,
              true
            );
            if (healthCheck.success) {
              logSuccess('LibreChat can reach MCP Calculator');
            } else {
              logError('LibreChat cannot reach MCP Calculator');
              console.log('   Check Docker network configuration');
            }
          } else {
            logWarning('No HTTP client available in LibreChat container, skipping connectivity test');
          }
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

async function testLogs(): Promise<void> {
  console.log('5. Checking for errors in logs...');
  if (commandExists('docker')) {
    const containersResult = runCommand('docker ps --format "{{.Names}}"', true);
    if (containersResult.success) {
      const containers = containersResult.output.split('\n');
      const mcpContainer = containers.find(c => 
        c.includes('mcp-calculator') || c.includes('prod-mcp-calculator')
      );
      
      if (mcpContainer) {
        const logsResult = runCommand(`docker logs "${mcpContainer}" 2>&1`, true);
        if (logsResult.success) {
          // Count errors (excluding log level messages)
          const errorLines = logsResult.output
            .split('\n')
            .filter(line => 
              line.toLowerCase().includes('error') && 
              !line.match(/level.*error/i)
            );
          const errorCount = errorLines.length;
          
          if (errorCount === 0) {
            logSuccess('No errors found in logs');
          } else {
            logWarning(`Found ${errorCount} error(s) in logs`);
            console.log(`   Check with: docker logs ${mcpContainer}`);
          }
        }
      } else {
        logWarning('MCP Calculator container not running, skipping log check');
      }
    }
  } else {
    logWarning('Docker not available, skipping log check');
  }
  console.log('');
}

async function testHttpApi(): Promise<void> {
  console.log('6. Running HTTP API tests with session management...');
  const httpTestScript = join(__dirname, 'http-test.ts');
  
  if (existsSync(httpTestScript)) {
    if (commandExists('node')) {
      // Check if server is accessible
      const healthCheck = runCommand('curl -s -f http://localhost:3000/health', true);
      if (healthCheck.success) {
        console.log('   Running HTTP API tests...');
        console.log('');
        const testResult = runCommand(`node "${httpTestScript}"`, true);
        if (testResult.success) {
          logSuccess('HTTP API tests passed');
        } else {
          logWarning('HTTP API tests failed (see output above)');
        }
      } else {
        logWarning('Server not accessible, skipping HTTP API tests');
        console.log('   Start the server first: npm run dev (in packages/mcp-calculator)');
      }
    } else {
      logWarning('Node.js not available, skipping HTTP API tests');
    }
  } else {
    logWarning(`HTTP test script not found: ${httpTestScript}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  console.log('🔍 MCP Calculator Integration Test');
  console.log('==================================');
  console.log('');

  await testHealthEndpoint();
  await testDockerNetwork();
  await testLibreChatConfig();
  await testLibreChatConnectivity();
  await testLogs();
  await testHttpApi();

  console.log('==================================');
  logSuccess('Integration test completed');
  console.log('');
  console.log('Next steps:');
  console.log('1. Start LibreChat and verify MCP Calculator appears in agent configuration');
  console.log('2. Create an agent and enable the calculator MCP server');
  console.log('3. Test calculations in a chat conversation');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
