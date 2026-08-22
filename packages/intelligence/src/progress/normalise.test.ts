import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normaliseMetric, type Normalised } from './normalise.js';

const value = (n: Normalised): number => {
  if (!n.satisfied) throw new Error(`expected satisfied, got: ${n.reason}`);
  return n.result.value;
};

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

describe('normaliseMetric — worked examples', () => {
  it('the ₹5L MRR case (docs/14 Case 1)', () => {
    const n = normaliseMetric({
      direction: 'increase',
      current: 140_000,
      baseline: 0,
      target: 500_000,
    });
    expect(value(n)).toBeCloseTo(0.28, 5);
  });

  it('baseline is not zero: ₹80k → ₹90k against ₹100k is 50%, not 90%', () => {
    const n = normaliseMetric({
      direction: 'increase',
      current: 90_000,
      baseline: 80_000,
      target: 100_000,
    });
    expect(value(n)).toBeCloseTo(0.5, 10);
  });

  it('decrease: burn ₹80k → ₹60k against a ₹40k target is 50%', () => {
    const n = normaliseMetric({
      direction: 'decrease',
      current: 60_000,
      baseline: 80_000,
      target: 40_000,
    });
    expect(value(n)).toBeCloseTo(0.5, 10);
  });

  it('maintain: on target is 1, a full tolerance away is 0', () => {
    const base = { direction: 'maintain', target: 70, tolerance: 5 } as const;
    expect(value(normaliseMetric({ ...base, baseline: undefined, current: 70 }))).toBe(1);
    expect(value(normaliseMetric({ ...base, baseline: undefined, current: 75 }))).toBe(0);
    expect(value(normaliseMetric({ ...base, baseline: undefined, current: 65 }))).toBe(0);
  });
});

describe('normaliseMetric — properties', () => {
  it('always returns a value in [0,1], never NaN', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('increase' as const, 'decrease' as const),
        finite(-1e9, 1e9),
        finite(-1e9, 1e9),
        finite(-1e9, 1e9),
        (direction, current, baseline, target) => {
          const n = normaliseMetric({ direction, current, baseline, target });
          if (!n.satisfied) return true;
          const v = n.result.value;
          return Number.isFinite(v) && v >= 0 && v <= 1;
        },
      ),
    );
  });

  it('increase is monotonic non-decreasing in current', () => {
    fc.assert(
      fc.property(
        finite(-1e6, 1e6),
        finite(0.001, 1e6),
        finite(-1e6, 1e6),
        finite(0, 1e6),
        (baseline, range, current, delta) => {
          const target = baseline + range;
          const lo = normaliseMetric({ direction: 'increase', current, baseline, target });
          const hi = normaliseMetric({
            direction: 'increase',
            current: current + delta,
            baseline,
            target,
          });
          if (!lo.satisfied || !hi.satisfied) return true;
          return hi.result.value >= lo.result.value;
        },
      ),
    );
  });

  it('decrease is monotonic non-increasing in current', () => {
    fc.assert(
      fc.property(
        finite(-1e6, 1e6),
        finite(0.001, 1e6),
        finite(-1e6, 1e6),
        finite(0, 1e6),
        (target, range, current, delta) => {
          const baseline = target + range;
          const lo = normaliseMetric({ direction: 'decrease', current, baseline, target });
          const hi = normaliseMetric({
            direction: 'decrease',
            current: current + delta,
            baseline,
            target,
          });
          if (!lo.satisfied || !hi.satisfied) return true;
          return hi.result.value <= lo.result.value;
        },
      ),
    );
  });

  it('at baseline it is 0 and at target it is 1, in both directions', () => {
    fc.assert(
      fc.property(finite(-1e6, 1e6), finite(0.001, 1e6), (baseline, range) => {
        const up = { direction: 'increase' as const, baseline, target: baseline + range };
        const down = { direction: 'decrease' as const, baseline, target: baseline - range };
        return (
          value(normaliseMetric({ ...up, current: baseline })) === 0 &&
          value(normaliseMetric({ ...up, current: up.target })) === 1 &&
          value(normaliseMetric({ ...down, current: baseline })) === 0 &&
          value(normaliseMetric({ ...down, current: down.target })) === 1
        );
      }),
    );
  });

  it('maintain is symmetric around the target', () => {
    fc.assert(
      fc.property(
        finite(-1e6, 1e6),
        finite(0.001, 1e5),
        finite(0, 1e5),
        (target, tolerance, drift) => {
          const above = normaliseMetric({
            direction: 'maintain',
            current: target + drift,
            baseline: undefined,
            target,
            tolerance,
          });
          const below = normaliseMetric({
            direction: 'maintain',
            current: target - drift,
            baseline: undefined,
            target,
            tolerance,
          });
          return Math.abs(value(above) - value(below)) < 1e-9;
        },
      ),
    );
  });
});

describe('normaliseMetric — refuses rather than inventing a number', () => {
  const cases: Array<[string, Parameters<typeof normaliseMetric>[0], RegExp]> = [
    [
      'unbounded metric (no target)',
      { direction: 'increase', current: 12, baseline: 0, target: undefined },
      /no target/,
    ],
    [
      'zero range',
      { direction: 'increase', current: 5, baseline: 10, target: 10 },
      /no range/,
    ],
    [
      'target on the wrong side of baseline',
      { direction: 'increase', current: 5, baseline: 10, target: 2 },
      /wrong side/,
    ],
    [
      'maintain without a tolerance band',
      { direction: 'maintain', current: 5, baseline: undefined, target: 5 },
      /tolerance/,
    ],
    [
      'no current reading',
      { direction: 'increase', current: Number.NaN, baseline: 0, target: 10 },
      /no current reading/,
    ],
  ];

  it.each(cases)('%s', (_name, input, expectedReason) => {
    const n = normaliseMetric(input);
    expect(n.satisfied).toBe(false);
    if (!n.satisfied) expect(n.reason).toMatch(expectedReason);
  });
});
