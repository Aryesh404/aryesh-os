import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeProgress } from './aggregate.js';
import type { ContributorInput, GoalInput } from '../types.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const ctx = { now: NOW };

const metricContributor = (
  over: Partial<ContributorInput> & { value?: number } = {},
): ContributorInput => ({
  kind: 'metric',
  refId: 'm1',
  label: 'monthly_revenue',
  weight: 1,
  evaluation: 'level',
  metric: {
    key: 'monthly_revenue',
    direction: 'increase',
    cadence: 'monthly',
    bounded: true,
    baseline: 0,
    target: 500_000,
    currentValue: over.value ?? 140_000,
    lastReadingAt: NOW - DAY,
    readingCount: 12,
    manual: true,
  },
  ...(over as object),
});

const goal = (
  contributors: ContributorInput[],
  mode: GoalInput['measurementMode'] = 'completion',
): GoalInput => ({
  id: 'g1',
  name: 'Goal',
  measurementMode: mode,
  model: { mode: 'weighted', contributors },
});

describe('the ₹5L MRR shape (docs/14 Case 1)', () => {
  it('computes a weighted mix and explains every input', () => {
    const result = computeProgress(
      goal([
        metricContributor({ weight: 0.4 }),
        {
          kind: 'project',
          refId: 'p1',
          label: 'retainer-platform',
          weight: 0.3,
          evaluation: 'level',
          project: { basis: 'task_based', completedEffort: 13, totalEffort: 21 },
        },
        {
          kind: 'milestone',
          refId: 'ms',
          label: 'milestones',
          weight: 0.2,
          evaluation: 'level',
          milestones: [
            { achieved: true, weight: 1 },
            { achieved: true, weight: 1 },
            { achieved: true, weight: 1 },
            { achieved: false, weight: 1 },
            { achieved: false, weight: 1 },
            { achieved: false, weight: 1 },
          ],
        },
        {
          kind: 'habit',
          refId: 'h1',
          label: 'weekly-outreach',
          weight: 0.1,
          evaluation: 'level',
          habit: { completed: 5, expected: 7 },
        },
      ]),
      ctx,
    );

    expect(result.measurable).toBe(true);
    if (!result.measurable || result.mode !== 'completion') throw new Error('expected completion');

    // 0.4(0.28) + 0.3(0.619) + 0.2(0.5) + 0.1(0.714)
    expect(result.progress.value).toBeCloseTo(0.469, 2);
    expect(result.progress.inputs).toHaveLength(4);
    result.progress.inputs.forEach((input, i) => {
      expect(input.weight).toBeCloseTo([0.4, 0.3, 0.2, 0.1][i] as number, 10);
    });
    expect(result.degraded).toBeNull();

    // The activity proxy declares itself rather than passing as measurement.
    expect(result.progress.caveats.join(' ')).toMatch(/activity proxy/);
  });
});

describe('degradation', () => {
  it('drops an unsatisfied contributor, renormalises, and says why', () => {
    const result = computeProgress(
      goal([
        metricContributor({ weight: 0.5 }),
        {
          kind: 'metric',
          refId: 'm2',
          label: 'active_clients',
          weight: 0.5,
          evaluation: 'level',
          metric: {
            key: 'active_clients',
            direction: 'increase',
            cadence: 'monthly',
            bounded: true,
            baseline: 0,
            target: undefined, // no target — cannot normalise
            currentValue: 4,
            readingCount: 3,
          },
        },
      ]),
      ctx,
    );

    if (!result.measurable || result.mode !== 'completion') throw new Error('expected completion');

    // The surviving contributor renormalises to 1.0, so progress is its value.
    expect(result.progress.value).toBeCloseTo(0.28, 5);
    expect(result.progress.inputs[0]?.weight).toBe(1);

    // But the goal is explicitly flagged, never silently recomputed.
    expect(result.degraded).not.toBeNull();
    expect(result.degraded?.reason).toMatch(/active_clients/);
    expect(result.degraded?.satisfiedRatio).toBeCloseTo(0.5, 5);
  });

  it('refuses to report a number when nothing can be evaluated', () => {
    const result = computeProgress(
      goal([
        {
          kind: 'metric',
          refId: 'm1',
          label: 'projects_shipped',
          weight: 1,
          evaluation: 'level',
          metric: {
            key: 'projects_shipped',
            direction: 'increase',
            cadence: 'monthly',
            bounded: false,
            readingCount: 5,
            currentValue: 3,
          },
        },
      ]),
      ctx,
    );

    expect(result.measurable).toBe(false);
    if (result.measurable) throw new Error('expected unmeasurable');
    expect(result.reason).toMatch(/only as a rate contributor/);
  });
});

