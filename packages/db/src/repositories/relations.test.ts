import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents } from '../schema/index.js';
import { createTestDb, TEST_ACTOR, type TestDb } from '../testing.js';

let t: TestDb;
let areaId: string;

beforeEach(async () => {
  t = await createTestDb();
  const area = await t.repos.areas.create(
    { name: 'Business', color: '#38bdf8', sortOrder: 0 },
    TEST_ACTOR,
  );
  areaId = area.id;
});
afterEach(() => t.close());

const goal = async (name: string) =>
  (await t.repos.goals.create({ areaId, name }, TEST_ACTOR)).id;

const project = async (name: string) =>
  (await t.repos.projects.create({ areaId, name, status: 'active' }, TEST_ACTOR)).id;

const task = async (title: string, projectId?: string) =>
  (
    await t.repos.tasks.create(
      projectId ? { projectId, title, status: 'todo' } : { title, status: 'todo' },
      TEST_ACTOR,
    )
  ).id;

describe('endpoint validation', () => {
  it('accepts the contribution shapes the progress engine understands', async () => {
    const g = await goal('₹5L MRR');
    const p = await project('Retainer platform');

    const rel = await t.repos.relations.create(
      { kind: 'contributes_to', fromType: 'project', fromId: p, toType: 'goal', toId: g, weight: 0.3 },
      TEST_ACTOR,
    );
    expect(rel.weight).toBe(0.3);
  });

  it('defaults contribution weight to 1', async () => {
    const g = await goal('Goal');
    const p = await project('Project');
    const rel = await t.repos.relations.create(
      { kind: 'contributes_to', fromType: 'project', fromId: p, toType: 'goal', toId: g },
      TEST_ACTOR,
    );
    expect(rel.weight).toBe(1);
  });

  /**
   * The activity-vs-advancement boundary, enforced at the data layer rather
   * than left to discipline (docs/03 §4.4, docs/14 §5).
   */
  it('refuses task → goal, and explains why', async () => {
    const g = await goal('₹5L MRR');
    const tk = await task('Ship billing');

    const attempt = t.repos.relations.create(
      { kind: 'contributes_to', fromType: 'task', fromId: tk, toType: 'goal', toId: g },
      TEST_ACTOR,
    );

    await expect(attempt).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(attempt).rejects.toThrow(/activity, not advancement/);
  });

  it('refuses belongs_to, which is a foreign key not an edge', async () => {
    const g = await goal('Goal');
    const attempt = t.repos.relations.create(
      { kind: 'belongs_to', fromType: 'goal', fromId: g, toType: 'area', toId: areaId },
      TEST_ACTOR,
    );
    await expect(attempt).rejects.toThrow(/derived from foreign keys/);
  });

  it('lists the valid options when an endpoint pair is wrong', async () => {
    const p = await project('Project');
    const attempt = t.repos.relations.create(
      { kind: 'measures', fromType: 'project', fromId: p, toType: 'goal', toId: p },
      TEST_ACTOR,
    );
    await expect(attempt).rejects.toThrow(/Valid: metric→goal, metric→project, metric→habit/);
  });

  it('allows relates_to between anything', async () => {
    const g = await goal('Goal');
    const p = await project('Project');
    const rel = await t.repos.relations.create(
      { kind: 'relates_to', fromType: 'project', fromId: p, toType: 'goal', toId: g },
      TEST_ACTOR,
    );
    expect(rel.kind).toBe('relates_to');
  });
});

