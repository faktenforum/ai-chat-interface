import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { logger } from './utils/logger.ts';

const BALANCES = 'balances';
const USERS = 'users';

/** LibreChat convention: 1,000,000 token credits = 1 USD. */
export const CREDITS_PER_USD = 1_000_000;

export type RefillIntervalUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months';

export interface UserSpend {
  /** users._id / balances.user as a hex string. */
  id: string;
  email: string;
  name: string | null;
  /** Spend in the current org period (USD). */
  usd: number;
  /** Credits left on the user's LibreChat balance (USD), null when the user has no balance record. */
  balanceUsd: number | null;
  autoRefill: boolean;
  /** Amount LibreChat adds per refill (USD); 0 when auto-refill is not configured. */
  refillUsd: number;
  /** lastRefill + refill interval - the earliest instant the next auto-refill can fire. */
  nextRefillAt: string | null;
  /** The interval has already elapsed, so the next refill fires as soon as the balance is used up. */
  refillDue: boolean;
}

interface BalanceRow {
  user: ObjectId;
  tokenCredits?: number;
  autoRefillEnabled?: boolean;
  refillIntervalValue?: number;
  refillIntervalUnit?: RefillIntervalUnit;
  refillAmount?: number;
  lastRefill?: Date;
}

interface UserRow {
  _id: ObjectId;
  email?: string;
  name?: string;
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Mirror of LibreChat's `getRefillEligibilityDate`
 * (dev/librechat/packages/data-provider/src/balance.ts) so the date shown here is the date
 * LibreChat itself will act on. Keep the calendar-aware setters: adding 1 month to Jan 31
 * must land where LibreChat lands.
 */
export function refillEligibilityDate(
  lastRefill: Date,
  value: number,
  unit: RefillIntervalUnit,
): Date {
  const result = new Date(lastRefill);
  switch (unit) {
    case 'seconds':
      result.setSeconds(result.getSeconds() + value);
      return result;
    case 'minutes':
      result.setMinutes(result.getMinutes() + value);
      return result;
    case 'hours':
      result.setHours(result.getHours() + value);
      return result;
    case 'days':
      result.setDate(result.getDate() + value);
      return result;
    case 'weeks':
      result.setDate(result.getDate() + value * 7);
      return result;
    case 'months':
      result.setMonth(result.getMonth() + value);
      return result;
    default:
      return result;
  }
}

function toId(value: unknown): string {
  return value instanceof ObjectId ? value.toHexString() : String(value);
}

function objectIds(ids: Iterable<string>): ObjectId[] {
  const out: ObjectId[] = [];
  for (const id of ids) {
    if (ObjectId.isValid(id)) out.push(new ObjectId(id));
  }
  return out;
}

/**
 * Joins per-period spend with each user's LibreChat balance record and email.
 * Returns every user who either spent in this period or holds a balance record,
 * sorted by spend descending.
 */
export async function loadUserSpend(
  db: Db,
  spendUsdById: Map<string, number>,
  now: Date,
): Promise<UserSpend[]> {
  const balances = await db
    .collection<BalanceRow>(BALANCES)
    .find(
      {},
      {
        projection: {
          user: 1,
          tokenCredits: 1,
          autoRefillEnabled: 1,
          refillIntervalValue: 1,
          refillIntervalUnit: 1,
          refillAmount: 1,
          lastRefill: 1,
        },
      },
    )
    .toArray();

  const byId = new Map<string, BalanceRow>();
  for (const row of balances) {
    byId.set(toId(row.user), row);
  }

  const ids = new Set<string>([...spendUsdById.keys(), ...byId.keys()]);
  const users = await db
    .collection<UserRow>(USERS)
    .find({ _id: { $in: objectIds(ids) } }, { projection: { email: 1, name: 1 } })
    .toArray();
  const identity = new Map<string, UserRow>();
  for (const user of users) {
    identity.set(toId(user._id), user);
  }

  const rows: UserSpend[] = [];
  for (const id of ids) {
    const balance = byId.get(id);
    const user = identity.get(id);
    const lastRefill = balance?.lastRefill != null ? new Date(balance.lastRefill) : null;
    const intervalValue = balance?.refillIntervalValue;
    const intervalUnit = balance?.refillIntervalUnit;
    const autoRefill = Boolean(balance?.autoRefillEnabled);
    const nextRefill =
      autoRefill && lastRefill != null && !isNaN(lastRefill.getTime()) && intervalValue != null
        ? refillEligibilityDate(lastRefill, intervalValue, intervalUnit ?? 'days')
        : null;

    rows.push({
      id,
      // A balance record without a user document means the account was deleted; keep the row
      // visible (its spend still counts against the org budget) rather than dropping it.
      email: user?.email ?? '(unknown user)',
      name: user?.name ?? null,
      usd: round(spendUsdById.get(id) ?? 0),
      balanceUsd: balance ? round((balance.tokenCredits ?? 0) / CREDITS_PER_USD) : null,
      autoRefill,
      refillUsd: round((balance?.refillAmount ?? 0) / CREDITS_PER_USD),
      nextRefillAt: nextRefill?.toISOString() ?? null,
      refillDue: nextRefill != null && now >= nextRefill,
    });
  }

  rows.sort((a, b) => b.usd - a.usd || a.email.localeCompare(b.email));
  return rows;
}

/**
 * Resolves a login email to its users._id, or null when no such account exists.
 * LibreChat lowercases emails on write, so the indexed exact match is the normal path; the
 * case-insensitive retry only covers documents that predate that or were imported directly.
 */
export async function findUserIdByEmail(db: Db, email: string): Promise<string | null> {
  const users = db.collection<UserRow>(USERS);
  const projection = { _id: 1 } as const;
  const normalized = email.trim().toLowerCase();

  const exact = await users.findOne({ email: normalized }, { projection });
  if (exact) return toId(exact._id);

  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const insensitive = await users.findOne(
    { email: { $regex: `^${escaped}$`, $options: 'i' } },
    { projection },
  );
  return insensitive ? toId(insensitive._id) : null;
}

export interface ResetResult {
  userId: string;
  email: string;
  creditsUsd: number;
  previousUsd: number;
  dryRun: boolean;
}

/**
 * Gives one user their full per-period allowance back: sets tokenCredits to the reset amount and
 * moves lastRefill to now, so LibreChat's next automatic refill is a full interval away.
 *
 * `creditsUsd` defaults to the user's own configured refillAmount. There is no built-in fallback:
 * with auto-refill off there is no per-user allowance to infer, so the caller must pass an amount.
 */
export async function resetUserLimit(
  db: Db,
  userId: string,
  creditsUsd: number | null,
  dryRun: boolean,
): Promise<ResetResult> {
  if (!ObjectId.isValid(userId)) {
    throw new Error(`invalid user id: ${userId}`);
  }
  const _id = new ObjectId(userId);
  const balances = db.collection<BalanceRow>(BALANCES);
  const record = await balances.findOne({ user: _id });
  if (!record) {
    throw new Error(`no balance record for user ${userId}`);
  }

  const target = creditsUsd ?? (record.refillAmount ?? 0) / CREDITS_PER_USD;
  if (!(target > 0)) {
    throw new Error(
      `no reset amount for user ${userId}: auto-refill is off (refillAmount is unset), pass an explicit amount`,
    );
  }

  const user = await db
    .collection<UserRow>(USERS)
    .findOne({ _id }, { projection: { email: 1 } });
  const result: ResetResult = {
    userId,
    email: user?.email ?? '(unknown user)',
    creditsUsd: round(target),
    previousUsd: round((record.tokenCredits ?? 0) / CREDITS_PER_USD),
    dryRun,
  };

  if (dryRun) {
    logger.warn(result, 'DRY-RUN: would reset user limit');
    return result;
  }

  await balances.updateOne(
    { user: _id },
    { $set: { tokenCredits: Math.round(target * CREDITS_PER_USD), lastRefill: new Date() } },
  );
  logger.warn(result, 'User limit reset');
  return result;
}
