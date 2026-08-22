/**
 * Closed vocabularies. These are `as const` objects rather than TS enums so the
 * values survive `isolatedModules` and can be iterated at runtime.
 */

/** docs/02 §2 — six fixed relations. Only `contributes_to` affects progress. */
export const RELATION_KINDS = [
  'contributes_to',
  'belongs_to',
  'depends_on',
  'measures',
  'informed_by',
  'relates_to',
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** docs/03 §4.0 — not everything worth tracking can be a percentage. */
export const MEASUREMENT_MODES = ['completion', 'momentum'] as const;
export type MeasurementMode = (typeof MEASUREMENT_MODES)[number];

/** docs/04 §3 — dated things are judged against a deadline. */
export const DATED_STATUSES = [
  'ahead',
  'on_track',
  'at_risk',
  'behind',
  'stalled',
  'unknown',
] as const;
export type DatedStatus = (typeof DATED_STATUSES)[number];

/** docs/04 §3 — undated things are judged on momentum. Nothing is late that was never due. */
export const MOMENTUM_STATUSES = [
  'advancing',
  'steady',
  'slowing',
  'stalled',
  'unknown',
] as const;
export type MomentumStatus = (typeof MOMENTUM_STATUSES)[number];

export type TrajectoryStatus = DatedStatus | MomentumStatus;

export const METRIC_DIRECTIONS = ['increase', 'decrease', 'maintain'] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export const METRIC_UNITS = [
  'currency',
  'count',
  'percent',
  'duration',
  'score',
  'ratio',
  'weight',
  'custom',
] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const METRIC_SOURCES = ['manual', 'derived', 'computed', 'external'] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

export const CADENCES = ['daily', 'weekly', 'monthly', 'quarterly', 'adhoc'] as const;
export type Cadence = (typeof CADENCES)[number];

export const GOAL_STATUSES = [
  'active',
  'achieved',
  'missed',
  'abandoned',
  'paused',
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const THEME_STATUSES = ['active', 'paused', 'achieved', 'retired'] as const;
export type ThemeStatus = (typeof THEME_STATUSES)[number];

export const REVERSIBILITY = ['easy', 'costly', 'irreversible'] as const;
export type Reversibility = (typeof REVERSIBILITY)[number];
