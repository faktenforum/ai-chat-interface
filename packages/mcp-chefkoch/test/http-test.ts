#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import http from 'node:http';

const PORT = parseInt(process.env.PORT || '3014', 10);
const HOST = process.env.HOST || 'localhost';

function get(path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: HOST, port: PORT, path, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function main(): Promise<void> {
  try {
    const { statusCode, body } = await get('/health');
    if (statusCode !== 200) {
      console.error('Health check failed:', statusCode, body);
      process.exit(1);
    }
    const data = JSON.parse(body);
    if (data.status !== 'ok' || data.server !== 'mcp-chefkoch') {
      console.error('Invalid health response:', data);
      process.exit(1);
    }
    console.log('Health check OK:', data);
  } catch (e) {
    console.error('Request failed:', e);
    process.exit(1);
  }
}

main();
