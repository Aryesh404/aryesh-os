import { clamp } from '../math.js';
import { DAY_MS } from '../time.js';
import { latest, valueOf, velocityDispersion } from './velocity.js';
import type {
  Projection,
  ProjectionModel,
  ProjectionPoint,
  SnapshotPoint,
  VelocityWindows,
} from './types.js';

/**
 * docs/04 §2 — projection, and the gates that stop it being astrology.
 *
 * A projection from three data points is not a forecast, it is a decoration
 * that costs the user their trust in every other number. These gates are
 * enforced here, in the engine, not left to the UI to remember.
 */

/** Below this, no projection is drawn at all. */
export const MIN_SNAPSHOTS = 5;
/** Below this, the band doubles and the projection is labelled low-confidence. */
export const LOW_CONFIDENCE = 0.4;

const BAND_STEPS = 24;

export interface ProjectOptions {
  snapshots: readonly SnapshotPoint[];
  velocity: VelocityWindows;
  confidence: number;
  now: number;
  targetDate?: number | undefined;
  model?: ProjectionModel | undefined;
}

export function project(options: ProjectOptions): Projection {
  const { snapshots, now, targetDate } = options;
  const model = options.model ?? { kind: 'linear' };

  if (model.kind === 'none') {
    return { available: false, reason: 'projection is switched off for this goal' };
  }

  const usable = snapshots.filter((s) => valueOf(s) !== null);
  if (usable.length < MIN_SNAPSHOTS) {
    return {
      available: false,
      reason: `not enough history yet — ${MIN_SNAPSHOTS} days of data needed, ${usable.length} so far`,
    };
  }

  const end = latest(snapshots);
  const current = end ? valueOf(end) : null;
  if (end === undefined || current === null) {
    return { available: false, reason: 'no readings to project from' };
  }

  if (targetDate !== undefined && targetDate <= now) {
    return {
      available: false,
      reason: 'the target date has passed — this is an outcome now, not a forecast',
    };
  }

  return model.kind === 'compounding'
    ? compounding({ ...options, model, current, from: end.date })
    : linear({ ...options, current, from: end.date });
}

/** The straight line. Correct for anything not growing on its own base. */
function linear(
  options: ProjectOptions & { current: number; from: number },
): Projection {
  const { velocity, confidence, now, targetDate, current, from } = options;

  const rate = velocity.d30 ?? velocity.d7 ?? velocity.d90;
  if (rate === null) {
    return { available: false, reason: 'not enough history to establish a rate' };
  }
  if (rate <= 0) {
    return {
      available: false,
      reason: 'nothing is moving — there is no pace to project from',
    };
  }

  // The band comes from how much the windowed velocities disagree, widened by
  // how little the underlying data is trusted.
  const spread = velocityDispersion(velocity) + rate * (1 - clamp(confidence, 0, 1));
  const low = Math.max(0, rate - spread);
  const high = rate + spread;

  const horizon = targetDate ?? now + 180 * DAY_MS;
  const span = Math.max(DAY_MS, horizon - from);

  const band: ProjectionPoint[] = [];
  for (let i = 0; i <= BAND_STEPS; i++) {
    const date = from + (span * i) / BAND_STEPS;
    const days = (date - from) / DAY_MS;
    band.push({
      date,
      low: clamp(current + low * days, 0, 1),
      mid: clamp(current + rate * days, 0, 1),
      high: clamp(current + high * days, 0, 1),
    });
  }

  const daysTo = (velocityValue: number): number | null =>
    velocityValue > 0 ? (1 - current) / velocityValue : null;

  const midDays = daysTo(rate);
  const lowDays = daysTo(low);
  const highDays = daysTo(high);

  const result: Projection = {
    available: true,
    kind: 'linear',
    band,
    completionDate:
      midDays === null
        ? null
        : {
            // A faster rate arrives sooner, so `high` velocity is the early date.
            low: from + (highDays ?? midDays) * DAY_MS,
            mid: from + midDays * DAY_MS,
            high: lowDays === null ? Number.POSITIVE_INFINITY : from + lowDays * DAY_MS,
          },
  };

  if (targetDate !== undefined) {
    const days = (targetDate - from) / DAY_MS;
    return {
      ...result,
      atTarget: {
        low: clamp(current + low * days, 0, 1),
        mid: clamp(current + rate * days, 0, 1),
        high: clamp(current + high * days, 0, 1),
      },
    };
  }

  return result;
}

