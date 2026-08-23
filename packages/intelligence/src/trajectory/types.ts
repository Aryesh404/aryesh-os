import type { DatedStatus, MeasurementMode, MomentumStatus } from '@aryesh/domain';

/** docs/04 — Understand. Inputs are snapshots; nothing here reads a clock. */

export interface SnapshotPoint {
  /** Start-of-day UTC epoch ms. */
  date: number;
  /** Completion goals. Null for momentum goals, which have no percentage. */
  progress: number | null;
  /** Momentum goals. 0..1.5, where >1 means exceeding. */
  momentum: number | null;
  confidence: number;
}

/** docs/03 §11 — contributions are durable, returns are borrowed. */
export interface ComponentVelocity {
  key: string;
  label: string;
  controllable: boolean;
  /** Change per day attributable to this component. */
  perDay: number;
}

export type ProjectionModel =
  | { kind: 'linear' }
  | {
      kind: 'compounding';
      /** A stated assumption, never a hidden default. */
      annualRate: number;
      contribution: { amount: number; per: 'month' };
      /** Scenario fan, e.g. [0.08, 0.10, 0.12]. */
      scenarios?: number[];
      /** Current absolute value and target, for compounding in real units. */
      current: number;
      target: number;
    }
  | { kind: 'none' };

export interface TrajectoryInput {
  measurementMode: MeasurementMode;
  /** Absent means undated: judged on momentum, never on lateness. */
  targetDate?: number | undefined;
  startDate?: number | undefined;
  /** Oldest first. */
  snapshots: readonly SnapshotPoint[];
  projection?: ProjectionModel | undefined;
  components?: readonly ComponentVelocity[] | undefined;
  now: number;
}

export interface VelocityWindows {
  /** Change in progress per day. Null when the window has too little history. */
  d7: number | null;
  d30: number | null;
  d90: number | null;
}

export interface ProjectionPoint {
  date: number;
  low: number;
  mid: number;
  high: number;
}

export type Projection =
  | { available: false; reason: string }
  | {
      available: true;
      kind: 'linear' | 'compounding';
      /** The band. Never a bare line (docs/04 §2). */
      band: ProjectionPoint[];
      /** Where it lands at the target date. Dated goals only. */
      atTarget?: { low: number; mid: number; high: number } | undefined;
      /** When it reaches 100%. Null when it never does at this pace. */
      completionDate?: { low: number; mid: number; high: number } | null | undefined;
      /** Compounding only: the assumption the fan was drawn from. */
      assumption?: { annualRate: number; scenarios: number[] } | undefined;
    };

export interface Trajectory {
  vocabulary: 'dated' | 'momentum';
  status: DatedStatus | MomentumStatus;
  velocity: VelocityWindows;
  /** Progress per day needed from here. Null when undated. */
  requiredPace: number | null;
  /** velocity ÷ required. Null when undated — a null here is meaningful. */
  paceRatio: number | null;
  /** Current value the series ends on. */
  current: number | null;
  projection: Projection;
  /** docs/03 §11 — durable vs borrowed growth. */
  attribution?: ComponentVelocity[] | undefined;
  caveats: string[];
  dataPoints: number;
}
