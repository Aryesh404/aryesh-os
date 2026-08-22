import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { aggregateConfidence, computeConfidence, density, freshness } from './confidence.js';
import { isStale } from '../time.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

describe('freshness', () => {
  it('is 1 when just read and 0 at twice the cadence', () => {
    expect(freshness('weekly', NOW, NOW)).toBe(1);
    expect(freshness('weekly', NOW - 7 * DAY, NOW)).toBeCloseTo(0.5, 5);
    expect(freshness('weekly', NOW - 14 * DAY, NOW)).toBe(0);
    expect(freshness('weekly', NOW - 100 * DAY, NOW)).toBe(0);
  });

  it('is 0 when there is nothing to be fresh about', () => {
    expect(freshness('daily', undefined, NOW)).toBe(0);
  });

  /**
   * An adhoc metric has no expected rhythm, so it cannot be late. Punishing it
   * for missing a schedule it never had would make confidence meaningless.
   */
  it('does not punish an adhoc metric for having no schedule', () => {
    expect(freshness('adhoc', NOW - 400 * DAY, NOW)).toBe(1);
    expect(isStale('adhoc', NOW - 400 * DAY, NOW)).toBe(false);
  });

  it('decays monotonically with age', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 400 }),
        (a, b) => {
          const older = Math.max(a, b);
          const newer = Math.min(a, b);
          return (
            freshness('monthly', NOW - newer * DAY, NOW) >=
            freshness('monthly', NOW - older * DAY, NOW)
          );
        },
      ),
    );
  });
});

describe('staleness', () => {
  it('trips past twice the cadence', () => {
    expect(isStale('weekly', NOW - 13 * DAY, NOW)).toBe(false);
    expect(isStale('weekly', NOW - 15 * DAY, NOW)).toBe(true);
    expect(isStale('monthly', NOW - 45 * DAY, NOW)).toBe(false);
    expect(isStale('monthly', NOW - 61 * DAY, NOW)).toBe(true);
  });

  it('treats a metric with no readings as stale', () => {
    expect(isStale('daily', undefined, NOW)).toBe(true);
  });
});

describe('density', () => {
  it('measures history against what the cadence implies', () => {
    // Ten weeks tracked, ten readings.
    expect(density('weekly', NOW - 70 * DAY, 11, NOW)).toBeCloseTo(1, 5);
    // Ten weeks tracked, three readings.
    expect(density('weekly', NOW - 70 * DAY, 3, NOW)).toBeCloseTo(3 / 11, 5);
  });
});

describe('computeConfidence', () => {
  it('a fresh, dense, hand-entered metric scores near 1', () => {
    const c = computeConfidence({
      cadence: 'weekly',
      lastReadingAt: NOW,
      firstReadingAt: NOW - 70 * DAY,
      readingCount: 11,
      manual: true,
      now: NOW,
    });
    expect(c.value).toBeGreaterThan(0.95);
    expect(c.stale).toBe(false);
    expect(c.caveats).toHaveLength(0);
  });

  /** docs/03 §6 — a stale metric lowers confidence and says why. */
  it('a stale metric drops confidence and explains itself', () => {
    const c = computeConfidence({
      cadence: 'weekly',
      lastReadingAt: NOW - 30 * DAY,
      firstReadingAt: NOW - 90 * DAY,
      readingCount: 4,
      manual: true,
      now: NOW,
    });
    expect(c.stale).toBe(true);
    expect(c.value).toBeLessThan(0.5);
    expect(c.caveats.join(' ')).toMatch(/last read 30d ago \(cadence: weekly\)/);
  });

  it('an unread metric bottoms out and says so', () => {
    const c = computeConfidence({
      cadence: 'daily',
      lastReadingAt: undefined,
      readingCount: 0,
      now: NOW,
    });
    expect(c.value).toBeLessThan(0.15);
    expect(c.caveats).toContain('no readings recorded');
  });

  it('never leaves the unit interval', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('daily' as const, 'weekly' as const, 'monthly' as const),
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (cadence, ageDays, count) => {
          const c = computeConfidence({
            cadence,
            lastReadingAt: NOW - ageDays * DAY,
            firstReadingAt: NOW - 365 * DAY,
            readingCount: count,
            now: NOW,
          });
          return c.value >= 0 && c.value <= 1 && Number.isFinite(c.value);
        },
      ),
    );
  });
});

describe('aggregateConfidence', () => {
  it('is scaled down when part of the model dropped out', () => {
    const parts = [{ normalisedWeight: 1, confidence: 0.9 }];
    expect(aggregateConfidence(parts, 1)).toBeCloseTo(0.9, 5);
    expect(aggregateConfidence(parts, 0.5)).toBeCloseTo(0.45, 5);
  });

  it('is 0 when nothing reported', () => {
    expect(aggregateConfidence([], 1)).toBe(0);
  });
});
