import type { Db } from 'mongodb';
import { logger } from './utils/logger.ts';

export type EnforceMode = 'off' | 'dry-run' | 'on';

const BALANCES = 'balances';
const STATE = 'spendmonitor_state';
const SNAPSHOT = 'spendmonitor_balance_snapshot';

export interface EnforceState {
  active: boolean;
  since: string | null;
  reason: string | null;
  /** When set, auto-enforcement is suppressed while the period equals this value
   *  (admin "Restore" override: keep users working over budget until the period resets). */
  overridePeriodStart: string | null;
}

interface StateDoc extends EnforceState {
  _id: string;
}

interface BalanceDoc {
  user: unknown;
  tokenCredits: number;
  autoRefillEnabled?: boolean;
}

interface SnapshotDoc {
  user: unknown;
  tokenCredits: number;
  autoRefillEnabled: boolean;
}

export async function getEnforceState(db: Db): Promise<EnforceState> {
  const doc = await db.collection<StateDoc>(STATE).findOne({ _id: 'enforcement' });
  return {
    active: Boolean(doc?.active),
    since: doc?.since ?? null,
    reason: doc?.reason ?? null,
    overridePeriodStart: doc?.overridePeriodStart ?? null,
  };
}

async function setEnforceState(db: Db, state: EnforceState): Promise<void> {
  await db
    .collection<StateDoc>(STATE)
    .updateOne({ _id: 'enforcement' }, { $set: { ...state } }, { upsert: true });
}

/** Clear a stale admin override once the billing period has rolled over. */
export async function clearStaleOverride(
  db: Db,
  currentPeriodStart: string,
  dryRun: boolean,
): Promise<void> {
  const st = await getEnforceState(db);
  if (st.overridePeriodStart != null && st.overridePeriodStart !== currentPeriodStart) {
    if (dryRun) {
      logger.warn(
        { overridePeriodStart: st.overridePeriodStart, currentPeriodStart },
        'DRY-RUN: would clear stale override',
      );
      return;
    }
    await setEnforceState(db, { ...st, overridePeriodStart: null });
  }
}

/**
 * Snapshot balances (once, on activation) then zero them. The autoRefillEnabled:false write
 * is best-effort only - LibreChat's per-request config-sync resets that flag - so the freeze
 * is actually held by re-zeroing every poll, not by suppressing auto-refill.
 * Idempotent: safe to call every poll while over budget - it re-zeroes balances that crept
 * above 0 (in-flight spends, lazily-created new users, or a monthly auto-refill between polls).
 */
export async function enforceCap(
  db: Db,
  reason: string,
  nowIso: string,
  dryRun: boolean,
): Promise<{ snapshotted: number; zeroed: number }> {
  const balances = db.collection<BalanceDoc>(BALANCES);
  const snapshot = db.collection<SnapshotDoc>(SNAPSHOT);

  let snapshotted = 0;
  const state = await getEnforceState(db);
  if (!state.active) {
    const docs = await balances
      .find({}, { projection: { user: 1, tokenCredits: 1, autoRefillEnabled: 1 } })
      .toArray();
    snapshotted = docs.length;
    if (dryRun) {
      logger.warn({ wouldSnapshot: snapshotted, reason }, 'DRY-RUN: would snapshot balances + start enforcement');
    } else {
      await snapshot.deleteMany({});
      if (docs.length > 0) {
        await snapshot.insertMany(
          docs.map((d) => ({
            user: d.user,
            tokenCredits: d.tokenCredits ?? 0,
            autoRefillEnabled: d.autoRefillEnabled ?? false,
          })),
        );
      }
      await setEnforceState(db, { active: true, since: nowIso, reason, overridePeriodStart: null });
      logger.warn({ snapshotted, reason }, 'ENFORCEMENT ON: snapshotted balances; zeroing');
    }
  }

  const overZero = { $or: [{ tokenCredits: { $gt: 0 } }, { autoRefillEnabled: true }] };
  if (dryRun) {
    const n = await balances.countDocuments(overZero);
    logger.warn({ wouldZero: n }, 'DRY-RUN: would zero balances + disable auto-refill');
    return { snapshotted, zeroed: 0 };
  }
  const result = await balances.updateMany(overZero, {
    $set: { tokenCredits: 0, autoRefillEnabled: false },
  });
  return { snapshotted, zeroed: result.modifiedCount };
}

/**
 * Restore snapshotted balances, lift enforcement, and re-enable auto-refill for any
 * user who joined during the freeze. Pass `overridePeriodStart` to suppress
 * auto-re-enforcement for that period (manual admin override); pass null to clear it
 * (auto-restore after a period reset / budget raise).
 */
export async function restoreBalances(
  db: Db,
  dryRun: boolean,
  overridePeriodStart: string | null,
): Promise<{ restored: number }> {
  const balances = db.collection<BalanceDoc>(BALANCES);
  const snapshot = db.collection<SnapshotDoc>(SNAPSHOT);
  const snaps = await snapshot.find({}).toArray();

  if (dryRun) {
    logger.warn({ wouldRestore: snaps.length }, 'DRY-RUN: would restore balances + lift enforcement');
    return { restored: snaps.length };
  }

  if (snaps.length > 0) {
    await balances.bulkWrite(
      snaps.map((s) => ({
        updateOne: {
          filter: { user: s.user },
          update: {
            $set: { tokenCredits: s.tokenCredits ?? 0, autoRefillEnabled: s.autoRefillEnabled ?? false },
          },
        },
      })),
    );
    const snapUsers = snaps.map((s) => s.user);
    await balances.updateMany(
      { user: { $nin: snapUsers }, autoRefillEnabled: false },
      { $set: { autoRefillEnabled: true } },
    );
  }

  // Clear enforcement state before dropping the snapshot. A crash in the gap then leaves
  // active:false with the snapshot still present (recoverable - the next enforceCap re-snapshots
  // correct values before zeroing), rather than active:true with an empty snapshot (which would
  // let enforceCap zero balances with nothing left to restore).
  await setEnforceState(db, { active: false, since: null, reason: null, overridePeriodStart });
  await snapshot.deleteMany({});
  logger.warn({ restored: snaps.length, overridePeriodStart }, 'ENFORCEMENT OFF: balances restored');
  return { restored: snaps.length };
}
