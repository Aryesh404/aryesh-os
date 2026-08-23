import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeTrajectory } from './index.js';
import type { SnapshotPoint } from './types.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 15);

/** A rising series ending today: `days` points, `perDay` progress each. */
const series = (
  days: number,
  perDay: number,
  start = 0,
  confidence = 0.9,
): SnapshotPoint[] =>
  Array.from({ length: days }, (_, i) => ({
    date: T0 - (days - 1 - i) * DAY,
    progress: Math.min(1, start + perDay * i),
    momentum: null,
    confidence,
  }));

const dated = (snapshots: SnapshotPoint[], targetDate?: number) =>
  computeTrajectory({
    measurementMode: 'completion',
    snapshots,
    now: T0,
    ...(targetDate === undefined ? {} : { targetDate }),
  });

describe('honesty gates (docs/04 §2)', () => {
  /**
   * The single most important trust decision in the product: a projection from
   * three data points is astrology, and one bad forecast poisons every other
   * number on the screen.
   */
  it('refuses to project from fewer than five snapshots, and says how many', () => {
    for (const n of [1, 2, 3, 4]) {
      const t = dated(series(n, 0.01), T0 + 180 * DAY);
      expect(t.projection.available, `${n} snapshots`).toBe(false);
      if (!t.projection.available) {
        expect(t.projection.reason).toMatch(/5 days of data needed/);
        expect(t.projection.reason).toMatch(new RegExp(`${n} so far`));
      }
    }

    expect(dated(series(5, 0.01), T0 + 180 * DAY).projection.available).toBe(true);
  });

  it('refuses a completion date when nothing is moving', () => {
    const flat = series(30, 0);
    const t = dated(flat, T0 + 180 * DAY);

    expect(t.status).toBe('stalled');
    expect(t.projection.available).toBe(false);
    if (!t.projection.available) expect(t.projection.reason).toMatch(/nothing is moving/);
  });

  it('refuses to forecast once the target date has passed', () => {
    const t = dated(series(30, 0.01), T0 - DAY);
    expect(t.projection.available).toBe(false);
    if (!t.projection.available) {
      expect(t.projection.reason).toMatch(/an outcome now, not a forecast/);
    }
  });

  it('widens the band when the underlying data is not trusted', () => {
    const confident = dated(series(40, 0.01, 0, 0.95), T0 + 180 * DAY);
    const doubtful = dated(series(40, 0.01, 0, 0.2), T0 + 180 * DAY);

    if (!confident.projection.available || !doubtful.projection.available) {
      throw new Error('expected projections');
    }
    const width = (p: typeof confident.projection): number => {
      if (!p.available) return 0;
      const last = p.band[p.band.length - 1];
      return last ? last.high - last.low : 0;
    };
    expect(width(doubtful.projection)).toBeGreaterThan(width(confident.projection));
    expect(doubtful.caveats.join(' ')).toMatch(/low confidence/);
  });

  it('never emits a bare line — a band is always present', () => {
    const t = dated(series(40, 0.01), T0 + 180 * DAY);
    if (!t.projection.available) throw new Error('expected a projection');
    expect(t.projection.band.length).toBeGreaterThan(1);
    for (const point of t.projection.band) {
      expect(point.low).toBeLessThanOrEqual(point.mid + 1e-9);
      expect(point.mid).toBeLessThanOrEqual(point.high + 1e-9);
    }
  });
});

describe('dated vocabulary', () => {
  const target = T0 + 100 * DAY;

  const atPace = (multiplier: number) => {
    // 40 days of history ending at 0.5, with 100 days left to cover 0.5.
    const required = 0.5 / 100;
    return dated(series(40, required * multiplier, 0.5 - required * multiplier * 39), target);
  };

  it('classifies ahead, on track, at risk, and behind', () => {
    expect(atPace(1.5).status).toBe('ahead');
    expect(atPace(1.0).status).toBe('on_track');
    expect(atPace(0.75).status).toBe('at_risk');
    expect(atPace(0.3).status).toBe('behind');
  });

  it('computes required pace and the ratio against it', () => {
    const t = atPace(1.0);
    expect(t.requiredPace).toBeGreaterThan(0);
    expect(t.paceRatio).toBeCloseTo(1, 1);
  });

  it('projects where it lands at the target date', () => {
    const t = atPace(1.0);
    if (!t.projection.available) throw new Error('expected a projection');
    expect(t.projection.atTarget?.mid).toBeCloseTo(1, 1);
  });
});

/**
 * docs/04 §3 — nothing is late that was never due. An undated goal has no
 * denominator for "behind", so it gets a different vocabulary entirely.
 */
