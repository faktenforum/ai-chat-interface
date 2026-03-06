/**
 * Terminal handler - manages PTY sessions and terminal-related request handlers.
 */

import fs from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateTerminalId } from '../utils/security.ts';
import { stripAnsi } from '../utils/strip-ansi.ts';
import { escapeForDoubleQuotedShell, getGitMetadata } from './git-utils.ts';
import { resolveWorkspacePath } from './workspace-utils.ts';
import {
  TERMINAL_BUFFER_LIMIT,
  TERMINAL_COLS,
  TERMINAL_ROWS,
  EXECUTE_SETTLE_MS,
  WRITE_SETTLE_MS,
  SETTLE_CHECK_INTERVAL_MS,
  CWD_DETECT_TIMEOUT_MS,
} from './constants.ts';
import type { TerminalSession, Handler, WorkerContext } from './types.ts';

/**
 * Waits for terminal output to settle (no new data for `settleMs`),
 * or until `timeoutMs` is reached.
 */
function waitForOutput(
  session: TerminalSession,
  timeoutMs: number,
  settleMs: number = EXECUTE_SETTLE_MS,
): Promise<void> {
  let lastOutputLength = session.output.length;
  const start = Date.now();
  let settled = 0;

  return new Promise<void>((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        resolve();
        return;
      }
      if (session.output.length !== lastOutputLength) {
        lastOutputLength = session.output.length;
        settled = 0;
      } else {
        settled += SETTLE_CHECK_INTERVAL_MS;
      }
      if (settled >= settleMs) {
        resolve();
        return;
      }
      setTimeout(check, SETTLE_CHECK_INTERVAL_MS);
    };
    setTimeout(check, SETTLE_CHECK_INTERVAL_MS);
  });
}

