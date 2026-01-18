#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import http from 'http';
import type { IncomingHttpHeaders } from 'http';

// Test configuration
const PORT = parseInt(process.env.PORT || '3000', 10);
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

// Helper function to make HTTP requests
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

      // Capture session ID from response headers (check both lowercase and capitalized)
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
  console.log('🧪 Testing MCP Streamable HTTP Server with Session Management...\n');
  console.log(`📍 Testing server at ${HOST}:${PORT}\n`);

  try {
    // Test 1: Health check
    console.log('1️⃣ Testing health check...');
    try {
      const response = await makeRequest('GET', '/health');
      const healthData = response.data as { status?: string; server?: string };
      const passed = response.status === 200 && healthData?.status === 'ok';
      logTest('Health check', passed, `Status: ${response.status}, Server: ${healthData?.server || 'N/A'}`);
      if (!passed) {
        console.log(`   Response:`, JSON.stringify(response.data, null, 2));
      }
    } catch (error) {
      const err = error as Error;
      logTest('Health check', false, `Error: ${err.message}`);
    }

    // Test 2: Initialize request (should create new session)
    console.log('\n2️⃣ Testing initialize request (creating new session)...');
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
        `Status: ${initResponse.status}, Session ID received: ${sessionId !== null}`);
      
      if (!passed) {
        console.log(`   Response:`, JSON.stringify(initResponse.data, null, 2));
      }
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

    // Test 3: List tools (with session ID)
    console.log('\n3️⃣ Testing tools/list request (with session ID)...');
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

    // Test 4: Call a calculator tool (add) with session ID
    console.log('\n4️⃣ Testing tool call (add) with session ID...');
    try {
      const response = await makeRequest('POST', '/mcp', {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'add',
          arguments: {
            a: 42,
            b: 8
          }
        },
        id: 3
      }, {
        'mcp-session-id': sessionId
      });
      
      const toolData = response.data as { result?: unknown };
      const passed = response.status === 200 && 
                     toolData?.result !== undefined;
      logTest('Call add tool', passed, 
        passed ? `Result: ${JSON.stringify(toolData.result)}` : 
        `Status: ${response.status}`);
    } catch (error) {
      const err = error as Error;
      logTest('Call add tool', false, `Error: ${err.message}`);
    }

    // Test 5: Try without session ID (should fail)
    console.log('\n5️⃣ Testing request without session ID (should fail)...');
    try {
      const response = await makeRequest('POST', '/mcp', {
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 4
      });
      
      const errorData = response.data as { error?: { message?: string } };
      // Should fail with 400 or error response
      const passed = response.status === 400 || 
                     (errorData?.error !== undefined && 
                      (errorData.error.message?.includes('session') ?? false));
      logTest('Request without session ID (should fail)', passed, 
        passed ? `Correctly rejected: ${errorData?.error?.message || 'Bad Request'}` : 
        `Unexpected success: Status ${response.status}`);
    } catch (error) {
      const err = error as Error;
      logTest('Request without session ID', false, `Error: ${err.message}`);
    }

    // Test 6: Test SSE stream endpoint
    console.log('\n6️⃣ Testing SSE stream endpoint...');
    try {
      const response = await makeRequest('GET', '/mcp', null, {
        'mcp-session-id': sessionId
      });
      
      // SSE endpoint might return 200 with text/event-stream or specific content
      const passed = response.status === 200 || response.status === 204;
      logTest('SSE stream endpoint', passed, 
        `Status: ${response.status}, Content-Type: ${response.headers['content-type'] || 'N/A'}`);
    } catch (error) {
      const err = error as Error;
      logTest('SSE stream endpoint', false, `Error: ${err.message}`);
    }

    // Test 7: Call get_history tool
    console.log('\n7️⃣ Testing get_history tool...');
    try {
      const response = await makeRequest('POST', '/mcp', {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_history',
          arguments: {
            limit: 5
          }
        },
        id: 5
      }, {
        'mcp-session-id': sessionId
      });
      
      const historyData = response.data as { result?: unknown };
      const passed = response.status === 200 && 
                     historyData?.result !== undefined;
      logTest('Call get_history tool', passed, 
        passed ? 'History retrieved successfully' : `Status: ${response.status}`);
    } catch (error) {
      const err = error as Error;
      logTest('Call get_history tool', false, `Error: ${err.message}`);
    }

    // Test 8: Terminate session
    console.log('\n8️⃣ Testing session termination...');
    try {
      const response = await makeRequest('DELETE', '/mcp', null, {
        'mcp-session-id': sessionId
      });
      
      const passed = response.status === 200 || response.status === 204;
      logTest('Session termination', passed, `Status: ${response.status}`);
    } catch (error) {
      const err = error as Error;
      logTest('Session termination', false, `Error: ${err.message}`);
    }

    // Test 9: Try to use terminated session (should fail)
    console.log('\n9️⃣ Testing request with terminated session (should fail)...');
    try {
      const response = await makeRequest('POST', '/mcp', {
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 6
      }, {
        'mcp-session-id': sessionId
      });
      
      const errorData = response.data as { error?: { message?: string } };
      // Should fail with 404 or error response
      const passed = response.status === 404 || 
                     (errorData?.error !== undefined && 
                      (errorData.error.message?.includes('Session') ?? false));
      logTest('Request with terminated session (should fail)', passed, 
        passed ? `Correctly rejected: ${errorData?.error?.message || 'Not Found'}` : 
        `Unexpected success: Status ${response.status}`);
    } catch (error) {
      const err = error as Error;
      logTest('Request with terminated session', false, `Error: ${err.message}`);
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

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
