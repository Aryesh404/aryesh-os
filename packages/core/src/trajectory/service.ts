import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import type { Db } from '@aryesh/db';
import { schema } from '@aryesh/db';
import {
  computeTrajectory,
  DAY_MS,
  type ComponentVelocity,
  type SnapshotPoint,
  type Trajectory,
} from '@aryesh/intelligence';
import { NotFoundError } from '@aryesh/domain';

const { goals, goalSnapshots, metrics, readings } = schema;

/**
 * Reads the snapshot series and hands it to the pure engine.
 *
 * The series is the only input trajectory has, and it cannot be reconstructed
 * (docs/03 §7) — which is why M4 started writing it before anything displayed
 * it.
 */
export interface TrajectoryServiceDeps {
  db: Db;
  clock: () => number;
}

export function createTrajectoryService({ db, clock }: TrajectoryServiceDeps) {
  return {
    async forGoal(
      goalId: string,
      options: { now?: number; windowDays?: number } = {},
    ): Promise<Trajectory> {
      const now = options.now ?? clock();
      const windowDays = options.windowDays ?? 400;

      const goal = (
        await db
          .select()
          .from(goals)
          .where(and(eq(goals.id, goalId), isNull(goals.deletedAt)))
          .limit(1)
      )[0];
      if (!goal) throw new NotFoundError('goal', goalId);

      const rows = await db
        .select({
          date: goalSnapshots.date,
          progress: goalSnapshots.progress,
          momentum: goalSnapshots.momentum,
          confidence: goalSnapshots.confidence,
        })
        .from(goalSnapshots)
        .where(
          and(
            eq(goalSnapshots.goalId, goalId),
            gte(goalSnapshots.date, now - windowDays * DAY_MS),
          ),
        )
        .orderBy(asc(goalSnapshots.date));

      const snapshots: SnapshotPoint[] = rows.map((r) => ({
        date: r.date,
        progress: r.progress,
        momentum: r.momentum,
        confidence: r.confidence,
      }));

      const attribution = await componentAttribution(db, goal.progressModel, now);

      return computeTrajectory({
        measurementMode: goal.measurementMode,
        snapshots,
        now,
        ...(goal.targetDate === null ? {} : { targetDate: goal.targetDate }),
        ...(goal.startDate === null ? {} : { startDate: goal.startDate }),
        ...(goal.projectionModel === null
          ? {}
          : { projection: goal.projectionModel as never }),
        ...(attribution.length === 0 ? {} : { components: attribution }),
      });
    },
  };
}

export type TrajectoryService = ReturnType<typeof createTrajectoryService>;

/**
 * docs/03 §11 — where the growth actually came from. Progress driven by
 * contributions is durable and repeatable; progress driven by returns is
 * borrowed and reversible, and a system that cannot tell them apart reports a
 * great trajectory in a rising market.
 */
async function componentAttribution(
  db: Db,
  model: { mode: string; metricId?: string },
  now: number,
): Promise<ComponentVelocity[]> {
  if (model.mode !== 'metric' || model.metricId === undefined) return [];

  const metric = (
    await db.select().from(metrics).where(eq(metrics.id, model.metricId)).limit(1)
  )[0];
  if (!metric?.components || metric.components.length === 0) return [];

  const since = now - 90 * DAY_MS;
  const out: ComponentVelocity[] = [];

  for (const component of metric.components) {
    const series = await db
      .select({ at: readings.at, value: readings.value })
      .from(readings)
      .where(
        and(
          eq(readings.metricId, metric.id),
          eq(readings.component, component.key),
          gte(readings.at, since),
        ),
      )
      .orderBy(asc(readings.at));

    const first = series[0];
    const last = series[series.length - 1];
    if (!first || !last || last.at === first.at) continue;

    out.push({
      key: component.key,
      label: component.label,
      controllable: component.controllable,
      perDay: (last.value - first.value) / ((last.at - first.at) / DAY_MS),
    });
  }

  return out;
}