export function createTerminalHandlers(ctx: WorkerContext): {
  handlers: Record<string, Handler>;
  shutdownTerminals: () => void;
} {
  const terminals = new Map<string, TerminalSession>();

  let ptyModule: typeof import('node-pty') | null = null;

  async function getPty(): Promise<typeof import('node-pty')> {
    if (!ptyModule) {
      ptyModule = await import('node-pty');
    }
    return ptyModule;
  }

  async function createTerminal(workspace: string, terminalId?: string): Promise<string> {
    const pty = await getPty();
    const id = terminalId || randomUUID().slice(0, 8);

    if (terminalId) {
      const error = validateTerminalId(terminalId);
      if (error) throw new Error(error);
    }

    const cwd = resolveWorkspacePath(ctx.workspacesDir, workspace);

    try {
      await fs.access(cwd);
    } catch {
      throw new Error(`Workspace directory does not exist: ${workspace}`);
    }

    const shell = pty.spawn('/bin/bash', ['--login'], {
      name: 'xterm-256color',
      cols: TERMINAL_COLS,
      rows: TERMINAL_ROWS,
      cwd,
      env: {
        HOME: ctx.homeDir,
        USER: process.env.USER || '',
        LOGNAME: process.env.LOGNAME || '',
        SHELL: '/bin/bash',
        TERM: 'xterm-256color',
        PATH: `${ctx.homeDir}/.local/bin:${process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}`,
        LANG: 'en_US.UTF-8',
      },
    });

    const session: TerminalSession = {
      id,
      pty: shell,
      output: [],
      totalLength: 0,
      workspace,
      createdAt: Date.now(),
    };

    shell.onData((data: string) => {
      session.output.push(data);
      session.totalLength += data.length;

      // Limit buffer
      while (session.totalLength > TERMINAL_BUFFER_LIMIT && session.output.length > 1) {
        const removed = session.output.shift()!;
        session.totalLength -= removed.length;
      }
    });

    shell.onExit(() => {
      terminals.delete(id);
    });

    terminals.set(id, session);
    return id;
  }

  const handlers: Record<string, Handler> = {

    async execute_command(params) {
      const rawCommand = (params.command as string) || '';
      const workspace = (params.workspace as string) || 'default';
      const timeoutMs = (params.timeout_ms as number) || 30000;
      let terminalId = params.terminal_id as string | undefined;

      if (terminalId) {
        const error = validateTerminalId(terminalId);
        if (error) throw new Error(error);
      }

      const workspaceRoot = resolveWorkspacePath(ctx.workspacesDir, workspace);
      const quotedRoot = '"' + escapeForDoubleQuotedShell(workspaceRoot) + '"';
      const wrappedCommand =
        rawCommand.trim() === ''
          ? `cd ${quotedRoot}`
          : `cd ${quotedRoot} && ${rawCommand}`;

      // Create or reuse terminal
      if (terminalId && terminals.has(terminalId)) {
        // Reuse existing terminal
      } else {
        terminalId = await createTerminal(workspace, terminalId);
      }

      const session = terminals.get(terminalId)!;
      const outputBefore = session.output.length;

      // Run user command (always in workspace root)
      session.pty.write(wrappedCommand + '\n');
      await waitForOutput(session, timeoutMs);

      const newOutput = session.output.slice(outputBefore).join('');

      // Get current working directory via temp file (no pollution of user output)
      const cwdFile = join(ctx.homeDir, '.mcp_cwd_' + terminalId + '.txt');
      const cwdCmd = `pwd > "${escapeForDoubleQuotedShell(cwdFile)}" 2>/dev/null\n`;
      session.pty.write(cwdCmd);
      await waitForOutput(session, CWD_DETECT_TIMEOUT_MS);

      let cwd = workspaceRoot;
      try {
        cwd = (await fs.readFile(cwdFile, 'utf-8')).trim() || workspaceRoot;
        await fs.unlink(cwdFile);
      } catch {
        // Keep workspaceRoot as fallback
      }

      const cwdRelative =
        cwd === workspaceRoot ? '' : relative(workspaceRoot, cwd).replace(/^\//, '') || '';

      const meta = await getGitMetadata(ctx.workspacesDir, workspace);

      return {
        terminal_id: terminalId,
        output: stripAnsi(newOutput),
        workspace,
        cwd,
        cwd_relative_to_workspace: cwdRelative || undefined,
        ...meta,
      };
    },

    async read_terminal_output(params) {
      const terminalId = params.terminal_id as string;
      const offset = (params.offset as number) || 0;
      const length = (params.length as number) || undefined;

      const error = validateTerminalId(terminalId);
      if (error) throw new Error(error);

      const session = terminals.get(terminalId);
      if (!session) {
        throw new Error(`Terminal ${terminalId} not found`);
      }

      const fullOutput = session.output.join('');
      const slice = length ? fullOutput.slice(offset, offset + length) : fullOutput.slice(offset);
      const meta = await getGitMetadata(ctx.workspacesDir, session.workspace);

      return {
        terminal_id: terminalId,
        output: stripAnsi(slice),
        total_length: fullOutput.length,
        ...meta,
      };
    },

    async write_terminal(params) {
      const terminalId = params.terminal_id as string;
      const input = params.input as string;
      const timeoutMs = (params.timeout_ms as number) || 5000;

      const error = validateTerminalId(terminalId);
      if (error) throw new Error(error);

      const session = terminals.get(terminalId);
      if (!session) {
        throw new Error(`Terminal ${terminalId} not found`);
      }

      const outputBefore = session.output.length;
      session.pty.write(input);

      await waitForOutput(session, timeoutMs, WRITE_SETTLE_MS);

      const newOutput = session.output.slice(outputBefore).join('');
      const meta = await getGitMetadata(ctx.workspacesDir, session.workspace);

      return {
        terminal_id: terminalId,
        output: stripAnsi(newOutput),
        ...meta,
      };
    },

    async list_terminals() {
      const result: Array<{
        terminal_id: string;
        workspace: string;
        created_at: number;
        output_length: number;
      }> = [];

      for (const [id, session] of terminals) {
        result.push({
          terminal_id: id,
          workspace: session.workspace,
          created_at: session.createdAt,
          output_length: session.totalLength,
        });
      }

      return { terminals: result };
    },

    async kill_terminal(params) {
      const terminalId = params.terminal_id as string;
      const error = validateTerminalId(terminalId);
      if (error) throw new Error(error);

      const session = terminals.get(terminalId);
      if (!session) {
        throw new Error(`Terminal ${terminalId} not found`);
      }

      session.pty.kill();
      terminals.delete(terminalId);
      return { killed: terminalId };
    },
  };

  function shutdownTerminals(): void {
    for (const [, session] of terminals) {
      try { session.pty.kill(); } catch { /* ignore */ }
    }
    terminals.clear();
  }

  return { handlers, shutdownTerminals };
}
