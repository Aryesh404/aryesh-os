import { and, eq, like, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@aryesh/db';
import { AppError, dayStamp, isCalendarDate, planningDate, shiftDate } from '@aryesh/domain';
import { actorOf, captureProcedure, protectedProcedure, router } from '../trpc.js';
import { listInput } from './crud.js';

const date = z.string().refine(isCalendarDate, 'Choose a valid calendar date.');

export const todayRouter = router({
  summary: protectedProcedure.query(({ ctx }) => ctx.core.planning.today(planningDate(ctx.now()))),
  focus: protectedProcedure.input(z.object({ date })).query(({ ctx, input }) => ctx.core.repos.planning.getFocus(input.date)),
  saveFocus: captureProcedure.input(z.object({
    date, taskIds: z.array(z.string()).max(3).refine((ids) => new Set(ids).size === ids.length),
    revision: z.number().int().nonnegative(),
  })).mutation(({ ctx, input }) => {
    if (input.date !== planningDate(ctx.now())) {
      throw new AppError('CONFLICT', 'A new day has started. Refresh Today before choosing priorities.');
    }
    return ctx.core.repos.planning.saveFocus(input, actorOf(ctx));
  }),
});

export const habitCheckIns = router({
  entries: protectedProcedure.input(z.object({ habitId: z.string(), from: date, to: date }))
    .query(async ({ ctx, input }) => {
      if (dayStamp(input.to) <= dayStamp(input.from) || dayStamp(input.to) - dayStamp(input.from) > 366 * 86_400_000) {
        throw new AppError('INVALID_INPUT', 'Choose a date range of up to one year.');
      }
      await ctx.core.repos.habits.getById(input.habitId);
      return ctx.core.repos.planning.entries(input.habitId, input.from, input.to);
    }),
  checkIn: captureProcedure.input(z.object({ habitId: z.string(), date, completed: z.boolean(), requireToday: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      if (input.requireToday && input.date !== planningDate(ctx.now())) {
        throw new AppError('CONFLICT', 'A new day has started. Refresh Today before checking in.');
      }
      if (input.date > planningDate(ctx.now())) throw new AppError('INVALID_INPUT', 'A future day cannot be checked in yet.');
      const result = await ctx.core.repos.planning.setEntry(input, actorOf(ctx));
      await ctx.core.events.emit('habit.checked', { habitId: input.habitId, date: input.date });
      return result.entry;
    }),
  browse: protectedProcedure.input(listInput.extend({ q: z.string().max(200).optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.core.repos.habits.list({
        limit: input.limit + 1,
        ...(input.cursor ? { after: input.cursor } : {}),
        ...(input.q ? { where: like(schema.habits.name, `%${input.q}%`) } : {}),
      });
      const items = rows.slice(0, input.limit);
      const last = items.at(-1);
      const currentDate = planningDate(ctx.now());
      return {
        date: currentDate,
        items: await Promise.all(items.map((habit) => ctx.core.planning.habitState(habit, currentDate))),
        nextCursor: rows.length > input.limit && last ? { id: last.id, updatedAt: last.updatedAt } : null,
      };
    }),
});

export const taskBrowse = router({
  browse: protectedProcedure.input(listInput.extend({
    q: z.string().max(200).optional(), projectId: z.string().optional(), openOnly: z.boolean().default(true), due: z.boolean().default(false),
  })).query(async ({ ctx, input }) => {
    const { tasks } = schema;
    const rows = await ctx.core.repos.tasks.list({
      limit: input.limit + 1,
      ...(input.cursor ? { after: input.cursor } : {}),
      where: and(
        input.openOnly ? and(ne(tasks.status, 'done'), ne(tasks.status, 'cancelled')) : undefined,
        input.projectId ? eq(tasks.projectId, input.projectId) : undefined,
        input.due ? lt(tasks.dueDate, dayStamp(shiftDate(planningDate(ctx.now()), 1))) : undefined,
        input.q ? like(tasks.title, `%${input.q}%`) : undefined,
      ),
    });
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > input.limit && last ? { id: last.id, updatedAt: last.updatedAt } : null };
  }),
});

export const goalWorkspace = router({
  workspace: protectedProcedure.input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => ctx.core.planning.goalWorkspace(input.id)),
});

const catalogInput = listInput.extend({ q: z.string().max(200).default('') });
export const captureCatalog = router({
  metrics: protectedProcedure.input(catalogInput).query(async ({ ctx, input }) => {
    const rows = await ctx.core.repos.metrics.list({ limit: input.limit + 1,
      ...(input.cursor ? { after: input.cursor } : {}),
      where: or(like(schema.metrics.name, `%${input.q}%`), like(schema.metrics.key, `%${input.q}%`)),
    });
    const items = rows.slice(0, input.limit); const last = items.at(-1);
    return { items, nextCursor: rows.length > input.limit && last ? { id: last.id, updatedAt: last.updatedAt } : null };
  }),
  accounts: protectedProcedure.input(catalogInput).query(async ({ ctx, input }) => {
    const rows = await ctx.core.repos.accounts.list({ limit: input.limit + 1,
      ...(input.cursor ? { after: input.cursor } : {}), where: like(schema.accounts.name, `%${input.q}%`),
    });
    const items = rows.slice(0, input.limit); const last = items.at(-1);
    return { items, nextCursor: rows.length > input.limit && last ? { id: last.id, updatedAt: last.updatedAt } : null };
  }),
});
