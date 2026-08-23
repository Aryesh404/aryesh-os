export { clamp, normaliseWeights } from './math.js';
export * from './time.js';
export * from './types.js';

export { normaliseMetric } from './progress/normalise.js';
export type { NormaliseInput, Normalised } from './progress/normalise.js';

export {
  computeConfidence,
  aggregateConfidence,
  freshness,
  density,
} from './progress/confidence.js';
export type { ConfidenceInput, ConfidenceResult } from './progress/confidence.js';

export { evaluateContributor } from './progress/contributors.js';
export type {
  ContributorResult,
  SatisfiedContributor,
  UnsatisfiedContributor,
} from './progress/contributors.js';

export { computeProgress } from './progress/aggregate.js';
export type { ProgressOutcome, Degradation, LevelIndicator } from './progress/aggregate.js';

export { findOverlaps } from './progress/overlap.js';
export type { Overlap } from './progress/overlap.js';

export * from './trajectory/index.js';
export * from './expressions/index.js';
