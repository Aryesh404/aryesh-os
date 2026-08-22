import { clamp } from '../math.js';
import { DAY_MS, perPeriodMs } from '../time.js';
import { computeConfidence } from './confidence.js';
import { normaliseMetric } from './normalise.js';
import type { ContributorInput, EvalContext, ProjectFacts, RateFacts } from '../types.js';

export interface SatisfiedContributor {
  satisfied: true;
  refId: string;
  kind: ContributorInput['kind'];
  label: string;
  weight: number;
  /** 0..1 for level evaluation; 0..1.5 for rate, where >1 means exceeding. */
  value: number;
  confidence: number;
  detail: string;
  caveats: string[];
}

export interface UnsatisfiedContributor {
  satisfied: false;
  refId: string;
  kind: ContributorInput['kind'];
  label: string;
  weight: number;
  reason: string;
}

export type ContributorResult = SatisfiedContributor | UnsatisfiedContributor;

/**
 * How much a project's progress can be trusted, by what it is derived from
 * (docs/03 §4.4). `task_based` is capped because counting closed tasks measures
 * motion, not distance — the cap is what stops an activity proxy from carrying
 * the same authority as a real outcome measure.
 */
const BASIS_CONFIDENCE: Record<ProjectFacts['basis'], number> = {
  outcome: 0.9,
  milestone: 0.85,
  manual: 0.7,
  task_based: 0.6,
};

const unsatisfied = (
  c: ContributorInput,
  reason: string,
): UnsatisfiedContributor => ({
  satisfied: false,
  refId: c.refId,
  kind: c.kind,
  label: c.label,
  weight: c.weight,
  reason,
});

function evaluateRate(
  c: ContributorInput,
  rate: RateFacts,
): SatisfiedContributor | UnsatisfiedContributor {
  const windowMs = rate.windowDays * DAY_MS;

  let reference: number | undefined;
  let referenceLabel: string;

  if (c.expectedRate !== undefined) {
    reference = c.expectedRate.value * (windowMs / perPeriodMs(c.expectedRate.per));
    referenceLabel = `${c.expectedRate.value}/${c.expectedRate.per}`;
  } else if (rate.trailingAverage !== undefined && rate.trailingAverage > 0) {
    // docs/03 §4.3 — "am I holding up against how I have actually been
    // operating?" beats a number invented at setup time.
    reference = rate.trailingAverage;
    referenceLabel = 'your trailing 90-day average';
  } else {
    return unsatisfied(
      c,
      'no expected rate stated and no history to compare against yet',
    );
  }

  if (reference <= 0) {
    return unsatisfied(c, 'expected rate is zero, so there is nothing to measure against');
  }

  const value = clamp(rate.observed / reference, 0, 1.5);
  const caveats: string[] = [];
  if (c.expectedRate === undefined) caveats.push('compared against your own trailing average');

  return {
    satisfied: true,
    refId: c.refId,
    kind: c.kind,
    label: c.label,
    weight: c.weight,
    value,
    confidence: c.expectedRate === undefined ? 0.7 : 0.85,
    detail: `${round(rate.observed)} in ${rate.windowDays}d vs ${referenceLabel}`,
    caveats,
  };
}

const round = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');

