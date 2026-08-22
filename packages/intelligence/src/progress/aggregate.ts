import { explained, type Explained, type MeasurementMode } from '@aryesh/domain';
import { clamp, normaliseWeights } from '../math.js';
import { aggregateConfidence } from './confidence.js';
import { evaluateContributor, type ContributorResult, type SatisfiedContributor, type UnsatisfiedContributor } from './contributors.js';
import type { ContributorInput, EvalContext, GoalInput } from '../types.js';

/**
 * docs/03 §4 — the weighted combination, and the rules that keep the number
 * honest when reality does not cooperate.
 */

export interface Degradation {
  /** Plain-language cause, surfaced on the goal (docs/03 §4 aggregation). */
  reason: string;
  unsatisfied: UnsatisfiedContributor[];
  /** Share of the intended model, by weight, that actually reported. */
  satisfiedRatio: number;
}

/** A bounded signal on a momentum goal — shown as a level, never averaged in. */
export interface LevelIndicator {
  refId: string;
  label: string;
  value: number;
  detail: string;
  confidence: number;
}

export type ProgressOutcome =
  | {
      measurable: true;
      mode: 'completion';
      /** 0..1. */
      progress: Explained<number>;
      degraded: Degradation | null;
    }
  | {
      measurable: true;
      mode: 'momentum';
      /** 0..1.5, where >1 means exceeding the expected rate. Not a percentage. */
      momentum: Explained<number>;
      levels: LevelIndicator[];
      degraded: Degradation | null;
    }
  | { measurable: false; mode: MeasurementMode; reason: string };

function contributorsOf(model: GoalInput['model']): readonly ContributorInput[] {
  switch (model.mode) {
    case 'weighted':
    case 'rollup':
      return model.contributors;
    case 'metric':
      return [
        {
          kind: 'metric',
          refId: model.metric.key,
          label: model.label ?? model.metric.key,
          weight: 1,
          evaluation: 'level',
          metric: model.metric,
        },
      ];
    case 'manual':
      return [];
  }
}

function summarise(unsatisfied: UnsatisfiedContributor[]): string {
  if (unsatisfied.length === 1) {
    return `${unsatisfied[0]?.label}: ${unsatisfied[0]?.reason}`;
  }
  return `${unsatisfied.length} contributors could not be evaluated: ${unsatisfied
    .map((u) => u.label)
    .join(', ')}`;
}

function weightedMean(
  satisfied: SatisfiedContributor[],
  upperBound: number,
): { value: number; parts: Array<{ normalisedWeight: number; confidence: number }> } {
  const normalised = normaliseWeights(satisfied.map((s) => s.weight));
  const parts = satisfied.map((s, i) => ({
    normalisedWeight: normalised[i] ?? 0,
    confidence: s.confidence,
  }));
  const value = satisfied.reduce((sum, s, i) => sum + (normalised[i] ?? 0) * s.value, 0);
  return { value: clamp(value, 0, upperBound), parts };
}

export function computeProgress(goal: GoalInput, ctx: EvalContext): ProgressOutcome {
  const mode = goal.measurementMode;

  if (goal.model.mode === 'manual') {
    const value = clamp(goal.model.value, 0, 1);
    if (mode === 'momentum') {
      return {
        measurable: false,
        mode,
        reason: 'a momentum goal cannot take a manually stated percentage',
      };
    }
    return {
      measurable: true,
      mode: 'completion',
      progress: explained(value, 'manual', {
        confidence: 0.8,
        caveats: ['stated by hand, not measured'],
      }),
      degraded: null,
    };
  }

  const inputs = contributorsOf(goal.model);
  if (inputs.length === 0) {
    return { measurable: false, mode, reason: 'no contributors configured' };
  }

  const results: ContributorResult[] = inputs.map((c) => evaluateContributor(c, ctx));

  // docs/03 §4.0 and docs/14 Case 3 — the two modes consume different signals,
  // and mixing them would either invent a percentage or bury a rate.
  const wantedEvaluation = mode === 'momentum' ? 'rate' : 'level';
  const relevant: ContributorResult[] = [];
  const levels: LevelIndicator[] = [];

  results.forEach((r, i) => {
    const input = inputs[i];
    if (input === undefined) return;
    if (input.evaluation === wantedEvaluation) {
      relevant.push(r);
      return;
    }
    if (mode === 'momentum' && r.satisfied) {
      // A bounded signal on a momentum goal stays visible as a level. Blending
      // a self-rated score with a shipping rate produces a number that means
      // nothing; two honest signals beat one dishonest one.
      levels.push({
        refId: r.refId,
        label: r.label,
        value: r.value,
        detail: r.detail,
        confidence: r.confidence,
      });
      return;
    }
    if (mode === 'completion') {
      relevant.push({
        satisfied: false,
        refId: input.refId,
        kind: input.kind,
        label: input.label,
        weight: input.weight,
        reason: 'rate contributors belong to a momentum goal, not a completion goal',
      });
    }
  });

  const satisfied = relevant.filter((r): r is SatisfiedContributor => r.satisfied);
  const unsatisfied = relevant.filter((r): r is UnsatisfiedContributor => !r.satisfied);

  const totalWeight = relevant.reduce((s, r) => s + r.weight, 0);
  const satisfiedWeight = satisfied.reduce((s, r) => s + r.weight, 0);
  const satisfiedRatio = totalWeight > 0 ? satisfiedWeight / totalWeight : 0;

  if (satisfied.length === 0) {
    return {
      measurable: false,
      mode,
      reason:
        unsatisfied.length > 0
          ? summarise(unsatisfied)
          : 'no contributors could be evaluated',
    };
  }

  const degraded: Degradation | null =
    unsatisfied.length > 0
      ? { reason: summarise(unsatisfied), unsatisfied, satisfiedRatio }
      : null;

  const upperBound = mode === 'momentum' ? 1.5 : 1;
  const { value, parts } = weightedMean(satisfied, upperBound);
  const confidence = aggregateConfidence(parts, satisfiedRatio);

  const caveats = [
    ...satisfied.flatMap((s) => s.caveats.map((c) => `${s.label}: ${c}`)),
    ...(degraded ? [degraded.reason] : []),
  ];

  const inputsExplained = satisfied.map((s, i) => ({
    ref: { kind: s.kind, id: s.refId },
    label: s.label,
    value: s.value,
    weight: parts[i]?.normalisedWeight ?? 0,
    detail: s.detail,
  }));

  if (mode === 'momentum') {
    return {
      measurable: true,
      mode: 'momentum',
      momentum: explained(value, 'rate-vs-expected', {
        inputs: inputsExplained,
        confidence,
        caveats,
      }),
      levels,
      degraded,
    };
  }

  return {
    measurable: true,
    mode: 'completion',
    progress: explained(value, 'weighted-mean', {
      inputs: inputsExplained,
      confidence,
      caveats,
    }),
    degraded,
  };
}