/**
 * docs/14 Case 2 — a corpus fed by contributions and returns grows on a convex
 * curve. Projecting it linearly under-predicts, potentially by years, while
 * looking entirely reasonable.
 *
 *   FV = P(1+r)^n + C·[((1+r)^n − 1) / r]
 *
 * The return rate is an assumption, so the fan is drawn from several rather
 * than one confident curve.
 */
function compounding(
  options: ProjectOptions & {
    model: Extract<ProjectionModel, { kind: 'compounding' }>;
    current: number;
    from: number;
  },
): Projection {
  const { model, now, targetDate, from } = options;
  const scenarios = (model.scenarios ?? [
    model.annualRate * 0.8,
    model.annualRate,
    model.annualRate * 1.2,
  ])
    .slice()
    .sort((a, b) => a - b);

  const [lowRate, midRate, highRate] = [
    scenarios[0] ?? model.annualRate,
    scenarios[Math.floor(scenarios.length / 2)] ?? model.annualRate,
    scenarios[scenarios.length - 1] ?? model.annualRate,
  ];

  const futureValue = (annualRate: number, months: number): number => {
    const r = annualRate / 12;
    const P = model.current;
    const C = model.contribution.amount;
    if (r === 0) return P + C * months;
    const growth = Math.pow(1 + r, months);
    return P * growth + C * ((growth - 1) / r);
  };

  const asProgress = (value: number): number =>
    model.target === 0 ? 0 : clamp(value / model.target, 0, 1);

  const horizon = targetDate ?? now + 5 * 365 * DAY_MS;
  const totalMonths = Math.max(1, (horizon - from) / (30 * DAY_MS));

  const band: ProjectionPoint[] = [];
  for (let i = 0; i <= BAND_STEPS; i++) {
    const months = (totalMonths * i) / BAND_STEPS;
    band.push({
      date: from + months * 30 * DAY_MS,
      low: asProgress(futureValue(lowRate, months)),
      mid: asProgress(futureValue(midRate, months)),
      high: asProgress(futureValue(highRate, months)),
    });
  }

  // Month at which each scenario first reaches the target.
  const monthsToTarget = (annualRate: number): number | null => {
    for (let m = 1; m <= 1200; m++) {
      if (futureValue(annualRate, m) >= model.target) return m;
    }
    return null;
  };

  const midMonths = monthsToTarget(midRate);
  const fastMonths = monthsToTarget(highRate);
  const slowMonths = monthsToTarget(lowRate);

  const result: Projection = {
    available: true,
    kind: 'compounding',
    band,
    assumption: { annualRate: model.annualRate, scenarios },
    completionDate:
      midMonths === null
        ? null
        : {
            low: from + (fastMonths ?? midMonths) * 30 * DAY_MS,
            mid: from + midMonths * 30 * DAY_MS,
            high:
              slowMonths === null
                ? Number.POSITIVE_INFINITY
                : from + slowMonths * 30 * DAY_MS,
          },
  };

  if (targetDate !== undefined) {
    const months = (targetDate - from) / (30 * DAY_MS);
    return {
      ...result,
      atTarget: {
        low: asProgress(futureValue(lowRate, months)),
        mid: asProgress(futureValue(midRate, months)),
        high: asProgress(futureValue(highRate, months)),
      },
    };
  }

  return result;
}
