import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '@aryesh/db';
import { schema } from '@aryesh/db';
import type { Collector } from './registry.js';

const { accounts, transactions, tasks, projects, habits, habitEntries } = schema;

/**
 * docs/03 §2 — the v1 collectors.
 *
 * All money is integer minor units. A collector returns `null` for "no data in
 * this period", which is deliberately different from `0`: a month with no
 * transactions recorded is not a month with zero revenue, and conflating them
 * would put a fabricated zero into the trajectory.
 */

const sumTransactions = async (
  db: Db,
  direction: 'in' | 'out',
  start: number,
  end: number,
): Promise<{ total: number; count: number }> => {
  const row = (
    await db
      .select({
        total: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.direction, direction),
          gte(transactions.occurredAt, start),
          lt(transactions.occurredAt, end),
          isNull(transactions.deletedAt),
        ),
      )
  )[0];
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
};

export const financeRevenue: Collector = {
  key: 'finance.revenue',
  name: 'Revenue',
  unit: 'currency',
  cadence: 'monthly',
  async compute(period, db) {
    const { total, count } = await sumTransactions(db, 'in', period.start, period.end);
    return count === 0 ? null : total;
  },
};

export const financeExpenses: Collector = {
  key: 'finance.expenses',
  name: 'Expenses',
  unit: 'currency',
  cadence: 'monthly',
  async compute(period, db) {
    const { total, count } = await sumTransactions(db, 'out', period.start, period.end);
    return count === 0 ? null : total;
  },
};

export const financeNet: Collector = {
  key: 'finance.net',
  name: 'Net',
  unit: 'currency',
  cadence: 'monthly',
  async compute(period, db) {
    const income = await sumTransactions(db, 'in', period.start, period.end);
    const spend = await sumTransactions(db, 'out', period.start, period.end);
    if (income.count === 0 && spend.count === 0) return null;
    return income.total - spend.total;
  },
};

export const financeSavingsRate: Collector = {
  key: 'finance.savings_rate',
  name: 'Savings rate',
  unit: 'percent',
  cadence: 'monthly',
  async compute(period, db) {
    const income = await sumTransactions(db, 'in', period.start, period.end);
    if (income.total <= 0) return null;
    const spend = await sumTransactions(db, 'out', period.start, period.end);
    return ((income.total - spend.total) / income.total) * 100;
  },
};

/**
 * Net worth is a *balance*, not a flow: it is whatever the accounts say now, so
 * backfilling it would stamp today's balance onto every past period. It only
 * ever writes the current period.
 */
export const financeNetWorth: Collector = {
  key: 'finance.net_worth',
  name: 'Net worth',
  unit: 'currency',
  cadence: 'monthly',
  async compute(period, db) {
    const rows = await db
      .select({ balance: accounts.balanceMinor, isLiability: accounts.isLiability })
      .from(accounts)
      .where(isNull(accounts.deletedAt));
    if (rows.length === 0) return null;
    void period;
    return rows.reduce((sum, a) => sum + (a.isLiability ? -a.balance : a.balance), 0);
  },
};

export const workTasksCompleted: Collector = {
  key: 'work.tasks_completed',
  name: 'Tasks completed',
  unit: 'count',
  cadence: 'weekly',
  async compute(period, db) {
    const row = (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(tasks)
        .where(
          and(
            eq(tasks.status, 'done'),
            gte(tasks.completedAt, period.start),
            lt(tasks.completedAt, period.end),
            isNull(tasks.deletedAt),
          ),
        )
    )[0];
    return row?.n ?? 0;
  },
};

export const workProjectsShipped: Collector = {
  key: 'work.projects_shipped',
  name: 'Projects shipped',
  unit: 'count',
  cadence: 'monthly',
  async compute(period, db) {
    const row = (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(projects)
        .where(
          and(
            gte(projects.completedAt, period.start),
            lt(projects.completedAt, period.end),
            isNull(projects.deletedAt),
          ),
        )
    )[0];
    return row?.n ?? 0;
  },
};

export const workCycleTime: Collector = {
  key: 'work.cycle_time',
  name: 'Task cycle time',
  unit: 'duration',
  cadence: 'monthly',
  async compute(period, db) {
    const rows = await db
      .select({ started: tasks.startedAt, completed: tasks.completedAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'done'),
          gte(tasks.completedAt, period.start),
          lt(tasks.completedAt, period.end),
          isNull(tasks.deletedAt),
        ),
      );

    const durations = rows
      .filter((r): r is { started: number; completed: number } =>
        r.started !== null && r.completed !== null,
      )
      .map((r) => r.completed - r.started);

    if (durations.length === 0) return null;
    return durations.reduce((a, b) => a + b, 0) / durations.length / 86_400_000;
  },
};

export const habitConsistency: Collector = {
  key: 'habit.consistency',
  name: 'Habit consistency',
  unit: 'percent',
  cadence: 'weekly',
  async compute(period, db) {
    const active = await db
      .select({ id: habits.id, targetPerPeriod: habits.targetPerPeriod })
      .from(habits)
      .where(isNull(habits.deletedAt));
    if (active.length === 0) return null;

    const done = (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(habitEntries)
        .where(
          and(
            eq(habitEntries.completed, true),
            gte(habitEntries.date, period.start),
            lt(habitEntries.date, period.end),
          ),
        )
    )[0]?.n ?? 0;

    const expected = active.reduce((s, h) => s + h.targetPerPeriod, 0);
    return expected === 0 ? null : (done / expected) * 100;
  },
};

export const BUILTIN_COLLECTORS: Collector[] = [
  financeRevenue,
  financeExpenses,
  financeNet,
  financeSavingsRate,
  financeNetWorth,
  workTasksCompleted,
  workProjectsShipped,
  workCycleTime,
  habitConsistency,
];
