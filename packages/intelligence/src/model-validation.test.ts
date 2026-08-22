import { describe, expect, it } from 'vitest';
import { computeProgress } from './progress/aggregate.js';
import { findOverlaps } from './progress/overlap.js';
import type { ContributorInput, GoalInput } from './types.js';

/**
 * Conformance test for docs/14 — the four real goals the engine was designed
 * against, run through the actual engine rather than reasoned about on paper.
 *
 * If a change here starts failing, the engine has stopped representing one of
 * the shapes it exists to represent.
 */

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const ctx = { now: NOW };

// ---------------------------------------------------------------------------
// Case 1 — Business: ₹5L MRR by March 2027. Dated, completion, single metric,
// with supporting metrics that must NOT score.
// ---------------------------------------------------------------------------

describe('Case 1 — ₹5L MRR by March 2027', () => {
  const goal: GoalInput = {
    id: 'mrr',
    name: '₹5L MRR by March 2027',
    measurementMode: 'completion',
    model: {
      mode: 'metric',
      label: 'monthly_revenue',
      metric: {
        key: 'monthly_revenue',
        direction: 'increase',
        cadence: 'monthly',
        bounded: true,
        baseline: 0,
        target: 500_000,
        currentValue: 140_000,
        lastReadingAt: NOW - 9 * DAY,
        readingCount: 14,
        manual: true,
      },
    },
  };

  it('reports 28% with the derivation attached', () => {
    const result = computeProgress(goal, ctx);
    if (!result.measurable || result.mode !== 'completion') throw new Error('expected completion');

    expect(result.progress.value).toBeCloseTo(0.28, 5);
    expect(result.progress.inputs[0]?.detail).toBe('140000 of 500000, baseline 0');
    expect(result.progress.confidence).toBeGreaterThan(0.7);
  });

  it('a supporting metric never enters the number', () => {
    // Leads are evidence about future revenue, not a fraction of it. They are
    // attached with `measures`, which the progress engine never reads — so the
    // single-metric model has exactly one input regardless of how many
    // diagnostics hang off the goal.
    const result = computeProgress(goal, ctx);
    if (!result.measurable || result.mode !== 'completion') throw new Error('expected completion');
    expect(result.progress.inputs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Case 2 — Finance: ₹1 Cr corpus. Decomposed metric; progress uses the total,
// while the components stay separable for attribution.
// ---------------------------------------------------------------------------

describe('Case 2 — ₹1 Cr invested corpus', () => {
  const CONTRIBUTIONS = 2_600_000;
  const RETURNS = 1_500_000;

  const goal: GoalInput = {
    id: 'corpus',
    name: '₹1 Cr invested corpus',
    measurementMode: 'completion',
    model: {
      mode: 'metric',
      label: 'invested_corpus',
      metric: {
        key: 'invested_corpus',
        direction: 'increase',
        cadence: 'monthly',
        bounded: true,
        baseline: 0,
        target: 10_000_000,
        currentValue: CONTRIBUTIONS + RETURNS,
        lastReadingAt: NOW - 2 * DAY,
        readingCount: 24,
        manual: true,
      },
    },
  };

  it('measures the total, because ₹1 Cr is ₹1 Cr regardless of source', () => {
    const result = computeProgress(goal, ctx);
    if (!result.measurable || result.mode !== 'completion') throw new Error('expected completion');
    expect(result.progress.value).toBeCloseTo(0.41, 5);
  });

  it('an undated corpus goal still reports a percentage', () => {
    // docs/04 §3 — a completion goal without a target date has a meaningful
    // percentage but no pace to be behind on. The progress engine is
    // indifferent to the date; only trajectory cares.
    const result = computeProgress(goal, ctx);
    expect(result.measurable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case 3 — Career: momentum. Unbounded counts plus one bounded self-rating.
// ---------------------------------------------------------------------------

describe('Case 3 — Become a stronger engineer', () => {
  const rate = (key: string, observed: number, expected?: number): ContributorInput => ({
    kind: 'metric',
    refId: key,
    label: key,
    weight: 1,
    evaluation: 'rate',
    ...(expected !== undefined
      ? { expectedRate: { value: expected, per: 'month' as const } }
      : {}),
    metric: {
      key,
      direction: 'increase',
      cadence: 'monthly',
      bounded: false,
      readingCount: 12,
    },
    rate: { observed, windowDays: 90, trailingAverage: 3 },
  });

  const goal: GoalInput = {
    id: 'engineer',
    name: 'Improve software architecture + AI-assisted development',
    measurementMode: 'momentum',
    model: {
      mode: 'weighted',
      contributors: [
        rate('projects_shipped', 3, 1),
        rate('major_features_shipped', 11, 3),
        rate('architecture_decisions', 7, 2),
        rate('ai_projects_built', 2, 1),
        {
          kind: 'manual',
          refId: 'engineering_confidence',
          label: 'engineering_confidence',
          weight: 1,
          evaluation: 'level',
          value: 0.6,
        },
      ],
    },
  };

  it('reports momentum, never a percentage', () => {
    const result = computeProgress(goal, ctx);
    if (!result.measurable || result.mode !== 'momentum') throw new Error('expected momentum');
    expect(result).not.toHaveProperty('progress');
    expect(result.momentum.value).toBeGreaterThan(0);
  });

  it('keeps the self-rating as a separate level, not blended into the score', () => {
    const result = computeProgress(goal, ctx);
    if (!result.measurable || result.mode !== 'momentum') throw new Error('expected momentum');

    expect(result.levels.map((l) => l.label)).toEqual(['engineering_confidence']);
    expect(result.momentum.inputs.map((i) => i.label)).toEqual([
      'projects_shipped',
      'major_features_shipped',
      'architecture_decisions',
      'ai_projects_built',
    ]);
  });

  it('would refuse the same unbounded metrics as a completion goal', () => {
    const asCompletion: GoalInput = {
      ...goal,
      measurementMode: 'completion',
      model: {
        mode: 'weighted',
        contributors: [rate('projects_shipped', 3, 1)],
      },
    };
    const result = computeProgress(asCompletion, ctx);
    expect(result.measurable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case 4 — Aryesh OS: two goals wearing a conjunction, plus a double count.
// ---------------------------------------------------------------------------

describe('Case 4 — Aryesh OS', () => {
  const milestones = [
    { achieved: true, weight: 0.25 }, // measurement engine
    { achieved: false, weight: 0.2 }, // visualization
    { achieved: false, weight: 0.15 }, // goal tracking
    { achieved: false, weight: 0.15 }, // finance
    { achieved: false, weight: 0.15 }, // Claude
    { achieved: false, weight: 0.1 }, // mobile
  ];

  const shipV1: GoalInput = {
    id: 'ship_v1',
    name: 'Ship v1',
    measurementMode: 'completion',
    model: {
      mode: 'weighted',
      contributors: [
        {
          kind: 'milestone',
          refId: 'v1_milestones',
          label: 'v1 milestones',
          weight: 1,
          evaluation: 'level',
          sources: ['milestones:ship_v1'],
          milestones,
        },
      ],
    },
  };

  const adopt: GoalInput = {
    id: 'adopt',
    name: 'Adopt as my daily progress system',
    measurementMode: 'momentum',
    model: {
      mode: 'weighted',
      contributors: [
        {
          kind: 'metric',
          refId: 'weekly_active_usage',
          label: 'weekly_active_usage',
          weight: 1,
          evaluation: 'rate',
          expectedRate: { value: 5, per: 'week' },
          metric: {
            key: 'weekly_active_usage',
            direction: 'increase',
            cadence: 'weekly',
            bounded: false,
            readingCount: 4,
          },
          rate: { observed: 0, windowDays: 28 },
        },
      ],
    },
  };

  it('shipping is completion and adoption is momentum — the split is the point', () => {
    const ship = computeProgress(shipV1, ctx);
    if (!ship.measurable || ship.mode !== 'completion') throw new Error('expected completion');
    expect(ship.progress.value).toBeCloseTo(0.25, 5);

    const adoption = computeProgress(adopt, ctx);
    if (!adoption.measurable || adoption.mode !== 'momentum') throw new Error('expected momentum');
    // Built but unused: the failure this product is most likely to hide.
    expect(adoption.momentum.value).toBe(0);
  });

  it('catches the metric that double-counts the milestone set', () => {
    const overlaps = findOverlaps([
      {
        kind: 'milestone',
        refId: 'v1_milestones',
        label: 'v1 milestones',
        weight: 0.5,
        evaluation: 'level',
        sources: ['milestones:ship_v1'],
        milestones,
      },
      {
        kind: 'metric',
        refId: 'core_modules_completed',
        label: 'core_modules_completed',
        weight: 0.5,
        evaluation: 'level',
        sources: ['milestones:ship_v1'],
        metric: {
          key: 'core_modules_completed',
          direction: 'increase',
          cadence: 'monthly',
          bounded: true,
          baseline: 0,
          target: 6,
          currentValue: 1,
          readingCount: 3,
        },
      },
    ]);

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.kind).toBe('shared_source');
  });
});
