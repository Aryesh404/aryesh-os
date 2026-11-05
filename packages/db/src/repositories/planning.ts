import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { AppError, dayStamp, isCalendarDate, NotFoundError, type DailyFocus } from '@aryesh/domain';
import { habitEntries, habits, settings } from '../schema/index.js';
import { newId } from '../ids.js';
import type { Ctx, RepoDeps } from './base.js';

const focusKey = (date: string) => `daily-focus:${date}`;
const conflict = () => new AppError('CONFLICT', 'This changed on another device. Refresh and try again.');

function decodeFocus(date: string, value?: unknown): DailyFocus {
  if (value === undefined) return { date, taskIds: [], revision: 0 };
  if (value && typeof value === 'object' && 'taskIds' in value && 'revision' in value &&
      Array.isArray(value.taskIds) && value.taskIds.length <= 3 && new Set(value.taskIds).size === value.taskIds.length &&
      value.taskIds.every((id: unknown) => typeof id === 'string') &&
      typeof value.revision === 'number' && Number.isInteger(value.revision) && value.revision >= 0) {
    return { date, taskIds: value.taskIds as string[], revision: value.revision };
  }
  throw new AppError('INVALID_INPUT', 'This daily plan could not be read. Restore it from a backup.');
}

export function createPlanningRepository({ db, clock }: RepoDeps) {
  // Both statements run in one atomic libSQL batch. The guarded write is a
  // compare-and-swap; changes() ties its audit event to that exact write.
  // Avoid interactive transactions: the local driver detaches their connection.
  const audit = (type: string, id: string, before: unknown, after: unknown, ctx: Ctx) =>
    db.run(sql`INSERT INTO audit_events
      (id, at, actor, action, subject_type, subject_id, before, after, note, execution_id)
      SELECT ${newId()}, ${clock()}, ${ctx.actor}, ${before ? 'update' : 'create'},
        ${type}, ${id}, ${before ? JSON.stringify(before) : null}, ${JSON.stringify(after)},
        ${ctx.note ?? null}, ${ctx.executionId ?? null}
      WHERE changes() = 1`);

  const repo = {
    async getFocus(date: string): Promise<DailyFocus> {
      const [row] = await db.select().from(settings).where(eq(settings.key, focusKey(date)));
      return decodeFocus(date, row?.value);
    },

    async saveFocus(input: DailyFocus, ctx: Ctx): Promise<DailyFocus> {
      if (!isCalendarDate(input.date) || input.taskIds.length > 3 || new Set(input.taskIds).size !== input.taskIds.length) {
        throw new AppError('INVALID_INPUT', 'Choose up to three different tasks for a valid date.');
      }
      const key = focusKey(input.date);
      const [row] = await db.select().from(settings).where(eq(settings.key, key));
      const before = decodeFocus(input.date, row?.value);
      if (JSON.stringify(before.taskIds) === JSON.stringify(input.taskIds)) return before;
      if (input.revision !== before.revision) throw conflict();
      const available = sql`(SELECT count(*) FROM tasks
        WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(${JSON.stringify(input.taskIds)}))) = ${input.taskIds.length}`;
      const unchanged = row
        ? sql`EXISTS (SELECT 1 FROM settings WHERE key = ${key} AND value = ${JSON.stringify(row.value)})`
        : sql`NOT EXISTS (SELECT 1 FROM settings WHERE key = ${key})`;
      const after = { date: input.date, taskIds: input.taskIds, revision: before.revision + 1 };
      const [result] = await db.batch([
        db.run(sql`INSERT INTO settings (key, value, updated_at)
          SELECT ${key}, ${JSON.stringify(after)}, ${new Date(clock()).toISOString()}
          WHERE ${unchanged} AND ${available}
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
        audit('daily_focus', key, before, after, ctx),
      ]);
      if (result.rowsAffected === 1) return after;
      const current = await repo.getFocus(input.date);
      if (JSON.stringify(current.taskIds) === JSON.stringify(input.taskIds)) return current;
      if (current.revision !== before.revision) throw conflict();
      throw new AppError('INVALID_INPUT', 'A selected task is no longer available. Refresh your task list.');
    },

    async entries(habitId: string, from: string, to: string) {
      return db.select().from(habitEntries).where(and(
        eq(habitEntries.habitId, habitId), gte(habitEntries.date, dayStamp(from)),
        lt(habitEntries.date, dayStamp(to)),
      )).orderBy(asc(habitEntries.date));
    },

    async setEntry(input: { habitId: string; date: string; completed: boolean }, ctx: Ctx) {
      const [habit] = await db.select().from(habits)
        .where(and(eq(habits.id, input.habitId), isNull(habits.deletedAt)));
      if (!habit) throw new NotFoundError('habit', input.habitId);
      const date = dayStamp(input.date);
      const condition = and(eq(habitEntries.habitId, input.habitId), eq(habitEntries.date, date));
      const [before] = await db.select().from(habitEntries).where(condition);
      if (before?.completed === input.completed) return { entry: before, changed: false };
      const entry = before ? { ...before, completed: input.completed } : {
        id: newId(), habitId: input.habitId, date, completed: input.completed, note: null, createdAt: clock(),
      };
      const unchanged = before
        ? sql`EXISTS (SELECT 1 FROM habit_entries WHERE id = ${before.id} AND completed = ${Number(before.completed)})`
        : sql`NOT EXISTS (SELECT 1 FROM habit_entries WHERE habit_id = ${input.habitId} AND date = ${date})`;
      const [result] = await db.batch([
        db.run(sql`INSERT INTO habit_entries (id, habit_id, date, completed, created_at)
          SELECT ${entry.id}, ${entry.habitId}, ${date}, ${Number(input.completed)}, ${entry.createdAt}
          WHERE ${unchanged} AND EXISTS (SELECT 1 FROM habits WHERE id = ${input.habitId} AND deleted_at IS NULL)
          ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed`),
        audit('habit_entry', entry.id, before, entry, ctx),
      ]);
      if (result.rowsAffected === 1) return { entry, changed: true };
      const [current] = await db.select().from(habitEntries).where(condition);
      if (current?.completed === input.completed) return { entry: current, changed: false };
      throw conflict();
    },
  };
  return repo;
}
