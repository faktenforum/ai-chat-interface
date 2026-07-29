import type { Db } from 'mongodb';
import type { Config, Period } from './config.ts';
import { PERIODS } from './config.ts';
import { logger } from './utils/logger.ts';

/** Same collection the enforcement state lives in; a separate doc, different lifecycle. */
const STATE = 'spendmonitor_state';
const SETTINGS_ID = 'settings';

/**
 * Admin overrides for the values that would otherwise need a redeploy to change.
 * Absent fields mean "use the env default", so clearing an override is a real operation
 * rather than writing the current default back in.
 */
export interface Overrides {
  budgetUsd?: number;
  period?: Period;
  /** Who changed it last and when - the page shows this so a surprising budget is traceable. */
  updatedAt?: string;
  updatedBy?: string;
}

interface SettingsDoc extends Overrides {
  _id: string;
}

/** The config actually in force: env defaults with any stored override applied on top. */
export interface EffectiveConfig extends Config {
  /** Which fields come from the database rather than the environment. */
  overridden: { budgetUsd: boolean; period: boolean };
  overrideUpdatedAt: string | null;
  overrideUpdatedBy: string | null;
}

export async function getOverrides(db: Db): Promise<Overrides> {
  const doc = await db.collection<SettingsDoc>(STATE).findOne({ _id: SETTINGS_ID });
  if (!doc) {
    return {};
  }
  const budgetUsd = typeof doc.budgetUsd === 'number' && doc.budgetUsd > 0 ? doc.budgetUsd : undefined;
  const period = doc.period != null && PERIODS.includes(doc.period) ? doc.period : undefined;
  return { budgetUsd, period, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy };
}

/** Merges stored overrides onto the env-derived config. */
export function applyOverrides(cfg: Config, overrides: Overrides): EffectiveConfig {
  return {
    ...cfg,
    budgetUsd: overrides.budgetUsd ?? cfg.budgetUsd,
    period: overrides.period ?? cfg.period,
    overridden: {
      budgetUsd: overrides.budgetUsd != null,
      period: overrides.period != null,
    },
    overrideUpdatedAt: overrides.updatedAt ?? null,
    overrideUpdatedBy: overrides.updatedBy ?? null,
  };
}

export async function effectiveConfig(db: Db, cfg: Config): Promise<EffectiveConfig> {
  return applyOverrides(cfg, await getOverrides(db));
}

export interface SettingsPatch {
  /** A number sets the override; null clears it and falls back to the env default. */
  budgetUsd?: number | null;
  period?: Period | null;
}

/**
 * Writes or clears the overrides. Returns the config in force afterwards, so the caller can
 * report what actually changed instead of echoing the request back.
 */
export async function updateSettings(
  db: Db,
  cfg: Config,
  patch: SettingsPatch,
  updatedBy: string,
): Promise<EffectiveConfig> {
  const set: Partial<SettingsDoc> = { updatedAt: new Date().toISOString(), updatedBy };
  const unset: Record<string, ''> = {};

  if (patch.budgetUsd !== undefined) {
    if (patch.budgetUsd === null) {
      unset.budgetUsd = '';
    } else {
      if (!Number.isFinite(patch.budgetUsd) || patch.budgetUsd <= 0) {
        throw new Error(`budget must be a positive number, got ${patch.budgetUsd}`);
      }
      set.budgetUsd = patch.budgetUsd;
    }
  }
  if (patch.period !== undefined) {
    if (patch.period === null) {
      unset.period = '';
    } else {
      if (!PERIODS.includes(patch.period)) {
        throw new Error(`unknown period ${patch.period}; expected one of ${PERIODS.join(', ')}`);
      }
      set.period = patch.period;
    }
  }

  await db.collection<SettingsDoc>(STATE).updateOne(
    { _id: SETTINGS_ID },
    { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) },
    { upsert: true },
  );

  const applied = await effectiveConfig(db, cfg);
  logger.warn(
    {
      budgetUsd: applied.budgetUsd,
      period: applied.period,
      overridden: applied.overridden,
      updatedBy,
    },
    'Org spend settings changed',
  );
  return applied;
}
