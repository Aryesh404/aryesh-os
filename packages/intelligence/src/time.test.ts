import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { periodsBetween, startOfUtcMonth, startOfUtcWeek, DAY_MS } from './time.js';

describe('periodsBetween', () => {
  it('produces real calendar months, not 30-day chunks', () => {
    const periods = periodsBetween('monthly', Date.UTC(2026, 0, 15), Date.UTC(2026, 3, 5));
    expect(periods.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    // February is 28 days in 2026; a fixed-length chunker would drift here.
    const feb = periods[1];
    expect(feb?.end).toBe(Date.UTC(2026, 2, 1));
    expect((feb!.end - feb!.start) / DAY_MS).toBe(28);
  });

  it('aligns weeks to Monday', () => {
    // 2026-08-15 is a Saturday.
    const periods = periodsBetween('weekly', Date.UTC(2026, 7, 15), Date.UTC(2026, 7, 25));
    expect(periods[0]?.start).toBe(startOfUtcWeek(Date.UTC(2026, 7, 15)));
    expect(new Date(periods[0]!.start).getUTCDay()).toBe(1);
  });

  it('produces quarters on calendar boundaries', () => {
    const periods = periodsBetween('quarterly', Date.UTC(2026, 1, 3), Date.UTC(2026, 8, 1));
    expect(periods.map((p) => p.key)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3']);
  });

  it('treats adhoc as one span', () => {
    const periods = periodsBetween('adhoc', 1000, 2000);
    expect(periods).toEqual([{ key: 'all', start: 1000, end: 2000 }]);
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(periodsBetween('daily', 2000, 1000)).toEqual([]);
    expect(periodsBetween('daily', 1000, 1000)).toEqual([]);
  });

  it('always yields contiguous, non-overlapping, covering periods', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('daily' as const, 'weekly' as const, 'monthly' as const, 'quarterly' as const),
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 1, max: 400 }),
        (cadence, startDayOffset, spanDays) => {
          const from = Date.UTC(2020, 0, 1) + startDayOffset * DAY_MS;
          const to = from + spanDays * DAY_MS;
          const periods = periodsBetween(cadence, from, to);
          if (periods.length === 0) return false;

          for (let i = 0; i < periods.length - 1; i++) {
            if (periods[i]!.end !== periods[i + 1]!.start) return false;
            if (periods[i]!.end <= periods[i]!.start) return false;
          }
          // Covers the whole requested range.
          return periods[0]!.start <= from && periods[periods.length - 1]!.end >= to;
        },
      ),
    );
  });

  it('generates unique keys within a run', () => {
    const periods = periodsBetween('weekly', Date.UTC(2025, 0, 1), Date.UTC(2027, 0, 1));
    expect(new Set(periods.map((p) => p.key)).size).toBe(periods.length);
  });
});

describe('boundary helpers', () => {
  it('startOfUtcMonth is idempotent', () => {
    const m = startOfUtcMonth(Date.UTC(2026, 7, 15, 13, 45));
    expect(m).toBe(Date.UTC(2026, 7, 1));
    expect(startOfUtcMonth(m)).toBe(m);
  });
});
