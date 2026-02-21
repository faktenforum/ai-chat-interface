/**
 * E2E test: document-creator workspace workflow
 *
 * Spawns the worker with a temp home, clones the document-creator workspace,
 * asserts plan/instructions/tasks (plan.md + tasks.json + instructions.md),
 * then simulates the document-creator agent by generating a minimal CV as PDF.
 *
 * Run from repo root: cd ai-chat-interface/packages/mcp-linux && node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings test/e2e-document-creator-workspace.ts
 * Or: npx tsx test/e2e-document-creator-workspace.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const DOCUMENT_CREATOR_REPO = 'git@github.com:faktenforum/workspace-document-creator.git';
const WORKSPACE_NAME = 'document-creator';
const SOCKET_WAIT_MS = 15000;
const REQUEST_TIMEOUT_MS = 120000; // clone can be slow

interface WorkerResponse {
  id: string;
  result?: unknown;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function sendRequest(socketPath: string, request: { id: string; method: string; params: Record<string, unknown> }): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath);
    let data = '';
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error(`Request timed out: ${request.method}`));
    }, REQUEST_TIMEOUT_MS);

    client.on('connect', () => {
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      const lines = data.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line) as WorkerResponse;
            clearTimeout(timeout);
            client.end();
            resolve(response);
            return;
          } catch {
            /* incomplete */
          }
        }
      }
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    client.on('close', () => {
      clearTimeout(timeout);
      if (!data.trim()) reject(new Error('Connection closed without response'));
    });
  });
}

function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Socket not available at ${socketPath} after ${timeoutMs}ms`));
        return;
      }
      if (existsSync(socketPath)) {
        const client = createConnection(socketPath);
        client.on('connect', () => {
          client.end();
          resolve();
        });
        client.on('error', () => setTimeout(check, 100));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function runE2E(): Promise<void> {
  const cwd = join(process.cwd());
  const homeDir = join(tmpdir(), `mcp-linux-e2e-${randomUUID()}`);
  const socketPath = join(homeDir, '.mcp-linux', 'socket');

  mkdirSync(join(homeDir, 'workspaces'), { recursive: true });

  const workerScript = join(cwd, 'src', 'worker.ts');
  const child: ChildProcess = spawn(
    'node',
    [
      '--experimental-specifier-resolution=node',
      '--experimental-strip-types',
      '--experimental-transform-types',
      '--no-warnings',
      workerScript,
      '--socket',
      socketPath,
      '--home',
      homeDir,
    ],
    {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: homeDir,
        USER: 'e2e',
        LOGNAME: 'e2e',
      },
    },
  );

  let workerExited = false;
  child.on('exit', (code) => {
    workerExited = true;
    if (code != null && code !== 0) console.error('Worker exited with code', code);
  });

  try {
    console.log('E2E: Waiting for worker socket...');
    await waitForSocket(socketPath, SOCKET_WAIT_MS);
    console.log('E2E: Worker ready');

    // 1) list_workspaces (should be empty or only default)
    const listRes = await sendRequest(socketPath, {
      id: '1',
      method: 'list_workspaces',
      params: {},
    });
    assert(!listRes.error, `list_workspaces error: ${listRes.error}`);
    const workspaces = (listRes.result as { workspaces: unknown[] })?.workspaces ?? [];
    console.log('E2E: list_workspaces ->', workspaces.length, 'workspace(s)');

    // 2) create_workspace (clone document-creator)
    console.log('E2E: Cloning document-creator workspace...');
    const createRes = await sendRequest(socketPath, {
      id: '2',
      method: 'create_workspace',
      params: {
        name: WORKSPACE_NAME,
        git_url: DOCUMENT_CREATOR_REPO,
        branch: 'main',
      },
    });
    assert(!createRes.error, `create_workspace error: ${createRes.error}`);
    console.log('E2E: create_workspace OK');

    // 3) get_workspace_status -> plan, tasks, instructions (new format)
    const statusRes = await sendRequest(socketPath, {
      id: '3',
      method: 'get_workspace_status',
      params: { workspace: WORKSPACE_NAME },
    });
    assert(!statusRes.error, `get_workspace_status error: ${statusRes.error}`);
    const status = statusRes.result as Record<string, unknown>;
    assert(status != null && typeof status === 'object', 'get_workspace_status result must be object');

    assert('instructions' in status, 'get_workspace_status must return instructions');
    const instructions = status.instructions as string | null | undefined;
    assert(
      typeof instructions === 'string' && instructions.length > 0,
      'instructions.md should be present and non-empty for document-creator workspace',
    );
    assert(
      instructions.includes('Document') || instructions.includes('Typst') || instructions.includes('PDF'),
      'instructions should contain document-creation guidance',
    );
    console.log('E2E: get_workspace_status -> instructions length', instructions.length);

    assert('plan' in status, 'get_workspace_status must return plan');
    assert(Array.isArray(status.tasks), 'get_workspace_status must return tasks array');
    console.log('E2E: plan/tasks format OK (plan:', status.plan === null ? 'null' : 'string', ', tasks:', (status.tasks as unknown[]).length, ')');

    // 4) Document-creator agent: create minimal CV and compile to PDF
    const minimalTypst = `#set document(title: "CV", author: "E2E Test")