/** docs/14 Case 3 — "become a stronger engineer" has no denominator. */
describe('momentum mode', () => {
  const rateContributor = (
    label: string,
    observed: number,
    weight = 1,
  ): ContributorInput => ({
    kind: 'metric',
    refId: label,
    label,
    weight,
    evaluation: 'rate',
    metric: {
      key: label,
      direction: 'increase',
      cadence: 'weekly',
      bounded: false,
      readingCount: 20,
    },
    rate: { observed, windowDays: 90, trailingAverage: 4 },
  });

  it('scores rate against expectation and never reports a percentage', () => {
    const result = computeProgress(
      goal([rateContributor('projects_shipped', 3), rateContributor('features', 11)], 'momentum'),
      ctx,
    );

    if (!result.measurable || result.mode !== 'momentum') throw new Error('expected momentum');
    expect(result.momentum.value).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('progress');
  });

  it('exceeding the expected rate scores above 1', () => {
    const c = rateContributor('projects_shipped', 8);
    c.expectedRate = { value: 1, per: 'month' };
    const result = computeProgress(goal([c], 'momentum'), ctx);

    if (!result.measurable || result.mode !== 'momentum') throw new Error('expected momentum');
    // 8 observed in 90d against 1/month (~3 expected) => >1, capped at 1.5
    expect(result.momentum.value).toBeGreaterThan(1);
    expect(result.momentum.value).toBeLessThanOrEqual(1.5);
  });

  it('keeps a bounded level indicator separate instead of averaging it in', () => {
    const confidence: ContributorInput = {
      kind: 'manual',
      refId: 'eng_conf',
      label: 'engineering_confidence',
      weight: 1,
      evaluation: 'level',
      value: 0.6,
    };

    const result = computeProgress(
      goal([rateContributor('projects_shipped', 3), confidence], 'momentum'),
      ctx,
    );

    if (!result.measurable || result.mode !== 'momentum') throw new Error('expected momentum');
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]?.label).toBe('engineering_confidence');
    expect(result.levels[0]?.value).toBeCloseTo(0.6, 5);
    // It contributed nothing to the momentum score.
    expect(result.momentum.inputs.map((i) => i.label)).toEqual(['projects_shipped']);
  });

  it('rejects a hand-stated percentage on a momentum goal', () => {
    const result = computeProgress(
      { id: 'g', name: 'G', measurementMode: 'momentum', model: { mode: 'manual', value: 0.5 } },
      ctx,
    );
    expect(result.measurable).toBe(false);
  });

  it('falls back to the trailing average when no rate is stated, and says so', () => {
    const result = computeProgress(goal([rateContributor('features', 4)], 'momentum'), ctx);
    if (!result.measurable || result.mode !== 'momentum') throw new Error('expected momentum');
    expect(result.momentum.value).toBeCloseTo(1, 5);
    expect(result.momentum.caveats.join(' ')).toMatch(/trailing average/);
  });
});

describe('properties', () => {
  const arbContributor = fc
    .record({
      value: fc.double({ min: 0, max: 1, noNaN: true }),
      weight: fc.double({ min: 0.01, max: 10, noNaN: true }),
    })
    .map(
      ({ value, weight }, ): ContributorInput => ({
        kind: 'manual',
        refId: `c${Math.random()}`,
        label: 'c',
        weight,
        evaluation: 'level',
        value,
      }),
    );

  it('progress always lands in [0,1] and normalised weights sum to 1', () => {
    fc.assert(
      fc.property(fc.array(arbContributor, { minLength: 1, maxLength: 8 }), (contributors) => {
        const result = computeProgress(goal(contributors), ctx);
        if (!result.measurable || result.mode !== 'completion') return false;

        const sum = result.progress.inputs.reduce((s, i) => s + (i.weight ?? 0), 0);
        return (
          result.progress.value >= 0 &&
          result.progress.value <= 1 &&
          Math.abs(sum - 1) < 1e-9
        );
      }),
    );
  });

  it('progress is monotonic in contributor value', () => {
    fc.assert(
      fc.property(
        fc.array(arbContributor, { minLength: 1, maxLength: 6 }),
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        (contributors, bump) => {
          const before = computeProgress(goal(contributors), ctx);
          const raised = contributors.map((c) =>
            c.kind === 'manual' ? { ...c, value: Math.min(1, c.value + bump) } : c,
          );
          const after = computeProgress(goal(raised), ctx);

          if (!before.measurable || before.mode !== 'completion') return false;
          if (!after.measurable || after.mode !== 'completion') return false;
          return after.progress.value >= before.progress.value - 1e-9;
        },
      ),
    );
  });

  it('is independent of contributor order', () => {
    fc.assert(
      fc.property(fc.array(arbContributor, { minLength: 2, maxLength: 6 }), (contributors) => {
        const a = computeProgress(goal(contributors), ctx);
        const b = computeProgress(goal([...contributors].reverse()), ctx);
        if (!a.measurable || a.mode !== 'completion') return false;
        if (!b.measurable || b.mode !== 'completion') return false;
        return Math.abs(a.progress.value - b.progress.value) < 1e-9;
      }),
    );
  });
});
