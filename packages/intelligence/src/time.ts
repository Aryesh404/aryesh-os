import type { Cadence } from '@aryesh/domain';

/** Pure time arithmetic. Every function takes `now`; none reads a clock. */

export const DAY_MS = 86_400_000;

/**
 * How long one cadence period lasts. `adhoc` has no expected rhythm, so it can
 * never be "late" — it returns null and callers treat freshness as unknown
 * rather than as decayed.
 */
export function cadencePeriodMs(cadence: Cadence): number | null {
  switch (cadence) {
    case 'daily':
      return DAY_MS;
    case 'weekly':
      return 7 * DAY_MS;
    case 'monthly':
      return 30 * DAY_MS;
    case 'quarterly':
      return 91 * DAY_MS;
    case 'adhoc':
      return null;
  }
}

/** Readings a metric should have accumulated since it started being tracked. */
export function expectedReadings(
  cadence: Cadence,
  firstReadingAt: number | undefined,
  now: number,
): number | null {
  const period = cadencePeriodMs(cadence);
  if (period === null || firstReadingAt === undefined) return null;
  const elapsed = Math.max(0, now - firstReadingAt);
  return Math.floor(elapsed / period) + 1;
}

export function daysBetween(from: number, to: number): number {
  return (to - from) / DAY_MS;
}

/**
 * docs/03 §6 — a metric past twice its cadence has stopped being current
 * evidence. The system's most useful nag is not "you have tasks", it is
 * "you stopped measuring the thing you said mattered".
 */
export function isStale(
  cadence: Cadence,
  lastReadingAt: number | undefined,
  now: number,
): boolean {
  const period = cadencePeriodMs(cadence);
  if (period === null) return false;
  if (lastReadingAt === undefined) return true;
  return now - lastReadingAt > 2 * period;
}

export function perPeriodMs(per: 'week' | 'month' | 'quarter'): number {
  switch (per) {
    case 'week':
      return 7 * DAY_MS;
    case 'month':
      return 30 * DAY_MS;
    case 'quarter':
      return 91 * DAY_MS;
  }
}
