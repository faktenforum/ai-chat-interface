#!/usr/bin/env -S node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Spend Monitor
 *
 * Read-only org-wide cost monitor for LibreChat. Periodically aggregates spend
 * from the `transactions` collection in LibreChat's MongoDB, serves an in-platform
 * status page (GET /) and JSON (GET /api/spend), and logs level transitions.
 * It never writes to LibreChat's database.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';
import { loadConfig } from './config.ts';
import { connectMongo, closeMongo } from './mongo.ts';
import { aggregate } from './aggregate.ts';
import type { Level, Snapshot } from './aggregate.ts';
import { logNotifier } from './notify.ts';
import { renderPage } from './page.ts';
import { logger } from './utils/logger.ts';

const SERVER_NAME = 'spend-monitor';
const SERVER_VERSION = '1.0.0';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = await connectMongo(cfg.mongoUri, cfg.dbName);

  let latest: Snapshot | null = null;
  let prevLevel: Level = 'ok';

  async function refresh(): Promise<void> {
    try {
      const snap = await aggregate(db, cfg, new Date());
      if (snap.level !== prevLevel) {
        logNotifier.notify(prevLevel, snap);
        prevLevel = snap.level;
      }
      latest = snap;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Spend aggregation failed',
      );
    }
  }

  await refresh();

  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION });
  });

  app.get('/api/spend', async (_req: Request, res: Response) => {
    if (!latest) await refresh();
    if (!latest) {
      res.status(503).json({ error: 'no data yet' });
      return;
    }
    res.json(latest);
  });

  app.get('/', async (_req: Request, res: Response) => {
    if (!latest) await refresh();
    if (!latest) {
      res.status(503).send('no data yet');
      return;
    }
    res.type('html').send(renderPage(latest));
  });

  const server = app.listen(cfg.port, '0.0.0.0', () => {
    logger.info(
      { port: cfg.port, budgetUsd: cfg.budgetUsd, period: cfg.period, pollSeconds: cfg.pollSeconds },
      'Spend monitor started',
    );
  });

  const timer = setInterval(() => {
    void refresh();
  }, cfg.pollSeconds * 1000);

  const shutdown = async () => {
    logger.info('Shutting down...');
    clearInterval(timer);
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
