import type { Cadence } from '@aryesh/domain';
import { clamp } from '../math.js';
import { cadencePeriodMs, expectedReadings, isStale } from '../time.js';

/**
 * docs/03 §6 — every progress figure carries a confidence, because a number
 * computed from three-week-old data deserves to look different from a fresh one.
 */

export interface ConfidenceInput {
  cadence: Cadence;
  lastReadingAt?: number | undefined;
  firstReadingAt?: number | undefined;
  readingCount: number;
  manual?: boolean | undefined;
  now: number;
}

export interface ConfidenceResult {
  value: number;
  freshness: number;
  density: number;
  stale: boolean;
  caveats: string[];
}

/**
 * 1 when a reading arrived just now, decaying to 0 at twice the cadence.
 * An `adhoc` metric has no expected rhythm, so it cannot be late: freshness is
 * neutral (1) rather than punished for a schedule it never had.
 */
export function freshness(
  cadence: Cadence,
  lastReadingAt: number | undefined,
  now: number,
): number {
  const period = cadencePeriodMs(cadence);
  if (period === null) return lastReadingAt === undefined ? 0 : 1;
  if (lastReadingAt === undefined) return 0;
  const age = Math.max(0, now - lastReadingAt);
  return clamp(1 - age / (2 * period), 0, 1);
}

/** How much of the history a metric should have, it actually has. */
export function density(
  cadence: Cadence,
  firstReadingAt: number | undefined,
  readingCount: number,
  now: number,
): number {
  const expected = expectedReadings(cadence, firstReadingAt, now);
  if (expected === null || expected <= 0) return readingCount > 0 ? 1 : 0;
  return clamp(readingCount / expected, 0, 1);
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const f = freshness(input.cadence, input.lastReadingAt, input.now);
  const d = density(input.cadence, input.firstReadingAt, input.readingCount, input.now);
  const provenance = input.manual ? 1 : 0.8;

  const value = clamp(0.6 * f + 0.3 * d + 0.1 * provenance, 0, 1);
  const stale = isStale(input.cadence, input.lastReadingAt, input.now);

  const caveats: string[] = [];
  if (input.readingCount === 0) caveats.push('no readings recorded');
  else if (stale) {
    const days = Math.floor((input.now - (input.lastReadingAt ?? input.now)) / 86_400_000);
    caveats.push(`last read ${days}d ago (cadence: ${input.cadence})`);
  }
  if (d < 0.5 && input.readingCount > 0) {
    caveats.push('sparse history for its cadence');
  }

  return { value, freshness: f, density: d, stale, caveats };
}

/**
 * Confidence of a whole goal: the weighted mean of its contributors' confidence,
 * scaled by how much of the intended model is actually satisfied. A goal whose
 * contributors half dropped out is not as trustworthy as one where they all
 * reported (docs/03 §6).
 */
export function aggregateConfidence(
  parts: ReadonlyArray<{ normalisedWeight: number; confidence: number }>,
  satisfiedRatio: number,
): number {
  if (parts.length === 0) return 0;
  const weighted = parts.reduce((sum, p) => sum + p.normalisedWeight * p.confidence, 0);
  return clamp(weighted * clamp(satisfiedRatio, 0, 1), 0, 1);
}
