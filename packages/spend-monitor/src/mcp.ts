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
import { findUserIdByEmail, resetUserLimit } from './users.ts';
import { effectiveConfig, updateSettings } from './settings.ts';
import { PERIODS } from './config.ts';
import type { Period } from './config.ts';
import { renderMcpUi } from './page.ts';
import { logger } from './utils/logger.ts';

const SERVER_NAME = 'spend-monitor-mcp';
const SERVER_VERSION = '1.0.0';

/** Live accessors into the running server's state. */
export interface McpDeps {
  getSnapshot: () => Snapshot | null;
  getEnforceState: () => EnforceState;
  /** Re-aggregates and applies enforcement; resolves true when the freeze state flipped. */
  refresh: () => Promise<boolean>;
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
        'restore_balances lifts an active spending freeze and restores user balances. ' +
        'reset_user_limit gives one user their per-period allowance back immediately. ' +
        'set_org_budget changes the org-wide budget and accounting period without a redeploy.',
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
        const effective = await effectiveConfig(deps.db, deps.cfg);
        const summary = {
          period: snap.period,
          period_start: snap.periodStart,
          period_reset_at: snap.periodResetAt,
          budget_usd: snap.budgetUsd,
          spent_usd: snap.spentUsd,
          used_ratio: snap.usedRatio,
          level: snap.level,
          eur: snap.eur,
          enforce: deps.cfg.enforce,
          enforcement: { active: enforcement.active, since: enforcement.since, reason: enforcement.reason },
          settings: {
            budget_usd: effective.budgetUsd,
            period: effective.period,
            overridden: effective.overridden,
            env_defaults: { budget_usd: deps.cfg.budgetUsd, period: deps.cfg.period },
          },
          by_provider: snap.byProvider,
          top_users: snap.users.slice(0, 5).map((u) => ({
            email: u.email,
            spent_usd: u.usd,
            credits_left_usd: u.balanceUsd,
            next_refill_at: u.nextRefillAt,
            refill_due: u.refillDue,
          })),
          updated_at: snap.updatedAt,
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(summary, null, 2) },
            uiResource(
              'ui://spend-monitor/report',
              renderMcpUi(snap, deps.cfg.enforce, enforcement, effective, deps.cfg),
            ),
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

  server.registerTool(
    'reset_user_limit',
    {
      description:
        "Give one user their per-period spending allowance back immediately: sets their LibreChat " +
        'balance to the configured refill amount and restarts their refill interval. Defaults to ' +
        "the user's own refill amount; pass credits_usd to set a different figure. Requires confirm: true.",
      inputSchema: {
        email: z.string().describe('Login email of the user whose limit should be reset'),
        confirm: z.boolean().describe('Must be true to write the new balance'),
        credits_usd: z
          .number()
          .positive()
          .optional()
          .describe('Balance to set in USD (default: the user\'s configured refill amount)'),
      },
    },
    async (args) => {
      try {
        if (!args.confirm) {
          return textResult({ error: 'Must pass confirm: true to reset a user limit.' }, true);
        }
        if (deps.getEnforceState().active) {
          return textResult(
            { error: 'Org freeze is active - balances are re-zeroed every poll. Restore balances first.' },
            true,
          );
        }
        const userId = await findUserIdByEmail(deps.db, args.email);
        if (!userId) {
          return textResult({ error: `No LibreChat user with email ${args.email}.` }, true);
        }
        const result = await resetUserLimit(deps.db, userId, args.credits_usd ?? null, false);
        await deps.refresh();
        return textResult({
          email: result.email,
          credits_usd: result.creditsUsd,
          previous_usd: result.previousUsd,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message, email: args.email }, 'reset_user_limit failed');
        return textResult({ error: message }, true);
      }
    },
  );

  server.registerTool(
    'set_org_budget',
    {
      description:
        'Change the org-wide spend budget and/or the accounting period without a redeploy. ' +
        'Pass budget_usd and/or period; pass reset: true to drop the overrides and fall back to ' +
        'the deployment defaults. Requires confirm: true. Lowering the budget below current ' +
        'spend freezes every user on the next poll when enforcement is on.',
      inputSchema: {
        confirm: z.boolean().describe('Must be true to write the new settings'),
        budget_usd: z.number().positive().optional().describe('New org budget in USD'),
        period: z
          .enum(PERIODS)
          .optional()
          .describe('Accounting window: calendar-month, calendar-week, rolling-30d or rolling-7d'),
        reset: z
          .boolean()
          .optional()
          .describe('Drop both overrides and use the deployment defaults again'),
      },
    },
    async (args) => {
      try {
        if (!args.confirm) {
          return textResult({ error: 'Must pass confirm: true to change the budget.' }, true);
        }
        const reset = args.reset === true;
        if (!reset && args.budget_usd == null && args.period == null) {
          return textResult(
            { error: 'Nothing to change: pass budget_usd and/or period, or reset: true.' },
            true,
          );
        }
        const applied = await updateSettings(
          deps.db,
          deps.cfg,
          reset
            ? { budgetUsd: null, period: null }
            : {
                ...(args.budget_usd != null ? { budgetUsd: args.budget_usd } : {}),
                ...(args.period != null ? { period: args.period as Period } : {}),
              },
          'mcp',
        );
        const enforcementChanged = await deps.refresh();
        const snap = deps.getSnapshot();
        return textResult({
          budget_usd: applied.budgetUsd,
          period: applied.period,
          overridden: applied.overridden,
          level: snap?.level,
          spent_usd: snap?.spentUsd,
          period_reset_at: snap?.periodResetAt,
          /** What the change actually did, not a prediction. */
          frozen: deps.getEnforceState().active,
          enforcement_changed: enforcementChanged,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, 'set_org_budget failed');
        return textResult({ error: message }, true);
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
