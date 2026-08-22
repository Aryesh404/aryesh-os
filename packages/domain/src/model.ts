import type {
  Cadence,
  GoalStatus,
  MeasurementMode,
  MetricDirection,
  MetricSource,
  MetricUnit,
  RelationKind,
  Reversibility,
  ThemeStatus,
} from './enums.js';

/** Epoch milliseconds, UTC. Formatting happens only at the edge. */
export type Timestamp = number;

export type Actor = 'user' | `agent:${string}` | `workflow:${string}` | 'system';

export interface Area {
  id: string;
  name: string;
  color: string;
  icon?: string;
  /** Intended share of attention, 0..1 — see docs/04 §4. */
  targetShare?: number;
  sortOrder: number;
}

/** docs/02 §1 — a named strand of intent, not a calendar bucket. */
export interface Theme {
  id: string;
  areaId: string;
  name: string;
  description?: string;
  why?: string;
  status: ThemeStatus;
  /** Optional. Many themes never have one, and that is the point. */
  targetDate?: Timestamp;
  importance: 1 | 2 | 3 | 4 | 5;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Progress model — docs/03 §4
// ---------------------------------------------------------------------------

export type ContributorKind =
  | 'goal'
  | 'project'
  | 'metric'
  | 'milestone'
  | 'habit'
  | 'manual';

/**
 * `level` normalises to 0..1 against a target (completion mode).
 * `rate` scores recent activity against an expected cadence (momentum mode).
 *
 * Unbounded metrics — counts with no meaningful target — are valid only as
 * `rate`. The engine rejects them as `level` rather than dividing by an
 * undefined target.
 */
export type ContributorEvaluation = 'level' | 'rate';

export interface ExpectedRate {
  value: number;
  per: 'week' | 'month' | 'quarter';
}

export interface Contributor {
  kind: ContributorKind;
  refId: string;
  /** Relative; normalised across satisfied contributors at evaluation time. */
  weight: number;
  evaluation: ContributorEvaluation;
  expectedRate?: ExpectedRate;
  label?: string;
}

export type ProgressModel =
  | { mode: 'manual'; value: number }
  | { mode: 'weighted'; contributors: Contributor[] }
  | { mode: 'metric'; metricId: string }
  | { mode: 'rollup' };

/** docs/04 §2 — not everything grows in a straight line. */
export type ProjectionModel =
  | { kind: 'linear' }
  | {
      kind: 'compounding';
      /** A stated assumption, never a hidden default. Shown in the UI. */
      annualRate: number;
      contribution: { amount: number; per: 'month' };
      /** Scenario fan bounds, e.g. [0.08, 0.10, 0.12]. */
      scenarios?: number[];
    }
  | { kind: 'none' };

export interface Goal {
  id: string;
  areaId: string;
  themeId?: string;
  parentGoalId?: string;
  name: string;
  description?: string;
  why?: string;
  startDate?: Timestamp;
  /** Optional. Undated goals are judged on momentum, not pace. */
  targetDate?: Timestamp;
  status: GoalStatus;
  importance: 1 | 2 | 3 | 4 | 5;
  measurementMode: MeasurementMode;
  progressModel: ProgressModel;
  projectionModel?: ProjectionModel;
  customFields: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Measurement — docs/03
// ---------------------------------------------------------------------------

/** docs/03 §11 — a corpus grows from contributions AND returns. */
export interface MetricComponent {
  key: string;
  label: string;
  /** Contributions are controllable and durable; returns are neither. */
  controllable: boolean;
}

export interface Metric {
  id: string;
  key: string;
  name: string;
  areaId?: string;
  unit: MetricUnit;
  direction: MetricDirection;
  baseline?: number;
  target?: number;
  targetDate?: Timestamp;
  /** For `maintain` metrics: the acceptable band around target. */
  tolerance?: number;
  cadence: Cadence;
  aggregation: 'last' | 'sum' | 'mean' | 'max' | 'min';
  source: MetricSource;
  expression?: string;
  collectorKey?: string;
  components?: MetricComponent[];
  /** False for counts with no meaningful target. Rate-contributor only. */
  bounded: boolean;
  /** Excluded from AI context. */
  private: boolean;
}

export interface Reading {
  id: string;
  metricId: string;
  at: Timestamp;
  value: number;
  /** Null for scalar metrics; set for decomposed ones. */
  component?: string;
  source: 'manual' | 'collector' | 'derived' | 'import';
  note?: string;
  actor: Actor;
}

// ---------------------------------------------------------------------------
// Work — docs/02
// ---------------------------------------------------------------------------

/**
 * docs/03 §4.4 — task completion is activity. Treating it as advancement is the
 * easiest way for this product to lie to its owner, so the basis is explicit.
 */
export type ProjectProgressBasis =
  | { mode: 'outcome'; metricId: string }
  | { mode: 'milestone' }
  | { mode: 'manual'; value: number }
  | { mode: 'task_based' };

export interface Project {
  id: string;
  areaId?: string;
  businessId?: string;
  clientId?: string;
  name: string;
  description?: string;
  status: string;
  startDate?: Timestamp;
  targetDate?: Timestamp;
  completedAt?: Timestamp;
  progressBasis: ProjectProgressBasis;
  localPath?: string;
  repoUrl?: string;
  customFields: Record<string, unknown>;
}

export interface Milestone {
  id: string;
  goalId: string;
  name: string;
  dueDate?: Timestamp;
  achieved: boolean;
  achievedAt?: Timestamp;
  weight: number;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Relations — docs/02 §2
// ---------------------------------------------------------------------------

export interface Relation {
  id: string;
  kind: RelationKind;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  /** `contributes_to` only. */
  weight?: number;
  /** `measures` only — docs/03 §10. User-stated, never inferred. */
  leads?: { targetMetricId: string; lagDays: number };
}

// ---------------------------------------------------------------------------
// Decisions — docs/04 §8
// ---------------------------------------------------------------------------

export interface Decision {
  id: string;
  areaId?: string;
  title: string;
  date: Timestamp;
  context: string;
  choice: string;
  rationale: string;
  alternatives?: string[];
  expectedOutcome?: string;
  /** 0..1 at time of deciding. Feeds calibration analysis. */
  confidence: number;
  reversibility: Reversibility;
  reviewDate?: Timestamp;
  outcome?: {
    assessedAt: Timestamp;
    verdict: 'good' | 'mixed' | 'bad' | 'too_early';
    notes: string;
  };
}
