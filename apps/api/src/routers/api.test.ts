import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../testing.js';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

let api: TestApi;
beforeEach(async () => {
  api = await createTestApi(T0);
});
afterEach(() => api.close());

const full = () => api.as('full');

describe('the auth boundary', () => {
  it('refuses an anonymous read', async () => {
    await expect(api.anonymous.areas.list({})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('leaves genuinely public procedures open', async () => {
    await expect(api.anonymous.health.ping()).resolves.toMatchObject({ ok: true });
    await expect(api.anonymous.auth.status()).resolves.toMatchObject({
      initialised: false,
    });
  });

  /**
   * A phone should be able to record a reading without also being able to
   * restructure the goal tree.
   */
  it('lets capture scope write observations but not delete', async () => {
    const area = await full().areas.create({ name: 'Business', color: '#38bdf8' });

    await expect(
      api.as('capture').tasks.create({ title: 'Ship billing' }),
    ).resolves.toBeDefined();

    await expect(api.as('capture').areas.remove({ id: area.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('lets read scope read but not write', async () => {
    await expect(api.as('read').areas.list({})).resolves.toBeDefined();
    await expect(
      api.as('read').tasks.create({ title: 'Nope' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('names the scope it needed, rather than a bare refusal', async () => {
    await expect(api.as('read').tasks.create({ title: 'Nope' })).rejects.toThrow(
      /needs 'capture' access; this credential has 'read'/,
    );
  });
});

describe('CRUD and pagination', () => {
  it('round-trips an object through the API', async () => {
    const caller = full();
    const area = await caller.areas.create({ name: 'Business', color: '#38bdf8' });

    expect(await caller.areas.byId({ id: area.id })).toMatchObject({
      name: 'Business',
    });

    await caller.areas.update({ id: area.id, patch: { name: 'Samarth' } });
    expect(await caller.areas.byId({ id: area.id })).toMatchObject({ name: 'Samarth' });

    await caller.areas.remove({ id: area.id });
    await expect(caller.areas.byId({ id: area.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await caller.areas.restore({ id: area.id });
    expect(await caller.areas.byId({ id: area.id })).toBeDefined();
  });

  it('pages with a keyset cursor and stops cleanly', async () => {
    const caller = full();
    for (let i = 0; i < 5; i++) {
      api.core.setNow(T0 + i * 1000);
      await caller.areas.create({ name: `Area ${i}`, color: '#fff', sortOrder: i });
    }

    const first = await caller.areas.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await caller.areas.list({ limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(2);

    const third = await caller.areas.list({ limit: 2, cursor: second.nextCursor! });
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();

    const seen = [...first.items, ...second.items, ...third.items];
    expect(new Set(seen.map((a) => a.id)).size).toBe(5);
  });

  it('surfaces a version conflict as CONFLICT', async () => {
    const caller = full();
    const area = await caller.areas.create({ name: 'Business', color: '#38bdf8' });
    await caller.areas.update({ id: area.id, patch: { name: 'One' } });

    await expect(
      caller.areas.update({ id: area.id, patch: { name: 'Two' }, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects invalid input as BAD_REQUEST before touching the database', async () => {
    await expect(full().areas.create({ name: '', color: '#fff' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('relations through the API', () => {
  it('refuses task → goal with the reason intact', async () => {
    const caller = full();
    const area = await caller.areas.create({ name: 'Business', color: '#38bdf8' });
    const goal = await caller.goals.create({ areaId: area.id, name: '₹5L MRR' });
    const task = await caller.tasks.create({ title: 'Ship billing' });

    const attempt = caller.relations.create({
      kind: 'contributes_to',
      fromType: 'task',
      fromId: task.id,
      toType: 'goal',
      toId: goal.id,
    });

    await expect(attempt).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(attempt).rejects.toThrow(/activity, not advancement/);
  });

  it('reports a cycle as BAD_REQUEST with the path', async () => {
    const caller = full();
    const area = await caller.areas.create({ name: 'Business', color: '#38bdf8' });
    const a = await caller.goals.create({ areaId: area.id, name: 'A' });
    const b = await caller.goals.create({ areaId: area.id, name: 'B' });

    const link = (from: string, to: string) =>
      caller.relations.create({
        kind: 'contributes_to',
        fromType: 'goal',
        fromId: from,
        toType: 'goal',
        toId: to,
      });

    await link(a.id, b.id);
    await expect(link(b.id, a.id)).rejects.toThrow(/would create a cycle/);
  });
});

describe('the measurement loop, end to end', () => {
  it('records a reading and moves the goal above it', async () => {
    const caller = full();
    const area = await caller.areas.create({ name: 'Business', color: '#38bdf8' });
    const metric = await caller.metrics.create({
      key: 'monthly_revenue',
      name: 'Monthly revenue',
      unit: 'currency',
      direction: 'increase',
      cadence: 'monthly',
      source: 'manual',
      baseline: 0,
      target: 500_000,
    });
    const goal = await caller.goals.create({
      areaId: area.id,
      name: '₹5L MRR by March 2027',
      progressModel: { mode: 'metric', metricId: metric.id },
    });

    await caller.readings.record({ metricId: metric.id, at: T0, value: 140_000 });

    const explained = await caller.goals.explain({ id: goal.id });
    expect(explained.measurable).toBe(true);
    if (!explained.measurable || explained.mode !== 'completion') throw new Error('mode');
    expect(explained.progress.value).toBeCloseTo(0.28, 5);
    expect(explained.progress.inputs[0]?.detail).toBe('140000 of 500000, baseline 0');

    // The reading event recomputed and cached it without a second call.
    const cached = await caller.goals.byId({ id: goal.id });
    expect(cached.progress).toBeCloseTo(0.28, 5);
  });

  it('reports an unmeasurable goal as 422, not 500', async () => {
    const caller = full();
    const area = await caller.areas.create({ name: 'Career', color: '#34d399' });
    const goal = await caller.goals.create({ areaId: area.id, name: 'No contributors' });

    const explained = await caller.goals.explain({ id: goal.id });
    expect(explained.measurable).toBe(false);

    await expect(
      caller.metrics.preview({ direction: 'increase', current: 12 }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_CONTENT' });
  });

  it('lists metrics that have stopped being fed', async () => {
    const caller = full();
    const metric = await caller.metrics.create({
      key: 'weight',
      name: 'Weight',
      unit: 'weight',
      direction: 'decrease',
      cadence: 'weekly',
      source: 'manual',
      baseline: 80,
      target: 72,
    });
    await caller.readings.record({ metricId: metric.id, at: T0, value: 78 });

    expect(await caller.readings.needingData({})).toHaveLength(0);

    api.core.setNow(T0 + 30 * DAY);
    const stale = await caller.readings.needingData({});
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ key: 'weight', daysSince: 30 });
  });

  it('validates a derived-metric expression and catches a cycle', async () => {
    const caller = full();
    expect(
      await caller.metrics.validateExpression({
        expression: '({income} - {expenses}) / {income}',
      }),
    ).toMatchObject({ valid: true, dependsOn: expect.arrayContaining(['income']) });

    expect(
      await caller.metrics.validateExpression({ expression: '{revenue +' }),
    ).toMatchObject({ valid: false });

    await caller.metrics.create({
      key: 'savings_rate',
      name: 'Savings rate',
      unit: 'percent',
      direction: 'increase',
      cadence: 'monthly',
      source: 'derived',
      expression: '{savings_rate} + 1',
    });

    expect(
      await caller.metrics.validateExpression({
        key: 'savings_rate',
        expression: '{savings_rate} + 1',
      }),
    ).toMatchObject({ valid: false, error: expect.stringContaining('depend on itself') });
  });
});

describe('search', () => {
  it('finds objects by prefix and respects soft delete', async () => {
    const caller = full();
    const area = await caller.areas.create({ name: 'Business', color: '#38bdf8' });
    const goal = await caller.goals.create({
      areaId: area.id,
      name: '₹5L MRR by March 2027',
      description: 'Recurring revenue for Samarth',
    });

    const hits = await caller.search.query({ q: 'recur' });
    expect(hits.map((h) => h.id)).toContain(goal.id);

    await caller.goals.remove({ id: goal.id });
    expect(await caller.search.query({ q: 'recur' })).toHaveLength(0);
  });

  it('does not choke on query syntax characters', async () => {
    await expect(full().search.query({ q: 'budget: "2026" *' })).resolves.toEqual([]);
  });
});
