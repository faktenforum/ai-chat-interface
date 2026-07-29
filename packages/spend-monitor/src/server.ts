#!/usr/bin/env -S node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Spend Monitor
 *
 * Aggregates org-wide spend from LibreChat's `transactions` collection and serves an
 * in-platform status page (GET /) and JSON (GET /api/spend).
 *
 * Reads only, apart from two explicit admin actions: POST /users/:id/reset hands one user
 * their per-period allowance back, and POST /restore lifts an active freeze.
 *
 * When SPEND_MONITOR_ENFORCE is `on` (or `dry-run`), it adds an
 * org-wide HARD STOP: once spend reaches 100% of the budget it snapshots and zeroes all
 * user balances so LibreChat's own pre-request balance check blocks further requests. The
 * freeze is held by re-zeroing balances every poll - LibreChat's per-request config-sync
 * resets the autoRefillEnabled flag, so disabling auto-refill is not relied on. It
 * auto-restores when the period resets (spend < budget) and can be lifted via POST /restore.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.ts';
import { connectMongo, closeMongo } from './mongo.ts';
import { aggregate } from './aggregate.ts';
import type { Level, Snapshot } from './aggregate.ts';
import { logNotifier } from './notify.ts';
import { getEnforceState, enforceCap, restoreBalances, clearStaleOverride } from './enforce.ts';
import type { EnforceState } from './enforce.ts';
import { resetUserLimit } from './users.ts';
import { effectiveConfig, updateSettings } from './settings.ts';
import type { EffectiveConfig, SettingsPatch } from './settings.ts';
import { PERIODS } from './config.ts';
import type { Period } from './config.ts';
import { renderPage } from './page.ts';
import { setupMcpEndpoints, extractUserContext } from './utils/http-server.ts';
import { createSession } from './mcp.ts';
import { logger } from './utils/logger.ts';

