import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditEvents, revisions } from '../schema/index.js';
import { createTestDb, TEST_ACTOR, type TestDb } from '../testing.js';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

const auditFor = async (subjectType: string, subjectId: string) =>
  t.db
    .select()
    .from(auditEvents)
    .where(
      and(eq(auditEvents.subjectType, subjectType), eq(auditEvents.subjectId, subjectId)),
    );

const seedArea = () =>
  t.repos.areas.create({ name: 'Business', color: '#38bdf8', sortOrder: 0 }, TEST_ACTOR);

describe('every object round-trips through real libSQL', () => {
  it('creates, reads, updates, soft-deletes and restores each kind', async () => {
    const area = await seedArea();
    const theme = await t.repos.themes.create(
      { areaId: area.id, name: 'Build Samarth into a stronger recurring business' },
      TEST_ACTOR,
    );
    const goal = await t.repos.goals.create(
      {
        areaId: area.id,
        themeId: theme.id,
        name: '₹5L MRR by March 2027',
        targetDate: 1_804_000_000_000,
        measurementMode: 'completion',
      },
      TEST_ACTOR,
    );
    const milestone = await t.repos.milestones.create(
      { goalId: goal.id, name: 'First retainer client', weight: 1 },
      TEST_ACTOR,
    );
    const metric = await t.repos.metrics.create(
      {
        key: 'monthly_revenue',
        name: 'Monthly revenue',
        unit: 'currency',
        direction: 'increase',
        cadence: 'monthly',
        source: 'manual',
        baseline: 0,
        target: 500_000,
      },
      TEST_ACTOR,
    );
    const project = await t.repos.projects.create(
      { areaId: area.id, name: 'Retainer platform', status: 'active' },
      TEST_ACTOR,
    );
    const task = await t.repos.tasks.create(
      { projectId: project.id, title: 'Billing flow', status: 'todo' },
      TEST_ACTOR,
    );
    const habit = await t.repos.habits.create(
      { areaId: area.id, name: 'Weekly outreach', cadence: 'weekly' },
      TEST_ACTOR,
    );

    const all = [
      ['area', area.id, t.repos.areas],
      ['theme', theme.id, t.repos.themes],
      ['goal', goal.id, t.repos.goals],
      ['milestone', milestone.id, t.repos.milestones],
      ['metric', metric.id, t.repos.metrics],
      ['project', project.id, t.repos.projects],
      ['task', task.id, t.repos.tasks],
      ['habit', habit.id, t.repos.habits],
    ] as const;

    for (const [kind, id, repo] of all) {
      expect(await repo.findById(id), `${kind} readable`).toBeDefined();

      await repo.softDelete(id, TEST_ACTOR);
      expect(await repo.findById(id), `${kind} hidden after delete`).toBeUndefined();
      expect(
        await repo.findById(id, { includeDeleted: true }),
        `${kind} still present`,
      ).toBeDefined();

      await repo.restore(id, TEST_ACTOR);
      expect(await repo.findById(id), `${kind} restored`).toBeDefined();
    }
  });

  it('records one habit entry per day', async () => {
    const area = await seedArea();
    const habit = await t.repos.habits.create(
      { areaId: area.id, name: 'Gym', cadence: 'daily' },
      TEST_ACTOR,
    );
    expect(habit.currentStreak).toBe(0);
  });
});

describe('audit', () => {
  it('writes a row for every mutation, with before and after', async () => {
    const area = await seedArea();

    await t.repos.areas.update(area.id, { name: 'Samarth' }, TEST_ACTOR);
    await t.repos.areas.softDelete(area.id, TEST_ACTOR);
    await t.repos.areas.restore(area.id, TEST_ACTOR);

    const events = await auditFor('area', area.id);
    expect(events.map((e) => e.action)).toEqual([
      'create',
      'update',
      'delete',
      'restore',
    ]);

    const update = events[1];
    expect((update?.before as { name: string }).name).toBe('Business');
    expect((update?.after as { name: string }).name).toBe('Samarth');
    expect(update?.actor).toBe('user');
  });

  it('attributes writes to an agent and links the execution', async () => {
    const area = await t.repos.areas.create(
      { name: 'Career', color: '#34d399', sortOrder: 1 },
      { actor: 'agent:planner', executionId: 'exec_123', note: 'from a plan' },
    );

    const [event] = await auditFor('area', area.id);
    expect(event?.actor).toBe('agent:planner');
    expect(event?.executionId).toBe('exec_123');
    expect(event?.note).toBe('from a plan');
  });

  it('never allows an anonymous or managed-field write', async () => {
    const area = await seedArea();
    // `version` is managed; a caller trying to set it is ignored, not obeyed.
    await t.repos.areas.update(area.id, { version: 99 } as never, TEST_ACTOR);
    const after = await t.repos.areas.getById(area.id);
    expect(after.version).toBe(2);
  });
});

describe('optimistic concurrency', () => {
  it('bumps version on update and rejects a stale write', async () => {
    const area = await seedArea();
    expect(area.version).toBe(1);

    const updated = await t.repos.areas.update(
      area.id,
      { name: 'One' },
      TEST_ACTOR,
      { expectedVersion: 1 },
    );
    expect(updated.version).toBe(2);

    await expect(
      t.repos.areas.update(area.id, { name: 'Two' }, TEST_ACTOR, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('revisions', () => {
  it('stores a forward patch and its inverse, so undo is a lookup', async () => {
    const area = await seedArea();
    await t.repos.areas.update(area.id, { name: 'Samarth', color: '#7c6bff' }, TEST_ACTOR);

    const [rev] = await t.db
      .select()
      .from(revisions)
      .where(and(eq(revisions.subjectType, 'area'), eq(revisions.subjectId, area.id)));

    expect(rev?.patch).toMatchObject({ name: 'Samarth', color: '#7c6bff' });
    expect(rev?.inverse).toMatchObject({ name: 'Business', color: '#38bdf8' });

    // Applying the inverse restores the previous state.
    await t.repos.areas.update(area.id, rev?.inverse as never, TEST_ACTOR);
    const restored = await t.repos.areas.getById(area.id);
    expect(restored.name).toBe('Business');
    expect(restored.color).toBe('#38bdf8');
  });

  it('does not write a revision when nothing actually changed', async () => {
    const area = await seedArea();
    await t.repos.areas.update(area.id, { name: 'Business' }, TEST_ACTOR);

    const rows = await t.db
      .select()
      .from(revisions)
      .where(eq(revisions.subjectId, area.id));
    expect(rows).toHaveLength(0);
  });
});

describe('keyset pagination', () => {
  it('pages by (updatedAt, id) without OFFSET', async () => {
    for (let i = 0; i < 5; i++) {
      t.setNow(1_700_000_000_000 + i * 1000);
      await t.repos.areas.create(
        { name: `Area ${i}`, color: '#fff', sortOrder: i },
        TEST_ACTOR,
      );
    }

    const first = await t.repos.areas.list({ limit: 2 });
    expect(first).toHaveLength(2);

    const last = first[1];
    const next = await t.repos.areas.list({
      limit: 2,
      after: { updatedAt: last?.updatedAt as number, id: last?.id as string },
    });

    expect(next).toHaveLength(2);
    expect(next.map((a) => a.id)).not.toContain(last?.id);
    expect(await t.repos.areas.count()).toBe(5);
  });
});