#show strong: set text(weight: "bold")
= Curriculum Vitae
*E2E Test*

#lorem(20)
`;
    const base64Content = Buffer.from(minimalTypst, 'utf-8').toString('base64');
    const writeCmd = `echo ${base64Content} | base64 -d > cv.typ`;
    const execRes = await sendRequest(socketPath, {
      id: '4',
      method: 'execute_command',
      params: {
        workspace: WORKSPACE_NAME,
        command: writeCmd,
        timeout_ms: 10000,
      },
    });
    assert(!execRes.error, `execute_command (write cv.typ) error: ${execRes.error}`);
    console.log('E2E: cv.typ write command sent');

    // Verify cv.typ exists (worker does not return exit_code; use test -f)
    const checkRes = await sendRequest(socketPath, {
      id: '4b',
      method: 'execute_command',
      params: { workspace: WORKSPACE_NAME, command: 'test -f cv.typ && echo OK', timeout_ms: 5000 },
    });
    assert(!checkRes.error, `check cv.typ error: ${checkRes.error}`);
    const checkOutput = (checkRes.result as { output?: string })?.output ?? '';
    assert(checkOutput.includes('OK'), `cv.typ should exist: ${checkOutput}`);
    console.log('E2E: cv.typ created and verified');

    const hasTypst = await (async () => {
      const whichRes = await sendRequest(socketPath, {
        id: '4c',
        method: 'execute_command',
        params: { workspace: WORKSPACE_NAME, command: 'which typst 2>/dev/null || true', timeout_ms: 5000 },
      });
      if (whichRes.error) return false;
      const out = (whichRes.result as { output?: string })?.output ?? '';
      return out.trim().length > 0;
    })();

    if (hasTypst) {
      const compileRes = await sendRequest(socketPath, {
        id: '5',
        method: 'execute_command',
        params: {
          workspace: WORKSPACE_NAME,
          command: 'typst compile cv.typ cv.pdf',
          timeout_ms: 15000,
        },
      });
      assert(!compileRes.error, `typst compile error: ${compileRes.error}`);
      console.log('E2E: typst compile command sent');

      const lsRes = await sendRequest(socketPath, {
        id: '6',
        method: 'execute_command',
        params: { workspace: WORKSPACE_NAME, command: 'test -f cv.pdf && echo OK', timeout_ms: 5000 },
      });
      assert(!lsRes.error && ((lsRes.result as { output?: string })?.output ?? '').includes('OK'), 'cv.pdf should exist');
      console.log('E2E: cv.pdf present');
    } else {
      console.log('E2E: typst not installed, skipping PDF compile (cv.typ was created)');
    }

    console.log('\n=== E2E document-creator workspace: all checks passed ===');
  } finally {
    if (!workerExited && child.pid) {
      child.kill('SIGTERM');
    }
    try {
      rmSync(homeDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup */
    }
  }
}

runE2E().catch((err) => {
  console.error('E2E failed:', err);
  process.exit(1);
});
