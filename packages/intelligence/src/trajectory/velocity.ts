import { DAY_MS } from '../time.js';
import type { SnapshotPoint, VelocityWindows } from './types.js';

/**
 * docs/04 §1 — velocity from the snapshot series.
 *
 * The 7-day figure is reactive and noisy; the 30-day is what is shown by
 * default. Both are kept, because a goal where 7d greatly exceeds 30d is
 * accelerating and that is worth seeing.
 */

/** The value a snapshot carries, whichever mode it was recorded in. */
export const valueOf = (point: SnapshotPoint): number | null =>
  point.progress ?? point.momentum;

/** The last snapshot that carries a usable value. */
export function latest(snapshots: readonly SnapshotPoint[]): SnapshotPoint | undefined {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const point = snapshots[i];
    if (point && valueOf(point) !== null) return point;
  }
  return undefined;
}

/** The earliest snapshot carrying a usable value. */
function firstUsable(snapshots: readonly SnapshotPoint[]): SnapshotPoint | undefined {
  for (const point of snapshots) {
    if (valueOf(point) !== null) return point;
  }
  return undefined;
}

/** The snapshot at or immediately before `at`. */
function pointAt(
  snapshots: readonly SnapshotPoint[],
  at: number,
): SnapshotPoint | undefined {
  let found: SnapshotPoint | undefined;
  for (const point of snapshots) {
    if (point.date > at) break;
    if (valueOf(point) !== null) found = point;
  }
  return found;
}

/** A span shorter than this cannot express a meaningful per-day rate. */
const MIN_SPAN_DAYS = 2;

/**
 * Change per day over a trailing window.
 *
 * When the series is shorter than the window, the earliest point is used and
 * the rate covers whatever history exists. Requiring full coverage instead
 * would mean a young goal has no velocity at any window — and, worse, that a
 * decelerating 90-day goal with no 90-day baseline reads as "advancing"
 * because there is nothing to compare against.
 *
 * The `MIN_SNAPSHOTS` gate in `project.ts` is what guards against acting on too
 * little data; this function's job is to report the rate that exists.
 */
export function velocityOver(
  snapshots: readonly SnapshotPoint[],
  windowDays: number,
  now: number,
): number | null {
  const end = latest(snapshots);
  if (!end) return null;

  const from = now - windowDays * DAY_MS;
  const start = pointAt(snapshots, from) ?? firstUsable(snapshots);
  if (!start) return null;

  const elapsedDays = (end.date - start.date) / DAY_MS;
  if (elapsedDays < MIN_SPAN_DAYS) return null;

  const endValue = valueOf(end);
  const startValue = valueOf(start);
  if (endValue === null || startValue === null) return null;

  return (endValue - startValue) / elapsedDays;
}

export function velocityWindows(
  snapshots: readonly SnapshotPoint[],
  now: number,
): VelocityWindows {
  return {
    d7: velocityOver(snapshots, 7, now),
    d30: velocityOver(snapshots, 30, now),
    d90: velocityOver(snapshots, 90, now),
  };
}

/** Spread across the windows, used to widen the projection band. */
export function velocityDispersion(windows: VelocityWindows): number {
  const values = [windows.d7, windows.d30, windows.d90].filter(
    (v): v is number => v !== null,
  );
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * docs/04 §3 — nothing has happened for three weeks. Shared by both
 * vocabularies, because it is one of the two states the user most needs to see.
 */
export function isStalled(
  snapshots: readonly SnapshotPoint[],
  now: number,
  days = 21,
): boolean {
  const end = latest(snapshots);
  if (!end) return false;

  const start = pointAt(snapshots, now - days * DAY_MS);
  if (!start) return false;
  if ((end.date - start.date) / DAY_MS < days * 0.8) return false;

  const endValue = valueOf(end);
  const startValue = valueOf(start);
  if (endValue === null || startValue === null) return false;

  return Math.abs(endValue - startValue) < 1e-6;
}
