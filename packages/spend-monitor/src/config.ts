import 'dotenv/config';
import type { EnforceMode } from './enforce.ts';

export type Period = 'calendar-month' | 'rolling-30d';

export interface Config {
  /** off (monitor only) | dry-run (log what it would do) | on (zero balances over budget) */
  enforce: EnforceMode;
  port: number;
  mongoUri: string;
  dbName: string;
  budgetUsd: number;
  period: Period;
  warnPct: number;
  critPct: number;
  /** EUR per 1 USD, for display only (the org total is USD-normalized). */
  eurRate: number;
  pollSeconds: number;
}

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

export function loadConfig(): Config {
  const rawPeriod = process.env.SPEND_MONITOR_PERIOD;
  const rawEnforce = process.env.SPEND_MONITOR_ENFORCE;
  return {
    enforce: rawEnforce === 'on' ? 'on' : rawEnforce === 'dry-run' ? 'dry-run' : 'off',
    port: num('PORT', 3016),
    mongoUri: process.env.SPEND_MONITOR_MONGO_URI || 'mongodb://prod-mongodb:27017/LibreChat',
    dbName: process.env.SPEND_MONITOR_DB || 'LibreChat',
    budgetUsd: num('SPEND_MONITOR_BUDGET_USD', 100),
    period: rawPeriod === 'rolling-30d' ? 'rolling-30d' : 'calendar-month',
    warnPct: num('SPEND_MONITOR_WARN_PCT', 50),
    critPct: num('SPEND_MONITOR_CRIT_PCT', 80),
    eurRate: num('SPEND_MONITOR_EUR_RATE', 0.92),
    pollSeconds: num('SPEND_MONITOR_POLL_SECONDS', 60),
  };
}