describe('cycle rejection', () => {
  it('rejects a self-edge', async () => {
    const g = await goal('Goal');
    await expect(
      t.repos.relations.create(
        { kind: 'contributes_to', fromType: 'goal', fromId: g, toType: 'goal', toId: g },
        TEST_ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'CYCLE_DETECTED' });
  });

  it('rejects a cycle and shows the offending path', async () => {
    const a = await goal('A');
    const b = await goal('B');
    const c = await goal('C');

    const link = (from: string, to: string) =>
      t.repos.relations.create(
        { kind: 'contributes_to', fromType: 'goal', fromId: from, toType: 'goal', toId: to },
        TEST_ACTOR,
      );

    await link(a, b);
    await link(b, c);

    // C → A would close the loop A → B → C → A.
    const attempt = link(c, a);
    await expect(attempt).rejects.toMatchObject({ code: 'CYCLE_DETECTED' });

    const error = await attempt.then(
      () => null,
      (e: { details: { path: string[] } }) => e,
    );
    expect(error?.details.path).toEqual([a, b, c, a]);
  });

  it('guards depends_on chains too', async () => {
    const t1 = await task('One');
    const t2 = await task('Two');
    const dep = (from: string, to: string) =>
      t.repos.relations.create(
        { kind: 'depends_on', fromType: 'task', fromId: from, toType: 'task', toId: to },
        TEST_ACTOR,
      );

    await dep(t1, t2);
    await expect(dep(t2, t1)).rejects.toMatchObject({ code: 'CYCLE_DETECTED' });
  });

  it('allows a diamond, which is not a cycle', async () => {
    const top = await goal('Top');
    const left = await goal('Left');
    const right = await goal('Right');
    const bottom = await goal('Bottom');

    const link = (from: string, to: string) =>
      t.repos.relations.create(
        { kind: 'contributes_to', fromType: 'goal', fromId: from, toType: 'goal', toId: to },
        TEST_ACTOR,
      );

    await link(bottom, left);
    await link(bottom, right);
    await link(left, top);
    await expect(link(right, top)).resolves.toBeDefined();
  });

  it('guards the goal parent hierarchy, which nests by FK not by edge', async () => {
    const parent = await goal('Parent');
    const child = (await t.repos.goals.create(
      { areaId, name: 'Child', parentGoalId: parent },
      TEST_ACTOR,
    )).id;

    await expect(
      t.repos.goals.setParent(parent, child, TEST_ACTOR),
    ).rejects.toMatchObject({ code: 'CYCLE_DETECTED' });

    await expect(
      t.repos.goals.setParent(parent, parent, TEST_ACTOR),
    ).rejects.toMatchObject({ code: 'CYCLE_DETECTED' });
  });

  it('rejects a dangling parent at the database, not just in code', async () => {
    const before = await t.repos.goals.count();
    await expect(
      t.repos.goals.create({ areaId, name: 'Orphan', parentGoalId: 'no-such-goal' }, TEST_ACTOR),
    ).rejects.toThrow();
    expect(await t.repos.goals.count()).toBe(before);
  });

  it('rejects a dangling foreign key on any record', async () => {
    await expect(
      t.repos.themes.create({ areaId: 'no-such-area', name: 'Orphan' }, TEST_ACTOR),
    ).rejects.toThrow();
  });
});

describe('traversal and audit', () => {
  it('finds contributors of a goal — the progress engine input', async () => {
    const g = await goal('₹5L MRR');
    const p1 = await project('Retainer platform');
    const p2 = await project('Website revamp');

    await t.repos.relations.create(
      { kind: 'contributes_to', fromType: 'project', fromId: p1, toType: 'goal', toId: g, weight: 0.7 },
      TEST_ACTOR,
    );
    await t.repos.relations.create(
      { kind: 'contributes_to', fromType: 'project', fromId: p2, toType: 'goal', toId: g, weight: 0.3 },
      TEST_ACTOR,
    );
    // A diagnostic edge must NOT show up as a contributor (docs/14 Case 1).
    await t.repos.relations.create(
      { kind: 'relates_to', fromType: 'project', fromId: p1, toType: 'goal', toId: g },
      TEST_ACTOR,
    );

    const contributors = await t.repos.relations.contributorsOf(g);
    expect(contributors).toHaveLength(2);
    expect(contributors.map((c) => c.weight).sort()).toEqual([0.3, 0.7]);
  });

  it('audits relation create and delete', async () => {
    const g = await goal('Goal');
    const p = await project('Project');
    const rel = await t.repos.relations.create(
      { kind: 'contributes_to', fromType: 'project', fromId: p, toType: 'goal', toId: g },
      TEST_ACTOR,
    );
    await t.repos.relations.softDelete(rel.id, TEST_ACTOR);

    const events = await t.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.subjectId, rel.id));
    expect(events.map((e) => e.action)).toEqual(['create', 'delete']);

    expect(await t.repos.relations.contributorsOf(g)).toHaveLength(0);
  });
});
