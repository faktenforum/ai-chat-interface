import { logger } from './utils/logger.ts';
import type { Level, Snapshot } from './aggregate.ts';

/**
 * Notifier fires when the spend level changes between polls.
 * Only an in-platform (log) implementation exists today; email/webhook
 * implementations can be added later without touching the aggregator.
 */
export interface Notifier {
  notify(previous: Level, snapshot: Snapshot): void;
}

function summary(s: Snapshot) {
  return {
    level: s.level,
    spentUsd: s.spentUsd,
    budgetUsd: s.budgetUsd,
    usedRatio: s.usedRatio,
    byProvider: s.byProvider,
    period: s.period,
  };
}

export const logNotifier: Notifier = {
  notify(previous, snapshot) {
    const pct = Math.round(snapshot.usedRatio * 100);
    const msg = `Org spend level ${previous} -> ${snapshot.level}: $${snapshot.spentUsd.toFixed(2)} / $${snapshot.budgetUsd.toFixed(2)} (${pct}%)`;
    if (snapshot.level === 'crit' || snapshot.level === 'over') {
      logger.warn(summary(snapshot), msg);
    } else {
      logger.info(summary(snapshot), msg);
    }
  },
};
