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

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** A half-open interval `[start, end)`. */
export interface Period {
  /** Stable identifier, e.g. `2026-03` or `2026-W12`. */
  key: string;
  start: number;
  end: number;
}

const utc = (ms: number): Date => new Date(ms);

export function startOfUtcDay(ms: number): number {
  return Date.UTC(utc(ms).getUTCFullYear(), utc(ms).getUTCMonth(), utc(ms).getUTCDate());
}

/** Monday-based, matching ISO weeks. */
export function startOfUtcWeek(ms: number): number {
  const day = startOfUtcDay(ms);
  const weekday = (utc(day).getUTCDay() + 6) % 7;
  return day - weekday * DAY_MS;
}

export function startOfUtcMonth(ms: number): number {
  return Date.UTC(utc(ms).getUTCFullYear(), utc(ms).getUTCMonth(), 1);
}

export function startOfUtcQuarter(ms: number): number {
  const month = utc(ms).getUTCMonth();
  return Date.UTC(utc(ms).getUTCFullYear(), month - (month % 3), 1);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Calendar-aware periods, deliberately not fixed-length chunks: "monthly
 * revenue" means a calendar month, and a 30-day approximation would drift a
 * week out of alignment within a year.
 */
export function periodsBetween(cadence: Cadence, from: number, to: number): Period[] {
  if (to <= from) return [];

  if (cadence === 'adhoc') {
    return [{ key: 'all', start: from, end: to }];
  }

  const periods: Period[] = [];
  let cursor =
    cadence === 'daily'
      ? startOfUtcDay(from)
      : cadence === 'weekly'
        ? startOfUtcWeek(from)
        : cadence === 'monthly'
          ? startOfUtcMonth(from)
          : startOfUtcQuarter(from);

  // A decade of daily periods is ~3650 entries; the guard is against a bad
  // range, not against normal use.
  const LIMIT = 20_000;

  while (cursor < to && periods.length < LIMIT) {
    const date = utc(cursor);
    let end: number;
    let key: string;

    switch (cadence) {
      case 'daily':
        end = cursor + DAY_MS;
        key = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
        break;
      case 'weekly':
        end = cursor + 7 * DAY_MS;
        key = `${date.getUTCFullYear()}-W${pad(isoWeek(cursor))}`;
        break;
      case 'monthly':
        end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
        key = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
        break;
      case 'quarterly':
        end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1);
        key = `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
        break;
    }

    periods.push({ key, start: cursor, end });
    cursor = end;
  }

  return periods;
}

function isoWeek(ms: number): number {
  const day = startOfUtcDay(ms);
  const date = utc(day);
  // Thursday of this week decides the year the week belongs to.
  const thursday = day + (3 - ((date.getUTCDay() + 6) % 7)) * DAY_MS;
  const firstThursday = Date.UTC(utc(thursday).getUTCFullYear(), 0, 4);
  const firstWeekStart = startOfUtcWeek(firstThursday);
  return Math.round((thursday - firstWeekStart) / (7 * DAY_MS)) + 1;
}
