/** Pure numeric helpers. No clock, no randomness, no I/O. */

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Normalises weights across the satisfied contributors only, so an unsatisfied
 * contributor drops out and the rest renormalise (docs/03 §4 aggregation).
 * Returns an empty array when nothing is satisfied — callers treat that as
 * "not measurable", never as zero progress.
 */
export function normaliseWeights(weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  return weights.map((w) => w / total);
}
