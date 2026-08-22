import type {
  Cadence,
  ContributorEvaluation,
  ExpectedRate,
  MeasurementMode,
  MetricDirection,
} from '@aryesh/domain';

/**
 * Inputs to the intelligence core.
 *
 * These are *facts*, not database rows. The engine receives resolved values and
 * returns computed ones; it never reaches for data, a connection, or a clock.
 * `packages/core` is responsible for turning rows into these shapes.
 */

export interface EvalContext {
  /** Injected. The engine never reads the wall clock. */
  now: number;
}

// ---------------------------------------------------------------------------
// Per-kind facts
// ---------------------------------------------------------------------------

export interface MetricFacts {
  key: string;
  direction: MetricDirection;
  cadence: Cadence;
  /** False for counts with no meaningful target; valid only as a rate. */
  bounded: boolean;
  baseline?: number | undefined;
  target?: number | undefined;
  tolerance?: number | undefined;
  /** Latest value. Undefined when the metric has no readings at all. */
  currentValue?: number | undefined;
  /** Earliest recorded value, used when no baseline is set — never zero. */
  firstValue?: number | undefined;
  lastReadingAt?: number | undefined;
  readingCount: number;
  /** Set by the caller when the metric was entered by hand. */
  manual?: boolean | undefined;
}

/** Observed activity over a trailing window, for momentum contributors. */
export interface RateFacts {
  /** Count or sum observed in the window. */
  observed: number;
  windowDays: number;
  /** The contributor's own trailing average, used when no rate is stated. */
  trailingAverage?: number | undefined;
  lastActivityAt?: number | undefined;
}

export interface ProjectFacts {
  /** docs/03 §4.4 — the basis is explicit, never assumed. */
  basis: 'outcome' | 'milestone' | 'manual' | 'task_based';
  /** `manual` and `outcome`: the resolved 0..1 value. */
  value?: number | undefined;
  /** `task_based`: completed and total effort (estimate-weighted). */
  completedEffort?: number | undefined;
  totalEffort?: number | undefined;
  /** `milestone`: achieved and total weight. */
  achievedWeight?: number | undefined;
  totalWeight?: number | undefined;
}

export interface MilestoneFacts {
  achieved: boolean;
  weight: number;
}

export interface HabitFacts {
  completed: number;
  expected: number;
  lastActivityAt?: number | undefined;
}

// ---------------------------------------------------------------------------
// Contributors
// ---------------------------------------------------------------------------

interface ContributorBase {
  refId: string;
  /** Relative; normalised across satisfied contributors at evaluation time. */
  weight: number;
  label: string;
  evaluation: ContributorEvaluation;
  expectedRate?: ExpectedRate | undefined;
  /**
   * Opaque tags naming the underlying evidence, e.g. `milestones:goal_x`.
   * Two contributors sharing a tag are counting the same events twice
   * (docs/03 §5 rule 5).
   */
  sources?: readonly string[] | undefined;
}

export type ContributorInput = ContributorBase &
  (
    | { kind: 'metric'; metric: MetricFacts; rate?: RateFacts | undefined }
    | { kind: 'goal'; progress: number | null; confidence: number }
    | { kind: 'project'; project: ProjectFacts }
    | { kind: 'milestone'; milestones: readonly MilestoneFacts[] }
    | { kind: 'habit'; habit: HabitFacts }
    | { kind: 'manual'; value: number }
  );

export interface GoalInput {
  id: string;
  name: string;
  measurementMode: MeasurementMode;
  model:
    | { mode: 'manual'; value: number }
    | { mode: 'weighted'; contributors: readonly ContributorInput[] }
    | { mode: 'metric'; metric: MetricFacts; label?: string }
    | { mode: 'rollup'; contributors: readonly ContributorInput[] };
}