describe('momentum vocabulary', () => {
  const undated = (snapshots: SnapshotPoint[]) =>
    computeTrajectory({ measurementMode: 'completion', snapshots, now: T0 });

  it('uses the momentum vocabulary and reports no pace', () => {
    const t = undated(series(40, 0.01));
    expect(t.vocabulary).toBe('momentum');
    expect(t.requiredPace).toBeNull();
    expect(t.paceRatio).toBeNull();
    expect(t.caveats.join(' ')).toMatch(/no pace to be behind on/);
  });

  it('never reports `behind` for something that was never due', () => {
    for (const rate of [0.0001, 0.001, 0.01, 0.05]) {
      expect(undated(series(100, rate)).status).not.toBe('behind');
    }
  });

  it('calls an accelerating series advancing and a decelerating one slowing', () => {
    // Slow for 60 days, then fast for 30.
    const accelerating: SnapshotPoint[] = [];
    let value = 0;
    for (let i = 0; i < 90; i++) {
      value += i < 60 ? 0.001 : 0.02;
      accelerating.push({
        date: T0 - (89 - i) * DAY,
        progress: Math.min(1, value),
        momentum: null,
        confidence: 0.9,
      });
    }
    expect(undated(accelerating).status).toBe('advancing');

    const decelerating: SnapshotPoint[] = [];
    value = 0;
    for (let i = 0; i < 90; i++) {
      value += i < 60 ? 0.008 : 0.0005;
      decelerating.push({
        date: T0 - (89 - i) * DAY,
        progress: Math.min(1, value),
        momentum: null,
        confidence: 0.9,
      });
    }
    expect(undated(decelerating).status).toBe('slowing');
  });

  it('a momentum-mode goal stays on the momentum vocabulary even when dated', () => {
    const t = computeTrajectory({
      measurementMode: 'momentum',
      targetDate: T0 + 100 * DAY,
      snapshots: series(40, 0.01),
      now: T0,
    });
    expect(t.vocabulary).toBe('momentum');
    expect(t.paceRatio).toBeNull();
  });
});

/** docs/14 Case 2 — linear projection under-predicts a compounding corpus. */
describe('compounding projection', () => {
  const corpus = (annualRate: number) =>
    computeTrajectory({
      measurementMode: 'completion',
      targetDate: T0 + 5 * 365 * DAY,
      snapshots: series(40, 0.0005, 0.4),
      now: T0,
      projection: {
        kind: 'compounding',
        annualRate,
        contribution: { amount: 85_000, per: 'month' },
        current: 4_100_000,
        target: 10_000_000,
      },
    });

  it('projects a convex curve, not a straight line', () => {
    const t = corpus(0.1);
    if (!t.projection.available) throw new Error('expected a projection');
    expect(t.projection.kind).toBe('compounding');

    // Progress is capped at 100%, and this corpus reaches ₹1 Cr well before the
    // five-year horizon, so convexity is measured on the part still climbing.
    const climbing = t.projection.band.filter((p) => p.mid < 0.99);
    expect(climbing.length).toBeGreaterThan(3);

    const first = climbing[1]!.mid - climbing[0]!.mid;
    const last = climbing[climbing.length - 1]!.mid - climbing[climbing.length - 2]!.mid;
    // Later steps cover more ground than earlier ones: that is the convexity a
    // linear projection would miss, by years.
    expect(last).toBeGreaterThan(first);
  });

  it('draws a fan from the stated scenarios and names the assumption', () => {
    const t = corpus(0.1);
    if (!t.projection.available) throw new Error('expected a projection');
    expect(t.projection.assumption?.annualRate).toBe(0.1);
    expect(t.projection.assumption?.scenarios).toHaveLength(3);

    // The scenarios separate while the corpus is still growing; once every one
    // of them has reached the target the fan legitimately closes at 100%.
    const spread = t.projection.band.filter((p) => p.high < 0.99);
    expect(spread.length).toBeGreaterThan(0);
    expect(spread[spread.length - 1]!.high).toBeGreaterThan(
      spread[spread.length - 1]!.low,
    );
  });

  it('says out loud that the projection rests on an assumption', () => {
    expect(corpus(0.1).caveats.join(' ')).toMatch(/stated return rate, not on observed growth/);
  });

  it('a higher assumed return reaches the target sooner', () => {
    const slow = corpus(0.06);
    const fast = corpus(0.14);
    if (!slow.projection.available || !fast.projection.available) {
      throw new Error('expected projections');
    }
    expect(fast.projection.completionDate?.mid).toBeLessThan(
      slow.projection.completionDate?.mid ?? Number.POSITIVE_INFINITY,
    );
  });
});

describe('properties', () => {
  it('never produces a NaN or a band that inverts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.double({ min: 0, max: 0.05, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: -50, max: 400 }),
        (days, perDay, confidence, targetOffset) => {
          const t = computeTrajectory({
            measurementMode: 'completion',
            targetDate: T0 + targetOffset * DAY,
            snapshots: series(days, perDay, 0, confidence),
            now: T0,
          });

          if (t.paceRatio !== null && !Number.isFinite(t.paceRatio)) return false;
          if (!t.projection.available) return true;
          return t.projection.band.every(
            (p) =>
              Number.isFinite(p.low) &&
              Number.isFinite(p.mid) &&
              Number.isFinite(p.high) &&
              p.low <= p.mid + 1e-9 &&
              p.mid <= p.high + 1e-9,
          );
        },
      ),
    );
  });

  it('an empty series is unknown, not zero', () => {
    const t = dated([], T0 + 100 * DAY);
    expect(t.status).toBe('unknown');
    expect(t.current).toBeNull();
    expect(t.projection.available).toBe(false);
  });
});
