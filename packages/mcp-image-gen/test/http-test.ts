#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import http from 'http';
import type { IncomingHttpHeaders } from 'http';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || 'localhost';

interface HttpResponse {
  status: number;
  data: unknown;
  rawData: string;
  headers: IncomingHttpHeaders;
}

interface TestResults {
  passed: number;
  failed: number;
  total: number;
}

let sessionId: string | null = null;
const testResults: TestResults = {
  passed: 0,
  failed: 0,
  total: 0
};

function makeRequest(
  method: string,
  path: string,
  data: unknown = null,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: HOST,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      if (res.headers['mcp-session-id']) {
        sessionId = res.headers['mcp-session-id'] as string;
      } else if (res.headers['Mcp-Session-Id']) {
        sessionId = res.headers['Mcp-Session-Id'] as string;
      }

      res.on('data', (chunk: Buffer) => {
        responseData += chunk.toString();
      });

      res.on('end', () => {
        let parsedData: unknown;
        try {
          parsedData = JSON.parse(responseData);
        } catch {
          parsedData = responseData;
        }
        resolve({ 
          status: res.statusCode || 0, 
          data: parsedData, 
          rawData: responseData,
          headers: res.headers 
        });
      });
    });

    req.on('error', (error: Error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

function logTest(testName: string, passed: boolean, details: string = ''): void {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${testName}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${testName}`);
  }
  if (details) {
    console.log(`   ${details}`);
  }
}

async function runTests(): Promise<void> {
  console.log('🧪 Testing MCP Image Generation Server...\n');
  console.log(`📍 Testing server at ${HOST}:${PORT}\n`);

  try {
    // Test 1: Health check
    console.log('1️⃣ Testing health check...');
    try {
      const response = await makeRequest('GET', '/health');
      const healthData = response.data as { status?: string; server?: string };
      const passed = response.status === 200 && healthData?.status === 'ok';
      logTest('Health check', passed, `Status: ${response.status}, Server: ${healthData?.server || 'N/A'}`);
    } catch (error) {
      const err = error as Error;
      logTest('Health check', false, `Error: ${err.message}`);
    }

    // Test 2: Initialize request
    console.log('\n2️⃣ Testing initialize request...');
    try {
      const initResponse = await makeRequest('POST', '/mcp', {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        },
        id: 1
      });
      
      const initData = initResponse.data as { result?: unknown };
      const passed = initResponse.status === 200 && 
                     sessionId !== null && 
                     initData?.result !== undefined;
      logTest('Initialize request', passed, 
        passed ? `Session ID: ${sessionId?.substring(0, 8)}...` : 
        `Status: ${initResponse.status}`);
    } catch (error) {
      const err = error as Error;
      logTest('Initialize request', false, `Error: ${err.message}`);
    }

    if (!sessionId) {
      console.log('\n⚠️  No session ID received. Cannot continue with session-dependent tests.');
      console.log('\n📊 Test Summary:');
      console.log(`   Total: ${testResults.total}, Passed: ${testResults.passed}, Failed: ${testResults.failed}`);
      process.exit(testResults.failed > 0 ? 1 : 0);
    }

    // Test 3: List tools
    console.log('\n3️⃣ Testing tools/list request...');
    try {
      const response = await makeRequest('POST', '/mcp', {
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 2
      }, {
        'mcp-session-id': sessionId
      });
      
      const toolsData = response.data as { result?: { tools?: Array<{ name: string }> } };
      const passed = response.status === 200 && 
                     toolsData?.result?.tools !== undefined;
      const toolCount = toolsData?.result?.tools?.length || 0;
      logTest('List tools', passed, 
        passed ? `Found ${toolCount} tools` : `Status: ${response.status}`);
      
      if (passed && toolCount > 0 && toolsData.result?.tools) {
        const toolNames = toolsData.result.tools.map(t => t.name).join(', ');
        console.log(`   Tools: ${toolNames}`);
      }
    } catch (error) {
      const err = error as Error;
      logTest('List tools', false, `Error: ${err.message}`);
    }

    // Test 4: List known models
    console.log('\n4️⃣ Testing list_known_models tool...');
    try {
      const response = await makeRequest('POST', '/mcp', {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'list_known_models',
          arguments: {}
        },
        id: 3
      }, {
        'mcp-session-id': sessionId
      });
      
      const toolData = response.data as { result?: unknown };
      const passed = response.status === 200 && 
                     toolData?.result !== undefined;
      logTest('List known models', passed, 
        passed ? 'Models listed successfully' : `Status: ${response.status}`);
    } catch (error) {
      const err = error as Error;
      logTest('List known models', false, `Error: ${err.message}`);
    }

  } catch (error) {
    console.error('\n❌ Fatal error during tests:', error);
    testResults.failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary:');
  console.log(`   Total: ${testResults.total}`);
  console.log(`   ✅ Passed: ${testResults.passed}`);
  console.log(`   ❌ Failed: ${testResults.failed}`);
  console.log('='.repeat(50));

  process.exit(testResults.failed > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
