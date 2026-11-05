import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { dayStamp, habitPeriod, shiftDate } from '@aryesh/domain';
import { schema, type Db, type Repositories } from '@aryesh/db';
import type { TrajectoryService } from './trajectory/service.js';
import type { ProgressService } from './progress/service.js';

const { tasks, habits, habitEntries, goals, areas, goalSnapshots, metrics, projects, milestones } = schema;

export function createPlanningService({ db, repos, trajectory, progress }: {
  db: Db; repos: Repositories; trajectory: TrajectoryService; progress: ProgressService;
}) {
  async function habitState(habit: typeof habits.$inferSelect, date: string) {
    const period = habitPeriod(date, habit.cadence);
    const entries = await db.select().from(habitEntries).where(and(
      eq(habitEntries.habitId, habit.id), gte(habitEntries.date, period.start),
      lt(habitEntries.date, Math.min(period.end, dayStamp(shiftDate(date, 1)))),
    ));
    return {
      ...habit,
      checkedToday: entries.some((e) => e.date === dayStamp(date) && e.completed),
      completedDays: entries.filter((e) => e.completed).length,
    };
  }

  return {
    habitState,
    async today(date: string) {
      const [focus, yesterday] = await Promise.all([
        repos.planning.getFocus(date), repos.planning.getFocus(shiftDate(date, -1)),
      ]);
      const taskIds = [...new Set([...focus.taskIds, ...yesterday.taskIds])];
      const selected = taskIds.length ? await db.select().from(tasks)
        .where(and(inArray(tasks.id, taskIds), isNull(tasks.deletedAt))) : [];
      const focusTasks = focus.taskIds.flatMap((id) => selected.filter((t) => t.id === id));
      const unfinished = yesterday.taskIds.flatMap((id) => selected.filter((t) =>
        t.id === id && t.status !== 'done' && t.status !== 'cancelled' && !focus.taskIds.includes(id)));
      const dueWhere = and(isNull(tasks.deletedAt), ne(tasks.status, 'done'), ne(tasks.status, 'cancelled'),
        lt(tasks.dueDate, dayStamp(shiftDate(date, 1))));
      const [due, dueCount, habitRows, habitCount, goalRows] = await db.batch([
        db.select().from(tasks).where(dueWhere).orderBy(asc(tasks.dueDate), asc(tasks.id)).limit(6),
        db.select({ count: sql<number>`count(*)` }).from(tasks).where(dueWhere),
        db.select().from(habits).where(isNull(habits.deletedAt)).orderBy(asc(habits.name), asc(habits.id)).limit(6),
        db.select({ count: sql<number>`count(*)` }).from(habits).where(isNull(habits.deletedAt)),
        db.select({ goal: goals, areaName: areas.name, areaColor: areas.color }).from(goals)
          .leftJoin(areas, eq(goals.areaId, areas.id))
          .where(and(isNull(goals.deletedAt), eq(goals.status, 'active')))
          .orderBy(desc(goals.importance), asc(goals.id)).limit(3),
      ]);
      const [updates, habitStates] = await Promise.all([
        Promise.all(goalRows.map(async ({ goal, areaName, areaColor }) => {
        const [history, current, goalTrajectory] = await Promise.all([
          db.select().from(goalSnapshots).where(and(
          eq(goalSnapshots.goalId, goal.id), gte(goalSnapshots.date, dayStamp(shiftDate(date, -7))),
          lt(goalSnapshots.date, dayStamp(shiftDate(date, 1))),
          )).orderBy(asc(goalSnapshots.date)),
          progress.compute(goal.id), trajectory.forGoal(goal.id),
        ]);
        const points = history.flatMap((point) => {
          const value = goal.measurementMode === 'momentum' ? point.momentum : point.progress;
          return value === null ? [] : [{ date: point.date, value }];
        });
        const first = points[0];
        const last = points.at(-1);
        const measured = current.measurable ? (current.mode === 'completion' ? current.progress : current.momentum) : null;
        return {
          ...goal, areaName, areaColor, points,
          currentValue: measured?.value ?? null,
          confidence: measured?.confidence ?? 0,
          degradedReason: current.measurable ? current.degraded?.reason ?? null : current.reason,
          trajectory: goalTrajectory,
          change: first && last && points.length > 1
            ? { value: last.value - first.value, from: first.date, to: last.date } : null,
        };
        })),
        Promise.all(habitRows.map((habit) => habitState(habit, date))),
      ]);
      return {
        date, focus, focusTasks, unfinished, dueTasks: due, dueCount: dueCount[0]?.count ?? 0,
        habits: habitStates,
        habitCount: habitCount[0]?.count ?? 0, goals: updates,
      };
    },

    async goalWorkspace(goalId: string) {
      const goal = await repos.goals.getById(goalId);
      const edges = await repos.relations.contributorsOf(goalId);
      const configured = goal.progressModel.mode === 'weighted' ? goal.progressModel.contributors ?? [] : [];
      const ids = (kind: string) => [...new Set([
        ...edges.filter((edge) => edge.fromType === kind).map((edge) => edge.fromId),
        ...configured.filter((item) => item.kind === kind).map((item) => item.refId),
      ])];
      const metricIds = ids('metric');
      if (goal.progressModel.mode === 'metric') metricIds.push(goal.progressModel.metricId);
      const projectIds = ids('project');
      const habitIds = ids('habit');
      const [linkedMetrics, linkedProjects, linkedHabits, checkpoints] = await Promise.all([
        metricIds.length ? db.select().from(metrics).where(and(inArray(metrics.id, metricIds), isNull(metrics.deletedAt))) : [],
        projectIds.length ? db.select().from(projects).where(and(inArray(projects.id, projectIds), isNull(projects.deletedAt))) : [],
        habitIds.length ? db.select().from(habits).where(and(inArray(habits.id, habitIds), isNull(habits.deletedAt))) : [],
        db.select().from(milestones).where(and(eq(milestones.goalId, goalId), isNull(milestones.deletedAt)))
          .orderBy(asc(milestones.sortOrder), asc(milestones.id)),
      ]);
      return { metrics: linkedMetrics, projects: linkedProjects, habits: linkedHabits, milestones: checkpoints };
    },
  };
}

export type PlanningService = ReturnType<typeof createPlanningService>;
