import type { DatedStatus, MomentumStatus } from '@aryesh/domain';
import { DAY_MS } from '../time.js';
import { LOW_CONFIDENCE, project } from './project.js';
import { isStalled, latest, valueOf, velocityWindows } from './velocity.js';
import type { Trajectory, TrajectoryInput, VelocityWindows } from './types.js';

export * from './types.js';
export { velocityOver, velocityWindows, isStalled, latest, valueOf } from './velocity.js';
export { project, MIN_SNAPSHOTS, LOW_CONFIDENCE } from './project.js';

/**
 * docs/04 §3 — dated things are judged against a deadline; undated things are
 * judged on momentum. Forcing one vocabulary onto both would mean inventing
 * fake deadlines or reporting "on track" for something with no track.
 */
function datedStatus(paceRatio: number | null, stalled: boolean): DatedStatus {
  if (stalled) return 'stalled';
  if (paceRatio === null) return 'unknown';
  if (paceRatio >= 1.15) return 'ahead';
  if (paceRatio >= 0.9) return 'on_track';
  if (paceRatio >= 0.6) return 'at_risk';
  return 'behind';
}

/**
 * The doc's bands overlap slightly (a goal at 1.1× is both "≥ 90-day" and
 * "within ±20%"), so they are read as non-overlapping thirds: clearly
 * accelerating, holding, clearly decelerating.
 */
function momentumStatus(
  velocity: VelocityWindows,
  current: number | null,
): MomentumStatus {
  // For a momentum goal, `stalled` must mean the activity stopped — not that
  // the score is flat. A goal shipping steadily has a *constant* momentum
  // score, and calling that stalled would punish exactly the behaviour the
  // measure exists to reward.
  if (current !== null && current <= 0.05) return 'stalled';

  const recent = velocity.d30;
  if (recent === null) return 'unknown';

  // With no longer baseline there is nothing to call this faster or slower
  // *than*, and calling it "advancing" would flatter a goal we cannot judge.
  const baseline = velocity.d90;
  if (baseline === null || baseline <= 0) return 'unknown';

  const ratio = recent / baseline;
  if (ratio >= 1.2) return 'advancing';
  if (ratio < 0.8) return 'slowing';
  return 'steady';
}

export function computeTrajectory(input: TrajectoryInput): Trajectory {
  const { snapshots, now, targetDate } = input;
  const usable = snapshots.filter((s) => valueOf(s) !== null);

  const velocity = velocityWindows(snapshots, now);
  const stalled = isStalled(snapshots, now);

  const end = latest(snapshots);
  const current = end ? valueOf(end) : null;
  const confidence = end?.confidence ?? 0;

  // docs/04 §2 — required pace exists only when there is a deadline to be
  // behind. A null here is meaningful, not missing.
  const dated = targetDate !== undefined && input.measurementMode === 'completion';
  const daysRemaining = targetDate === undefined ? null : (targetDate - now) / DAY_MS;

  const requiredPace =
    dated && daysRemaining !== null && daysRemaining > 0 && current !== null
      ? (1 - current) / daysRemaining
      : null;

  const paceRatio =
    requiredPace !== null && requiredPace > 0 && velocity.d30 !== null
      ? velocity.d30 / requiredPace
      : null;

  const vocabulary: 'dated' | 'momentum' = dated ? 'dated' : 'momentum';
  const status = dated
    ? datedStatus(paceRatio, stalled)
    : momentumStatus(velocity, current);

  const projection = project({
    snapshots,
    velocity,
    confidence,
    now,
    ...(targetDate === undefined ? {} : { targetDate }),
    ...(input.projection === undefined ? {} : { model: input.projection }),
  });

  const caveats: string[] = [];
  if (usable.length < 5) {
    caveats.push(`only ${usable.length} data point${usable.length === 1 ? '' : 's'} so far`);
  }
  if (confidence < LOW_CONFIDENCE && usable.length > 0) {
    caveats.push('low confidence in the underlying data — the band is widened');
  }
  // The caveat follows the vocabulary: flatness is only news for a completion
  // goal, where it genuinely means nothing advanced.
  if (stalled && dated) caveats.push('no movement in the last 21 days');
  if (!dated && status === 'stalled') caveats.push('the underlying activity has stopped');
  if (!dated && targetDate === undefined) {
    caveats.push('no target date, so there is no pace to be behind on');
  }
  if (projection.available && projection.kind === 'compounding') {
    caveats.push('projection rests on a stated return rate, not on observed growth');
  }

  return {
    vocabulary,
    status,
    velocity,
    requiredPace,
    paceRatio,
    current,
    projection,
    ...(input.components === undefined
      ? {}
      : { attribution: [...input.components] }),
    caveats,
    dataPoints: usable.length,
  };
}