export function evaluateContributor(
  c: ContributorInput,
  ctx: EvalContext,
): ContributorResult {
  if (c.evaluation === 'rate') {
    const rate = c.kind === 'metric' ? c.rate : undefined;
    if (rate === undefined) {
      return unsatisfied(c, 'rate contributor has no observed activity window');
    }
    return evaluateRate(c, rate);
  }

  switch (c.kind) {
    case 'metric': {
      const m = c.metric;

      if (!m.bounded) {
        return unsatisfied(
          c,
          `'${m.key}' has no meaningful target — an unbounded metric is valid only as a rate contributor`,
        );
      }

      const normalised = normaliseMetric({
        direction: m.direction,
        current: m.currentValue ?? Number.NaN,
        // Missing baseline falls back to the first recorded reading, never zero.
        baseline: m.baseline ?? m.firstValue,
        target: m.target,
        tolerance: m.tolerance,
        label: m.key,
      });

      if (!normalised.satisfied) return unsatisfied(c, normalised.reason);

      const conf = computeConfidence({
        cadence: m.cadence,
        lastReadingAt: m.lastReadingAt,
        firstReadingAt: m.firstReadingAt,
        readingCount: m.readingCount,
        manual: m.manual,
        now: ctx.now,
      });

      return {
        satisfied: true,
        refId: c.refId,
        kind: c.kind,
        label: c.label,
        weight: c.weight,
        value: normalised.result.value,
        confidence: conf.value,
        detail: normalised.result.inputs[0]?.detail ?? '',
        caveats: conf.caveats,
      };
    }

    case 'goal': {
      if (c.progress === null) {
        return unsatisfied(c, 'sub-goal has no measurable progress yet');
      }
      return {
        satisfied: true,
        refId: c.refId,
        kind: c.kind,
        label: c.label,
        weight: c.weight,
        value: clamp(c.progress, 0, 1),
        confidence: clamp(c.confidence, 0, 1),
        detail: `${pct(c.progress)} of sub-goal`,
        caveats: [],
      };
    }

    case 'project': {
      const p = c.project;
      const resolved = resolveProject(p);
      if (resolved === null) {
        return unsatisfied(c, `project progress basis '${p.basis}' has no value yet`);
      }
      const caveats =
        p.basis === 'task_based'
          ? ['task completion is an activity proxy, not measured advancement']
          : [];
      return {
        satisfied: true,
        refId: c.refId,
        kind: c.kind,
        label: c.label,
        weight: c.weight,
        value: resolved.value,
        confidence: BASIS_CONFIDENCE[p.basis],
        detail: resolved.detail,
        caveats,
      };
    }

    case 'milestone': {
      const total = c.milestones.reduce((s, m) => s + m.weight, 0);
      if (c.milestones.length === 0 || total <= 0) {
        return unsatisfied(c, 'no milestones defined');
      }
      const achieved = c.milestones
        .filter((m) => m.achieved)
        .reduce((s, m) => s + m.weight, 0);
      const count = c.milestones.filter((m) => m.achieved).length;
      return {
        satisfied: true,
        refId: c.refId,
        kind: c.kind,
        label: c.label,
        weight: c.weight,
        value: clamp(achieved / total, 0, 1),
        confidence: 0.9,
        detail: `${count} of ${c.milestones.length} achieved`,
        caveats: [],
      };
    }

    case 'habit': {
      const h = c.habit;
      if (h.expected <= 0) return unsatisfied(c, 'habit has no expected occurrences');
      return {
        satisfied: true,
        refId: c.refId,
        kind: c.kind,
        label: c.label,
        weight: c.weight,
        value: clamp(h.completed / h.expected, 0, 1),
        confidence: 0.85,
        detail: `${h.completed} of ${h.expected}`,
        caveats: [],
      };
    }

    case 'manual': {
      if (!Number.isFinite(c.value)) return unsatisfied(c, 'no value stated');
      return {
        satisfied: true,
        refId: c.refId,
        kind: c.kind,
        label: c.label,
        weight: c.weight,
        value: clamp(c.value, 0, 1),
        confidence: 0.8,
        detail: `${pct(c.value)}, stated by hand`,
        caveats: ['stated by hand, not measured'],
      };
    }
  }
}

function resolveProject(p: ProjectFacts): { value: number; detail: string } | null {
  switch (p.basis) {
    case 'outcome':
    case 'manual':
      return p.value === undefined
        ? null
        : { value: clamp(p.value, 0, 1), detail: pct(p.value) };
    case 'milestone': {
      if (p.totalWeight === undefined || p.totalWeight <= 0) return null;
      const value = clamp((p.achievedWeight ?? 0) / p.totalWeight, 0, 1);
      return { value, detail: `${pct(value)} of deliverables` };
    }
    case 'task_based': {
      if (p.totalEffort === undefined || p.totalEffort <= 0) return null;
      const value = clamp((p.completedEffort ?? 0) / p.totalEffort, 0, 1);
      return {
        value,
        detail: `${round(p.completedEffort ?? 0)} of ${round(p.totalEffort)} effort closed`,
      };
    }
  }
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
