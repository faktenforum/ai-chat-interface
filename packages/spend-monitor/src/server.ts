#!/usr/bin/env -S node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Spend Monitor
 *
 * Aggregates org-wide spend from LibreChat's `transactions` collection and serves an
 * in-platform status page (GET /) and JSON (GET /api/spend).
 *
 * Read-only by default. When SPEND_MONITOR_ENFORCE is `on` (or `dry-run`), it adds an
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

  async function refresh(): Promise<void> {
    try {
      const snap = await aggregate(db, cfg, new Date());

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
      }

      if (snap.level !== prevLevel) {
        logNotifier.notify(prevLevel, snap);
        prevLevel = snap.level;
      }
      latest = snap;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Spend refresh failed',
      );
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
    res.json({ ...latest, enforce: cfg.enforce, enforcement: enforceState });
  });

  app.get('/', async (_req: Request, res: Response) => {
    if (!latest) await refresh();
    if (!latest) {
      res.status(503).send('no data yet');
      return;
    }
    res.type('html').send(renderPage(latest, cfg.enforce, enforceState, cfg.pollSeconds));
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
