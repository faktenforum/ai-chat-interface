import type { Db } from 'mongodb';
import type { Config, Period } from './config.ts';

export type Level = 'ok' | 'warn' | 'crit' | 'over';

export type Provider = 'openrouter' | 'scaleway';

export interface ModelSpend {
  model: string;
  provider: Provider;
  usd: number;
}

export interface UserSpend {
  user: string;
  usd: number;
}

export interface Snapshot {
  period: Period;
  periodStart: string;
  budgetUsd: number;
  spentUsd: number;
  usedRatio: number;
  level: Level;
  eur: { rate: number; spent: number; budget: number };
  byProvider: Record<Provider, number>;
  byModel: ModelSpend[];
  topUsers: UserSpend[];
  updatedAt: string;
}

/** LibreChat convention: 1,000,000 token credits = 1 USD. */
const CREDITS_PER_USD = 1_000_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function periodStart(period: Period, now: Date): Date {
  if (period === 'rolling-30d') {
    return new Date(now.getTime() - 30 * MS_PER_DAY);
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function levelFor(ratio: number, warnPct: number, critPct: number): Level {
  if (ratio >= 1) return 'over';
  if (ratio * 100 >= critPct) return 'crit';
  if (ratio * 100 >= warnPct) return 'warn';
  return 'ok';
}

/** OpenRouter model ids are `vendor/model`; Scaleway ids are bare. */
function providerOf(model: string | null | undefined): Provider {
  return model != null && model.includes('/') ? 'openrouter' : 'scaleway';
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

interface ModelRow {
  _id: string | null;
  credits: number;
}
interface UserRow {
  _id: unknown;
  credits: number;
}

/**
 * Aggregates org-wide spend for the current period from LibreChat's `transactions`.
 * Spend rows have a negative `tokenValue`; `tokenType: 'credits'` rows are refills and are excluded.
 */
export async function aggregate(db: Db, cfg: Config, now: Date): Promise<Snapshot> {
  const start = periodStart(cfg.period, now);
  const match = {
    createdAt: { $gte: start },
    tokenType: { $in: ['prompt', 'completion'] },
  };

  const transactions = db.collection('transactions');

  const byModelRows = await transactions
    .aggregate<ModelRow>([
      { $match: match },
      { $group: { _id: '$model', credits: { $sum: '$tokenValue' } } },
    ])
    .toArray();

  const byUserRows = await transactions
    .aggregate<UserRow>([
      { $match: match },
      { $group: { _id: '$user', credits: { $sum: '$tokenValue' } } },
      { $sort: { credits: 1 } },
      { $limit: 10 },
    ])
    .toArray();

  const byProvider: Record<Provider, number> = { openrouter: 0, scaleway: 0 };
  const byModel: ModelSpend[] = [];
  let spentCredits = 0;

  for (const row of byModelRows) {
    const credits = row.credits ?? 0;
    spentCredits += credits;
    const usd = -credits / CREDITS_PER_USD;
    const provider = providerOf(row._id);
    byProvider[provider] += usd;
    byModel.push({ model: row._id ?? 'unknown', provider, usd: round(usd) });
  }
  byModel.sort((a, b) => b.usd - a.usd);

  const spentUsd = -spentCredits / CREDITS_PER_USD;
  const usedRatio = cfg.budgetUsd > 0 ? spentUsd / cfg.budgetUsd : 0;

  const topUsers: UserSpend[] = byUserRows.map((row) => ({
    user: String(row._id),
    usd: round(-(row.credits ?? 0) / CREDITS_PER_USD),
  }));

  return {
    period: cfg.period,
    periodStart: start.toISOString(),
    budgetUsd: cfg.budgetUsd,
    spentUsd: round(spentUsd),
    usedRatio: round(usedRatio),
    level: levelFor(usedRatio, cfg.warnPct, cfg.critPct),
    eur: { rate: cfg.eurRate, spent: round(spentUsd * cfg.eurRate), budget: round(cfg.budgetUsd * cfg.eurRate) },
    byProvider: { openrouter: round(byProvider.openrouter), scaleway: round(byProvider.scaleway) },
    byModel,
    topUsers,
    updatedAt: now.toISOString(),
  };
}
