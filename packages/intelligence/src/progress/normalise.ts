import { explained, type Explained, type MetricDirection } from '@aryesh/domain';
import { clamp } from '../math.js';

/**
 * docs/03 §4.2 — metric normalisation.
 *
 * This is the one place a sign error would quietly corrupt every number in the
 * product, which is why it is a standalone pure function with property tests
 * rather than three lines inlined in a service.
 */

export interface NormaliseInput {
  direction: MetricDirection;
  /** Latest value. */
  current: number;
  /**
   * Where progress is measured from. The caller resolves a missing baseline to
   * the metric's first recorded reading — NOT to zero. "Revenue grew from ₹80k
   * to ₹90k against a ₹100k target" is 50% progress, not 90%.
   */
  baseline?: number | undefined;
  target?: number | undefined;
  /** Required for `maintain`: the acceptable band either side of target. */
  tolerance?: number | undefined;
  label?: string | undefined;
}

/**
 * An unsatisfied contributor drops out of the weighted mean and the goal is
 * flagged `degraded` with this reason — it never silently reports a different
 * number computed a different way (docs/03 §4 aggregation).
 */
export type Normalised =
  | { satisfied: true; result: Explained<number> }
  | { satisfied: false; reason: string };

const unsatisfied = (reason: string): Normalised => ({ satisfied: false, reason });

export function normaliseMetric(input: NormaliseInput): Normalised {
  const { direction, current, baseline, target, tolerance } = input;

  if (!Number.isFinite(current)) {
    return unsatisfied('no current reading');
  }

  if (direction === 'maintain') {
    if (target === undefined || !Number.isFinite(target)) {
      return unsatisfied('maintain metric has no target value');
    }
    if (tolerance === undefined || !Number.isFinite(tolerance) || tolerance <= 0) {
      return unsatisfied('maintain metric has no tolerance band');
    }
    const drift = Math.abs(current - target);
    const value = 1 - Math.min(1, drift / tolerance);
    return {
      satisfied: true,
      result: explained(clamp(value, 0, 1), 'metric-normalisation', {
        inputs: [
          {
            ref: { kind: 'metric', id: input.label ?? 'metric' },
            label: input.label ?? 'metric',
            value: current,
            detail: `${current} vs target ${target} ±${tolerance}`,
          },
        ],
      }),
    };
  }

  if (target === undefined || !Number.isFinite(target)) {
    return unsatisfied(
      'metric has no target — unbounded metrics are valid only as rate contributors',
    );
  }
  if (baseline === undefined || !Number.isFinite(baseline)) {
    return unsatisfied('metric has no baseline');
  }

  const range = direction === 'increase' ? target - baseline : baseline - target;

  if (range === 0) {
    return unsatisfied('baseline equals target — no range to measure against');
  }
  if (range < 0) {
    return unsatisfied(
      `target ${target} is on the wrong side of baseline ${baseline} for a '${direction}' metric`,
    );
  }

  const travelled = direction === 'increase' ? current - baseline : baseline - current;
  const value = clamp(travelled / range, 0, 1);

  return {
    satisfied: true,
    result: explained(value, 'metric-normalisation', {
      inputs: [
        {
          ref: { kind: 'metric', id: input.label ?? 'metric' },
          label: input.label ?? 'metric',
          value: current,
          detail: `${current} of ${target}, baseline ${baseline}`,
        },
      ],
    }),
  };
}
