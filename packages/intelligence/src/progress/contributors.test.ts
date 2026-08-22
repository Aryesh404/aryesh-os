import { describe, expect, it } from 'vitest';
import { evaluateContributor } from './contributors.js';
import type { ContributorInput } from '../types.js';

const NOW = 1_700_000_000_000;
const ctx = { now: NOW };

const base = {
  refId: 'c1',
  label: 'c1',
  weight: 1,
  evaluation: 'level' as const,
};

const evaluate = (c: ContributorInput) => evaluateContributor(c, ctx);

/**
 * Every unsatisfied path must degrade with a reason rather than throw or
 * silently contribute zero. A contributor that reports 0 when it means "I don't
 * know" would drag a goal's progress down with a number it invented.
 */
describe('project progress basis (docs/03 §4.4)', () => {
  it('outcome and manual use the resolved value', () => {
    const outcome = evaluate({
      ...base,
      kind: 'project',
      project: { basis: 'outcome', value: 0.75 },
    });
    expect(outcome.satisfied && outcome.value).toBe(0.75);
    expect(outcome.satisfied && outcome.confidence).toBe(0.9);

    const manual = evaluate({
      ...base,
      kind: 'project',
      project: { basis: 'manual', value: 0.4 },
    });
    expect(manual.satisfied && manual.confidence).toBe(0.7);
  });

  it('milestone basis divides achieved weight by total', () => {
    const r = evaluate({
      ...base,
      kind: 'project',
      project: { basis: 'milestone', achievedWeight: 3, totalWeight: 4 },
    });
    expect(r.satisfied && r.value).toBe(0.75);
    expect(r.satisfied && r.detail).toMatch(/of deliverables/);
  });

  it('task_based is capped at 0.6 confidence and labels itself an activity proxy', () => {
    const r = evaluate({
      ...base,
      kind: 'project',
      project: { basis: 'task_based', completedEffort: 13, totalEffort: 21 },
    });
    expect(r.satisfied && r.value).toBeCloseTo(13 / 21, 10);
    expect(r.satisfied && r.confidence).toBe(0.6);
    expect(r.satisfied && r.caveats.join(' ')).toMatch(/activity proxy/);
  });

  it('is unsatisfied when the basis has nothing to divide by', () => {
    for (const project of [
      { basis: 'outcome' as const },
      { basis: 'manual' as const },
      { basis: 'milestone' as const, totalWeight: 0 },
      { basis: 'task_based' as const, totalEffort: 0 },
      { basis: 'task_based' as const },
    ]) {
      const r = evaluate({ ...base, kind: 'project', project });
      expect(r.satisfied, JSON.stringify(project)).toBe(false);
    }
  });
});

describe('milestone, habit, goal, manual', () => {
  it('milestones weight by their own weight, not by count', () => {
    const r = evaluate({
      ...base,
      kind: 'milestone',
      milestones: [
        { achieved: true, weight: 3 },
        { achieved: false, weight: 1 },
      ],
    });
    expect(r.satisfied && r.value).toBe(0.75);
    expect(r.satisfied && r.detail).toBe('1 of 2 achieved');
  });

  it('is unsatisfied with no milestones or zero total weight', () => {
    expect(evaluate({ ...base, kind: 'milestone', milestones: [] }).satisfied).toBe(false);
    expect(
      evaluate({
        ...base,
        kind: 'milestone',
        milestones: [{ achieved: true, weight: 0 }],
      }).satisfied,
    ).toBe(false);
  });

  it('habits use consistency and clamp above 1', () => {
    const r = evaluate({ ...base, kind: 'habit', habit: { completed: 5, expected: 7 } });
    expect(r.satisfied && r.value).toBeCloseTo(5 / 7, 10);

    const over = evaluate({ ...base, kind: 'habit', habit: { completed: 9, expected: 7 } });
    expect(over.satisfied && over.value).toBe(1);

    expect(
      evaluate({ ...base, kind: 'habit', habit: { completed: 1, expected: 0 } }).satisfied,
    ).toBe(false);
  });

  it('a sub-goal with no measurable progress degrades rather than counting as zero', () => {
    const r = evaluate({ ...base, kind: 'goal', progress: null, confidence: 0 });
    expect(r.satisfied).toBe(false);
    expect(!r.satisfied && r.reason).toMatch(/no measurable progress/);

    const ok = evaluate({ ...base, kind: 'goal', progress: 0.42, confidence: 0.8 });
    expect(ok.satisfied && ok.value).toBe(0.42);
  });

  it('a manual value is honest about being stated, not measured', () => {
    const r = evaluate({ ...base, kind: 'manual', value: 0.6 });
    expect(r.satisfied && r.caveats.join(' ')).toMatch(/stated by hand/);
    expect(evaluate({ ...base, kind: 'manual', value: Number.NaN }).satisfied).toBe(false);
  });
});

