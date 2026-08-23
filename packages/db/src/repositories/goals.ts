import { eq, isNull } from 'drizzle-orm';
import { findCycle, type Edge } from '@aryesh/domain';
import { goals } from '../schema/index.js';
import {
  createRepository,
  type Ctx,
  type CustomFieldsGuard,
  type ManagedField,
  type Patch,
  type RepoDeps,
} from './base.js';
import { RelationCycleError } from './relations.js';

type GoalRow = typeof goals.$inferSelect;
type GoalInsert = typeof goals.$inferInsert;

/**
 * Goals nest through `parentGoalId` rather than through a stored relation, so
 * the acyclicity check that guards `contributes_to` has to guard this too —
 * otherwise a goal tree could become a goal loop and the progress roll-up would
 * recurse forever.
 */
export function createGoalsRepository(deps: RepoDeps, guard: CustomFieldsGuard) {
  const { db } = deps;
  const base = createRepository(deps, goals, 'goal', {
    revisioned: true,
    customFields: guard,
  });

  const parentEdges = async (): Promise<Edge[]> => {
    const rows = await db
      .select({ id: goals.id, parentGoalId: goals.parentGoalId })
      .from(goals)
      .where(isNull(goals.deletedAt));
    return rows
      .filter((r): r is { id: string; parentGoalId: string } => r.parentGoalId !== null)
      .map((r) => ({ fromId: r.id, toId: r.parentGoalId }));
  };

  const assertNoParentCycle = async (goalId: string, parentId: string): Promise<void> => {
    if (goalId === parentId) {
      throw new RelationCycleError('contributes_to', [goalId, parentId]);
    }
    const cycle = findCycle(await parentEdges(), goalId, parentId);
    if (cycle) throw new RelationCycleError('contributes_to', cycle);
  };

  return {
    ...base,

    async create(values: Parameters<typeof base.create>[0], ctx: Ctx): Promise<GoalRow> {
      const parentId = (values as Partial<GoalInsert>).parentGoalId;
      const row = (await base.create(values, ctx)) as GoalRow;
      if (parentId) {
        // Checked after insert so the new node is part of the graph being walked.
        try {
          await assertNoParentCycle(row.id, parentId);
        } catch (err) {
          await db.delete(goals).where(eq(goals.id, row.id));
          throw err;
        }
      }
      return row;
    },

    async setParent(id: string, parentGoalId: string | null, ctx: Ctx): Promise<GoalRow> {
      if (parentGoalId !== null) await assertNoParentCycle(id, parentGoalId);
      return (await base.update(id, { parentGoalId }, ctx, {
        label: 'reparent',
      })) as GoalRow;
    },

    async update(
      id: string,
      patch: Patch<Omit<GoalInsert, ManagedField>>,
      ctx: Ctx,
      opts: { expectedVersion?: number; label?: string } = {},
    ): Promise<GoalRow> {
      if (patch.parentGoalId !== undefined && patch.parentGoalId !== null) {
        await assertNoParentCycle(id, patch.parentGoalId);
      }
      return (await base.update(id, patch, ctx, opts)) as GoalRow;
    },

    async childrenOf(parentGoalId: string): Promise<GoalRow[]> {
      return (await base.list({ where: eq(goals.parentGoalId, parentGoalId) })) as GoalRow[];
    },

    async inTheme(themeId: string): Promise<GoalRow[]> {
      return (await base.list({ where: eq(goals.themeId, themeId) })) as GoalRow[];
    },
  };
}

export type GoalsRepository = ReturnType<typeof createGoalsRepository>;