const SERVER_NAME = 'spend-monitor';
const SERVER_VERSION = '1.0.0';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = await connectMongo(cfg.mongoUri, cfg.dbName);

  let latest: Snapshot | null = null;
  let prevLevel: Level = 'ok';
  let enforceState: EnforceState = { active: false, since: null, reason: null, overridePeriodStart: null };
  /** Budget and period can be overridden at runtime, so they are re-read every poll. */
  let effective: EffectiveConfig = await effectiveConfig(db, cfg);

  /**
   * Re-reads the settings, re-aggregates, and applies enforcement. Returns true when the
   * freeze state flipped in this pass, so a caller that just changed the budget can report
   * what actually happened rather than predicting it.
   */
  async function refresh(): Promise<boolean> {
    try {
      effective = await effectiveConfig(db, cfg);
      let snap = await aggregate(db, effective, new Date());
      const wasActive = enforceState.active;

      if (cfg.enforce !== 'off') {
        const dryRun = cfg.enforce === 'dry-run';
        await clearStaleOverride(db, snap.periodStart, dryRun);
        const st = await getEnforceState(db);
        const suppressed = st.overridePeriodStart === snap.periodStart;
        if (snap.level === 'over' && !suppressed) {
          await enforceCap(
            db,
            `org budget exceeded: $${snap.spentUsd.toFixed(2)} / $${snap.budgetUsd.toFixed(2)}`,
            new Date().toISOString(),
            dryRun,
          );
        } else if (st.active && snap.level !== 'over') {
          // spend dropped below budget (period reset or budget raised) -> lift the freeze
          await restoreBalances(db, dryRun, null);
        }
        enforceState = await getEnforceState(db);
        /* Enforcement writes balances after the aggregation read them, so the snapshot would
         * still show pre-freeze credits for a whole poll. Re-aggregate once when the state
         * actually flipped. */
        if (enforceState.active !== wasActive) {
          snap = await aggregate(db, effective, new Date());
        }
      }

      if (snap.level !== prevLevel) {
        logNotifier.notify(prevLevel, snap);
        prevLevel = snap.level;
      }
      latest = snap;
      return enforceState.active !== wasActive;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Spend refresh failed',
      );
      return false;
    }
  }

  await refresh();

  const app = express();
  app.disable('x-powered-by');

  app.get('/api/spend', async (_req: Request, res: Response) => {
    if (!latest) await refresh();
    if (!latest) {
      res.status(503).json({ error: 'no data yet' });
      return;
    }
    res.json({
      ...latest,
      enforce: cfg.enforce,
      enforcement: enforceState,
      settings: {
        budgetUsd: effective.budgetUsd,
        period: effective.period,
        overridden: effective.overridden,
        updatedAt: effective.overrideUpdatedAt,
        updatedBy: effective.overrideUpdatedBy,
        envDefaults: { budgetUsd: cfg.budgetUsd, period: cfg.period },
        periods: PERIODS,
      },
    });
  });

  app.get('/', async (_req: Request, res: Response) => {
    if (!latest) await refresh();
    if (!latest) {
      res.status(503).send('no data yet');
      return;
    }
    res.type('html').send(
      renderPage(latest, cfg.enforce, enforceState, cfg.pollSeconds, effective, cfg),
    );
  });

  // Change the org-wide budget or accounting period without a redeploy. Stored in the
  // monitor's own state collection; an empty value clears the override and falls back to
  // SPEND_MONITOR_BUDGET_USD / SPEND_MONITOR_PERIOD.
  app.use('/settings', express.urlencoded({ extended: false }), express.json({ limit: '16kb' }));
  app.post('/settings', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: SettingsPatch = {};

    if ('budgetUsd' in body) {
      const raw = body.budgetUsd;
      const text = typeof raw === 'string' ? raw.trim() : raw;
      patch.budgetUsd = text === '' || text == null ? null : Number(text);
    }
    if ('period' in body) {
      const raw = typeof body.period === 'string' ? body.period.trim() : '';
      patch.period = raw === '' ? null : (raw as Period);
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'nothing to change: pass budgetUsd and/or period' });
      return;
    }

    try {
      const applied = await updateSettings(db, cfg, patch, 'dashboard');
      const enforcementChanged = await refresh();
      res.json({
        budgetUsd: applied.budgetUsd,
        period: applied.period,
        overridden: applied.overridden,
        level: latest?.level,
        /** What the change actually did: a lower budget can freeze everyone immediately,
         *  a higher one can lift a freeze. */
        frozen: enforceState.active,
        enforcementChanged,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, patch }, 'Settings update failed');
      res.status(400).json({ error: message });
    }
  });

  // Reset one user's limit (the dashboard's per-row "Reset" button). Writes to the user's
  // LibreChat balance, so it is refused while an org freeze is re-zeroing balances every poll.
  app.post('/users/:id/reset', async (req: Request, res: Response) => {
    if (enforceState.active) {
      res.status(409).json({ error: 'org freeze active - restore balances before resetting a user' });
      return;
    }
    const userId = String(req.params.id);
    try {
      const result = await resetUserLimit(db, userId, null, false);
      await refresh();
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, userId }, 'User limit reset failed');
      res.status(400).json({ error: message });
    }
  });

  // Manually lift enforcement and restore balances (the dashboard's "Restore" button).
  app.post('/restore', async (_req: Request, res: Response) => {
    if (cfg.enforce === 'off') {
      res.status(400).json({ error: 'enforcement disabled (SPEND_MONITOR_ENFORCE=off)' });
      return;
    }
    // Admin override: lift the freeze and suppress re-enforcement for the current period.
    const result = await restoreBalances(db, cfg.enforce !== 'on', latest?.periodStart ?? null);
    await refresh();
    res.json({ restored: result.restored, dryRun: cfg.enforce !== 'on', suppressedForPeriod: latest?.periodStart ?? null });
  });

  // ── MCP endpoint (admin-gated) ─────────────────────────────────────────────
  // YAML-defined MCP servers are global in LibreChat, so gate on the X-User-Email
  // header against an allowlist. Empty/unset allowlist disables the endpoint.
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const adminEmails = new Set(
    (process.env.SPEND_MONITOR_ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  app.use('/mcp', express.json({ limit: '1mb' }));
  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    if (adminEmails.size === 0) {
      res.status(403).json({ error: 'spend-monitor MCP disabled: SPEND_MONITOR_ADMIN_EMAILS is not set' });
      return;
    }
    const ctx = extractUserContext(req.headers);
    if (!ctx || !adminEmails.has(ctx.email.toLowerCase())) {
      res.status(403).json({ error: 'Not authorized for spend-monitor tools' });
      return;
    }
    next();
  });

  setupMcpEndpoints(app, {
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    port: cfg.port,
    transports,
    createServer: () =>
      createSession(
        { getSnapshot: () => latest, getEnforceState: () => enforceState, refresh, cfg, db },
        transports,
      ),
    logger,
  });

  const server = app.listen(cfg.port, '0.0.0.0', () => {
    logger.info(
      {
        port: cfg.port,
        budgetUsd: cfg.budgetUsd,
        period: cfg.period,
        pollSeconds: cfg.pollSeconds,
        enforce: cfg.enforce,
      },
      'Spend monitor started',
    );
  });

  const timer = setInterval(() => {
    void refresh();
  }, cfg.pollSeconds * 1000);

  const shutdown = async () => {
    logger.info('Shutting down...');
    clearInterval(timer);
    for (const transport of transports.values()) {
      try {
        await transport.close();
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error closing MCP transport');
      }
    }
    transports.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeMongo();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Fatal error',
    );
    process.exit(1);
  });
}

export { main };
