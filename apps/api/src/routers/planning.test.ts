import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@aryesh/db';
import { dayStamp, planningDate } from '@aryesh/domain';
import { createTestApi, type TestApi } from '../testing.js';

const NOW = Date.parse('2026-11-01T04:00:00Z');
const DATE = '2026-11-01';
let api: TestApi;
beforeEach(async () => { api = await createTestApi(NOW); });
afterEach(() => api.close());
const full = () => api.as('full');

describe('daily priorities', () => {
  it('shares an ordered selection across callers and retries without duplicate audit writes', async () => {
    const a = await full().tasks.create({ title: 'Write proposal' });
    const b = await full().tasks.create({ title: 'Go for a walk' });
    const input = { date: DATE, taskIds: [b.id, a.id], revision: 0 };
    const saved = await full().today.saveFocus(input);
    expect(saved.revision).toBe(1);
    expect(await api.as('capture').today.saveFocus(input)).toEqual(saved);
    expect(await api.as('read').today.focus({ date: DATE })).toEqual(saved);
    const summary = await full().today.summary();
    expect(summary.focusTasks.map((t) => t.id)).toEqual([b.id, a.id]);
    const audits = await api.core.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.subjectType, 'daily_focus'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor).toBe('user');
  });

  it('rejects stale edits without overwriting the other device', async () => {
    const a = await full().tasks.create({ title: 'First' });
    const b = await full().tasks.create({ title: 'Second' });
    await full().today.saveFocus({ date: DATE, taskIds: [a.id], revision: 0 });
    await expect(full().today.saveFocus({ date: DATE, taskIds: [b.id], revision: 0 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await full().today.focus({ date: DATE })).taskIds).toEqual([a.id]);
  });

  it('rejects duplicates, a fourth priority, missing records, and invalid dates', async () => {
    const a = await full().tasks.create({ title: 'Only one' });
    for (const taskIds of [[a.id, a.id], ['1', '2', '3', '4'], ['missing']]) {
      await expect(full().today.saveFocus({ date: DATE, taskIds, revision: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(full().today.focus({ date: '2026-02-30' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await full().today.focus({ date: DATE })).revision).toBe(0);
  });

  it('keeps completed tasks visible and allows removing deleted priorities', async () => {
    const a = await full().tasks.create({ title: 'Finish' });
    const b = await full().tasks.create({ title: 'Remove' });
    await full().today.saveFocus({ date: DATE, taskIds: [a.id, b.id], revision: 0 });
    await full().tasks.update({ id: a.id, patch: { status: 'done', completedAt: NOW } });
    await full().tasks.remove({ id: b.id });
    const summary = await full().today.summary();
    expect(summary.focusTasks.map((t) => t.id)).toEqual([a.id]);
    expect(summary.focusTasks[0]?.status).toBe('done');
    await full().today.saveFocus({ date: DATE, taskIds: [a.id], revision: 1 });
    expect((await full().today.summary()).focus.taskIds).toEqual([a.id]);
  });

  it('rolls over at India midnight, offering yesterday without copying it', async () => {
    api.core.setNow(Date.parse('2026-10-31T18:29:59Z'));
    const a = await full().tasks.create({ title: 'Carry forward by choice' });
    await full().today.saveFocus({ date: '2026-10-31', taskIds: [a.id], revision: 0 });
    api.core.setNow(Date.parse('2026-10-31T18:30:00Z'));
    const summary = await full().today.summary();
    expect(summary.date).toBe(DATE);
    expect(summary.focus.taskIds).toEqual([]);
    expect(summary.unfinished.map((t) => t.id)).toEqual([a.id]);
    await expect(full().today.saveFocus({ date: '2026-10-31', taskIds: [], revision: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('enforces the authentication boundary', async () => {
    await expect(api.anonymous.today.summary()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(api.as('read').today.saveFocus({ date: DATE, taskIds: [], revision: 0 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows only one of two simultaneous conflicting saves', async () => {
    const a = await full().tasks.create({ title: 'First device' });
    const b = await full().tasks.create({ title: 'Second device' });
    const outcomes = await Promise.allSettled([a, b].map((task) =>
      full().today.saveFocus({ date: DATE, taskIds: [task.id], revision: 0 })));
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await full().today.focus({ date: DATE })).revision).toBe(1);
  });

  it('rolls back both daily writes if their audit cannot be saved', async () => {
    const task = await full().tasks.create({ title: 'Atomic save' });
    const habit = await full().habits.create({ name: 'Atomic check-in', cadence: 'daily' });
    await api.core.db.run(sql`CREATE TRIGGER reject_planning_audit BEFORE INSERT ON audit_events
      WHEN NEW.subject_type IN ('daily_focus', 'habit_entry')
      BEGIN SELECT RAISE(ABORT, 'Simulated storage failure'); END`);
    await expect(full().today.saveFocus({ date: DATE, taskIds: [task.id], revision: 0 })).rejects.toThrow();
    await expect(full().habits.checkIn({ habitId: habit.id, date: DATE, completed: true })).rejects.toThrow();
    expect((await full().today.focus({ date: DATE })).revision).toBe(0);
    expect(await full().habits.entries({ habitId: habit.id, from: DATE, to: '2026-11-02' })).toEqual([]);
  });
});

describe('habit check-ins', () => {
  it('checks in once per day, counts the week, and supports undo with an audit trail', async () => {
    const habit = await full().habits.create({ name: 'Read', cadence: 'weekly', targetPerPeriod: 3 });
    const input = { habitId: habit.id, date: DATE, completed: true };
    await api.as('capture').habits.checkIn(input);
    await api.as('capture').habits.checkIn(input);
    expect(await full().habits.entries({ habitId: habit.id, from: DATE, to: '2026-11-02' })).toHaveLength(1);
    expect((await full().today.summary()).habits[0]).toMatchObject({ checkedToday: true, completedDays: 1 });
    await full().habits.checkIn({ ...input, completed: false });
    expect((await full().today.summary()).habits[0]).toMatchObject({ checkedToday: false, completedDays: 0 });
    const audits = await api.core.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.subjectType, 'habit_entry'));
    expect(audits).toHaveLength(2);
  });

  it('preserves calendar-day keys before UTC midnight and resets weekly totals on Monday', async () => {
    const habit = await full().habits.create({ name: 'Walk', cadence: 'weekly', targetPerPeriod: 3 });
    api.core.setNow(Date.parse('2026-11-01T18:30:00Z'));
    const date = planningDate(api.core.clock());
    const entry = await full().habits.checkIn({ habitId: habit.id, date, completed: true });
    expect(date).toBe('2026-11-02');
    expect(entry.date).toBe(dayStamp(date));
    expect((await full().today.summary()).habits[0]?.completedDays).toBe(1);
  });

  it('refuses future entries and writes to a removed habit', async () => {
    const habit = await full().habits.create({ name: 'Walk', cadence: 'daily' });
    await expect(full().habits.checkIn({ habitId: habit.id, date: '2026-11-02', completed: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await full().habits.remove({ id: habit.id });
    await expect(full().habits.checkIn({ habitId: habit.id, date: DATE, completed: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a stale Today check-in across India midnight', async () => {
    const habit = await full().habits.create({ name: 'Read', cadence: 'daily' });
    api.core.setNow(Date.parse('2026-11-01T18:30:00Z'));
    await expect(full().habits.checkIn({ habitId: habit.id, date: DATE, completed: true, requireToday: true })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await full().habits.entries({ habitId: habit.id, from: DATE, to: '2026-11-03' })).toEqual([]);
  });

  it('reflects a habit check-in in Today momentum without waiting for a snapshot', async () => {
    const area = await full().areas.create({ name: 'Health', color: '#9dbaaa' });
    const goal = await full().goals.create({ areaId: area.id, name: 'Keep moving', measurementMode: 'momentum' });
    const habit = await full().habits.create({ name: 'Walk', cadence: 'weekly', targetPerPeriod: 3 });
    await full().relations.create({ kind: 'contributes_to', fromType: 'habit', fromId: habit.id, toType: 'goal', toId: goal.id, weight: 1, evaluation: 'rate', expectedRate: { value: 3, per: 'week' } });
    const before = (await full().today.summary()).goals[0]!.currentValue;
    await full().habits.checkIn({ habitId: habit.id, date: DATE, completed: true });
    const after = (await full().today.summary()).goals[0]!;
    expect(after.currentValue).toBeGreaterThan(before ?? 0);
    expect(after.points).toEqual([]);
    expect(after.change).toBeNull();
  });

  it('recomputes a goal linked to the habit', async () => {
    const area = await full().areas.create({ name: 'Health', color: '#9dbaaa' });
    const goal = await full().goals.create({ areaId: area.id, name: 'Keep moving' });
    const habit = await full().habits.create({ name: 'Walk', cadence: 'daily' });
    await full().relations.create({ kind: 'contributes_to', fromType: 'habit', fromId: habit.id, toType: 'goal', toId: goal.id, weight: 1 });
    api.core.setNow(NOW + 1000);
    await full().habits.checkIn({ habitId: habit.id, date: DATE, completed: true });
    expect((await full().goals.byId({ id: goal.id })).progressComputedAt).toBe(NOW + 1000);
  });
});

describe('complete lists and truthful goal summaries', () => {
  it('finds old due tasks beyond the first 200 records and paginates filtered tasks', async () => {
    const old = await full().tasks.create({ title: 'An old deadline', dueDate: dayStamp('2026-10-28') });
    for (let i = 0; i < 205; i++) {
      api.core.setNow(NOW + i + 1);
      await full().tasks.create({ title: `Later task ${i}` });
    }
    const summary = await full().today.summary();
    expect(summary.dueTasks.map((t) => t.id)).toEqual([old.id]);
    const first = await full().tasks.browse({ q: 'Later task', limit: 3 });
    const second = await full().tasks.browse({ q: 'Later task', limit: 3, cursor: first.nextCursor! });
    expect(new Set([...first.items, ...second.items].map((t) => t.id)).size).toBe(6);
    expect((await full().tasks.browse({ due: true })).items.map((t) => t.id)).toEqual([old.id]);
  });

  it('limits goal summaries and derives change only from matching historical values', async () => {
    const area = await full().areas.create({ name: 'Personal', color: '#b1a1ff' });
    const goal = await full().goals.create({ areaId: area.id, name: 'Practice', measurementMode: 'momentum', importance: 5 });
    for (let i = 0; i < 4; i++) await full().goals.create({ areaId: area.id, name: `Other ${i}`, importance: 1 });
    await api.core.db.insert(schema.goalSnapshots).values([
      { id: 'snapshot-a', goalId: goal.id, date: dayStamp('2026-10-29'), mode: 'completion', progress: .4, momentum: null, confidence: 1, breakdown: [], createdAt: NOW },
      { id: 'snapshot-b', goalId: goal.id, date: dayStamp('2026-10-30'), mode: 'momentum', progress: null, momentum: .8, confidence: 1, breakdown: [], createdAt: NOW },
      { id: 'snapshot-c', goalId: goal.id, date: dayStamp('2026-10-31'), mode: 'momentum', progress: null, momentum: 1.1, confidence: 1, breakdown: [], createdAt: NOW },
    ]);
    const summary = await full().today.summary();
    expect(summary.goals).toHaveLength(3);
    expect(summary.goals[0]?.id).toBe(goal.id);
    expect(summary.goals[0]?.points).toHaveLength(2);
    expect(summary.goals[0]?.change?.value).toBeCloseTo(.3);
    expect(summary.goals[1]?.change).toBeNull();
  });
});
