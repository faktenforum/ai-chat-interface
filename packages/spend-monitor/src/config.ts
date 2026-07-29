import 'dotenv/config';
import type { EnforceMode } from './enforce.ts';

/**
 * Accounting window for the org counter. `calendar-*` restarts on a boundary (so the
 * counter resets and the number is comparable to an invoice); `rolling-*` slides and never
 * resets. Weeks start Monday, in UTC like everything else here.
 */
export const PERIODS = [
  'calendar-month',
  'calendar-week',
  'rolling-30d',
  'rolling-7d',
] as const;

export type Period = (typeof PERIODS)[number];

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

function period(name: string, def: Period): Period {
  const raw = process.env[name]?.trim();
  return raw != null && (PERIODS as readonly string[]).includes(raw) ? (raw as Period) : def;
}

export function loadConfig(): Config {
  const rawEnforce = process.env.SPEND_MONITOR_ENFORCE;
  return {
    enforce: rawEnforce === 'on' ? 'on' : rawEnforce === 'dry-run' ? 'dry-run' : 'off',
    port: num('PORT', 3016),
    mongoUri: process.env.SPEND_MONITOR_MONGO_URI || 'mongodb://prod-mongodb:27017/LibreChat',
    dbName: process.env.SPEND_MONITOR_DB || 'LibreChat',
    budgetUsd: num('SPEND_MONITOR_BUDGET_USD', 100),
    period: period('SPEND_MONITOR_PERIOD', 'calendar-month'),
    warnPct: num('SPEND_MONITOR_WARN_PCT', 50),
    critPct: num('SPEND_MONITOR_CRIT_PCT', 80),
    eurRate: num('SPEND_MONITOR_EUR_RATE', 0.92),
    pollSeconds: num('SPEND_MONITOR_POLL_SECONDS', 60),
  };
}