describe('rate evaluation (docs/03 §4.3)', () => {
  const rateBase = {
    ...base,
    evaluation: 'rate' as const,
    kind: 'metric' as const,
    metric: {
      key: 'projects_shipped',
      direction: 'increase' as const,
      cadence: 'monthly' as const,
      bounded: false,
      readingCount: 10,
    },
  };

  it('scores against a stated expected rate', () => {
    const r = evaluate({
      ...rateBase,
      expectedRate: { value: 1, per: 'month' },
      rate: { observed: 3, windowDays: 90 },
    });
    expect(r.satisfied && r.value).toBeCloseTo(1, 1);
    expect(r.satisfied && r.confidence).toBe(0.85);
  });

  it('falls back to the trailing average, with lower confidence and a caveat', () => {
    const r = evaluate({
      ...rateBase,
      rate: { observed: 6, windowDays: 90, trailingAverage: 3 },
    });
    expect(r.satisfied && r.value).toBe(1.5); // clamped
    expect(r.satisfied && r.confidence).toBe(0.7);
    expect(r.satisfied && r.caveats.join(' ')).toMatch(/trailing average/);
  });

  it('is unsatisfied with neither an expected rate nor history', () => {
    const r = evaluate({ ...rateBase, rate: { observed: 3, windowDays: 90 } });
    expect(r.satisfied).toBe(false);
    expect(!r.satisfied && r.reason).toMatch(/no expected rate/);
  });

  it('is unsatisfied when the expected rate is zero', () => {
    const r = evaluate({
      ...rateBase,
      expectedRate: { value: 0, per: 'week' },
      rate: { observed: 3, windowDays: 90 },
    });
    expect(r.satisfied).toBe(false);
    expect(!r.satisfied && r.reason).toMatch(/nothing to measure against/);
  });

  it('is unsatisfied with no observation window at all', () => {
    const r = evaluate({ ...rateBase, rate: undefined });
    expect(r.satisfied).toBe(false);
    expect(!r.satisfied && r.reason).toMatch(/no observed activity window/);
  });

  it('handles quarterly and weekly reference periods', () => {
    const weekly = evaluate({
      ...rateBase,
      expectedRate: { value: 2, per: 'week' },
      rate: { observed: 4, windowDays: 14 },
    });
    expect(weekly.satisfied && weekly.value).toBeCloseTo(1, 5);

    const quarterly = evaluate({
      ...rateBase,
      expectedRate: { value: 6, per: 'quarter' },
      rate: { observed: 3, windowDays: 91 },
    });
    expect(quarterly.satisfied && quarterly.value).toBeCloseTo(0.5, 5);
  });
});

describe('metric level evaluation', () => {
  it('falls back to the first reading when no baseline is set — never zero', () => {
    const r = evaluate({
      ...base,
      kind: 'metric',
      metric: {
        key: 'monthly_revenue',
        direction: 'increase',
        cadence: 'monthly',
        bounded: true,
        firstValue: 80_000,
        target: 100_000,
        currentValue: 90_000,
        lastReadingAt: NOW,
        readingCount: 6,
      },
    });
    // 80k -> 90k against 100k is halfway, not 90%.
    expect(r.satisfied && r.value).toBeCloseTo(0.5, 10);
  });

  it('refuses an unbounded metric as a level contributor', () => {
    const r = evaluate({
      ...base,
      kind: 'metric',
      metric: {
        key: 'projects_shipped',
        direction: 'increase',
        cadence: 'monthly',
        bounded: false,
        currentValue: 3,
        readingCount: 3,
      },
    });
    expect(r.satisfied).toBe(false);
    expect(!r.satisfied && r.reason).toMatch(/only as a rate contributor/);
  });

  it('carries the metric staleness caveat up to the contributor', () => {
    const r = evaluate({
      ...base,
      kind: 'metric',
      metric: {
        key: 'monthly_revenue',
        direction: 'increase',
        cadence: 'weekly',
        bounded: true,
        baseline: 0,
        target: 100,
        currentValue: 50,
        lastReadingAt: NOW - 30 * 86_400_000,
        readingCount: 4,
      },
    });
    expect(r.satisfied && r.caveats.join(' ')).toMatch(/last read 30d ago/);
    expect(r.satisfied && r.confidence).toBeLessThan(0.5);
  });
});
