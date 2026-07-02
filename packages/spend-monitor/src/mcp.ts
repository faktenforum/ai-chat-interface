/**
 * Spend-monitor MCP server.
 *
 * Exposes the org spend dashboard as an MCP-UI resource and a balance-restore
 * action for admins. Access is gated in server.ts by the X-User-Email allowlist.
 */

import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod';
import type { Config } from './config.ts';
import type { Snapshot } from './aggregate.ts';
import type { EnforceState } from './enforce.ts';
import { restoreBalances } from './enforce.ts';
import { renderMcpUi } from './page.ts';
import { logger } from './utils/logger.ts';

const SERVER_NAME = 'spend-monitor-mcp';
const SERVER_VERSION = '1.0.0';

/** Live accessors into the running server's state. */
export interface McpDeps {
  getSnapshot: () => Snapshot | null;
  getEnforceState: () => EnforceState;
  refresh: () => Promise<void>;
  cfg: Config;
  db: Db;
}

function uiResource(uri: string, html: string) {
  return { type: 'resource' as const, resource: { uri, mimeType: 'text/html' as const, text: html } };
}

function textResult(obj: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }], isError };
}

function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        'Org-wide LibreChat spend monitor (admins only). get_usage_report returns the current ' +
        'spend dashboard as an interactive UI resource - place its marker (\\ui{id}) in your reply. ' +
        'restore_balances lifts an active spending freeze and restores user balances.',
    },
  );

  server.registerTool(
    'get_usage_report',
    {
      description:
        'Get the current org-wide LibreChat spend report (total vs budget, per provider, per model, top users) ' +
        'and enforcement state. Includes a dashboard UI resource - place its marker (\\ui{id}) in your reply.',
      inputSchema: {},
    },
    async () => {
      try {
        let snap = deps.getSnapshot();
        if (!snap) {
          await deps.refresh();
          snap = deps.getSnapshot();
        }
        if (!snap) {
          return textResult({ error: 'No spend data available yet. Try again shortly.' }, true);
        }
        const enforcement = deps.getEnforceState();
        const summary = {
          period: snap.period,
          period_start: snap.periodStart,
          budget_usd: snap.budgetUsd,
          spent_usd: snap.spentUsd,
          used_ratio: snap.usedRatio,
          level: snap.level,
          eur: snap.eur,
          enforce: deps.cfg.enforce,
          enforcement: { active: enforcement.active, since: enforcement.since, reason: enforcement.reason },
          by_provider: snap.byProvider,
          top_users: snap.topUsers.slice(0, 5),
          updated_at: snap.updatedAt,
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(summary, null, 2) },
            uiResource('ui://spend-monitor/report', renderMcpUi(snap, deps.cfg.enforce, enforcement)),
          ],
        };
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'get_usage_report failed');
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  server.registerTool(
    'restore_balances',
    {
      description:
        'Lift an active spending freeze and restore all user balances from the pre-freeze snapshot. ' +
        'Suppresses re-enforcement for the current period. Requires confirm: true.',
      inputSchema: {
        confirm: z.boolean().describe('Must be true to lift the freeze and restore balances'),
      },
    },
    async (args) => {
      try {
        if (!args.confirm) {
          return textResult({ error: 'Must pass confirm: true to restore balances.' }, true);
        }
        if (deps.cfg.enforce === 'off') {
          return textResult({ error: 'Enforcement is disabled (SPEND_MONITOR_ENFORCE=off); nothing to restore.' }, true);
        }
        const snap = deps.getSnapshot();
        const dryRun = deps.cfg.enforce !== 'on';
        const result = await restoreBalances(deps.db, dryRun, snap?.periodStart ?? null);
        await deps.refresh();
        return textResult({
          restored: result.restored,
          dry_run: dryRun,
          suppressed_for_period: snap?.periodStart ?? null,
        });
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'restore_balances failed');
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  return server;
}

/** Creates a new MCP session (server + transport) registered in the transport map. */
export function createSession(
  deps: McpDeps,
  transports: Map<string, StreamableHTTPServerTransport>,
): { server: McpServer; transport: StreamableHTTPServerTransport } {
  const server = createMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId: string) => {
      logger.info({ sessionId, totalSessions: transports.size + 1 }, 'MCP session initialized');
      transports.set(sessionId, transport);
    },
  });

  server.server.onclose = async () => {
    const sid = transport.sessionId;
    if (sid && transports.has(sid)) {
      logger.info({ sessionId: sid, totalSessions: transports.size - 1 }, 'MCP session closed');
      transports.delete(sid);
    }
  };

  return { server, transport };
}
