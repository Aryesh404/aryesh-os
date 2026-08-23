import { and, eq, isNull, or } from 'drizzle-orm';
import {
  ACYCLIC_KINDS,
  AppError,
  checkEndpoints,
  findCycle,
  type Edge,
  type ObjectKind,
  type RelationKind,
} from '@aryesh/domain';

import { auditEvents, relations } from '../schema/index.js';
import { newId } from '../ids.js';
import type { Ctx, RepoDeps } from './base.js';

export interface CreateRelationInput {
  kind: RelationKind;
  fromType: ObjectKind;
  fromId: string;
  toType: ObjectKind;
  toId: string;
  /** `contributes_to` only. Relative; normalised at evaluation time. */
  weight?: number | undefined;
  /** `contributes_to` only. Null derives it from the goal's measurement mode. */
  evaluation?: 'level' | 'rate' | undefined;
  expectedRate?: { value: number; per: 'week' | 'month' | 'quarter' } | undefined;
  /** `measures` only (docs/03 §10). */
  leads?: { targetMetricId: string; lagDays: number } | undefined;
}

export class InvalidRelationError extends AppError {
  constructor(reason: string, details: Record<string, unknown>) {
    super('INVALID_INPUT', reason, details);
    this.name = 'InvalidRelationError';
  }
}

export class RelationCycleError extends AppError {
  constructor(kind: RelationKind, path: string[]) {
    super(
      'CYCLE_DETECTED',
      `This ${kind} edge would create a cycle: ${path.join(' → ')}`,
      { kind, path },
    );
    this.name = 'RelationCycleError';
  }
}

export function createRelationsRepository(deps: RepoDeps) {
  const { db, clock } = deps;

  /**
   * All live edges of one kind. A full scan of that kind, which is correct for
   * a single user's graph (thousands of rows) and keeps cycle detection exact
   * rather than depth-limited.
   */
  const edgesOfKind = async (kind: RelationKind): Promise<Edge[]> => {
    const rows = await db
      .select({ fromId: relations.fromId, toId: relations.toId })
      .from(relations)
      .where(and(eq(relations.kind, kind), isNull(relations.deletedAt)));
    return rows;
  };

  const repo = {
    async create(input: CreateRelationInput, ctx: Ctx) {
      const endpoints = checkEndpoints(input.kind, input.fromType, input.toType);
      if (!endpoints.valid) {
        throw new InvalidRelationError(endpoints.reason, {
          kind: input.kind,
          from: input.fromType,
          to: input.toType,
        });
      }

      if (input.fromId === input.toId) {
        throw new RelationCycleError(input.kind, [input.fromId, input.toId]);
      }

      if (ACYCLIC_KINDS.includes(input.kind)) {
        const cycle = findCycle(await edgesOfKind(input.kind), input.fromId, input.toId);
        if (cycle) throw new RelationCycleError(input.kind, cycle);
      }

      const now = clock();
      const id = newId();
      const row = {
        id,
        kind: input.kind,
        fromType: input.fromType,
        fromId: input.fromId,
        toType: input.toType,
        toId: input.toId,
        weight: input.kind === 'contributes_to' ? (input.weight ?? 1) : (input.weight ?? null),
        evaluation: input.evaluation ?? null,
        expectedRateValue: input.expectedRate?.value ?? null,
        expectedRatePer: input.expectedRate?.per ?? null,
        leadsMetricId: input.leads?.targetMetricId ?? null,
        lagDays: input.leads?.lagDays ?? null,
        createdAt: now,
        createdBy: ctx.actor,
        deletedAt: null,
      };

      await db.insert(relations).values(row);
      await db.insert(auditEvents).values({
        id: newId(),
        at: now,
        actor: ctx.actor,
        action: 'create',
        subjectType: 'relation',
        subjectId: id,
        before: null,
        after: row,
        note: ctx.note ?? null,
        executionId: ctx.executionId ?? null,
      });

      return row;
    },

    async setWeight(id: string, weight: number, ctx: Ctx) {
      const before = await repo.findById(id);
      if (!before) throw new AppError('NOT_FOUND', `relation ${id} not found`, { id });
      const now = clock();
      await db.update(relations).set({ weight }).where(eq(relations.id, id));
      await db.insert(auditEvents).values({
        id: newId(),
        at: now,
        actor: ctx.actor,
        action: 'update',
        subjectType: 'relation',
        subjectId: id,
        before,
        after: { ...before, weight },
        note: ctx.note ?? null,
        executionId: ctx.executionId ?? null,
      });
    },

    /**
     * docs/03 §4 — what "on pace" means for a momentum contributor.
     *
     * Without a stated rate the engine scores against the contributor's own
     * trailing average, which means a goal can never report `advancing` — it is
     * always, by construction, exactly as fast as itself.
     */
    async setExpectedRate(
      id: string,
      rate: { value: number; per: 'week' | 'month' | 'quarter' } | null,
      ctx: Ctx,
    ) {
      const before = await repo.findById(id);
      if (!before) throw new AppError('NOT_FOUND', `relation ${id} not found`, { id });
      const now = clock();
      const patch = {
        expectedRateValue: rate?.value ?? null,
        expectedRatePer: rate?.per ?? null,
        // A stated rate is what makes this a rate contributor; without one the
        // engine has nothing to evaluate a rate against.
        evaluation: rate === null ? before.evaluation : ('rate' as const),
      };
      await db.update(relations).set(patch).where(eq(relations.id, id));
      await db.insert(auditEvents).values({
        id: newId(),
        at: now,
        actor: ctx.actor,
        action: 'update',
        subjectType: 'relation',
        subjectId: id,
        before,
        after: { ...before, ...patch },
        note: ctx.note ?? null,
        executionId: ctx.executionId ?? null,
      });
    },

    async findById(id: string) {
      const rows = await db.select().from(relations).where(eq(relations.id, id)).limit(1);
      return rows[0];
    },

    async softDelete(id: string, ctx: Ctx) {
      const before = await repo.findById(id);
      if (!before) throw new AppError('NOT_FOUND', `relation ${id} not found`, { id });
      const now = clock();
      await db.update(relations).set({ deletedAt: now }).where(eq(relations.id, id));
      await db.insert(auditEvents).values({
        id: newId(),
        at: now,
        actor: ctx.actor,
        action: 'delete',
        subjectType: 'relation',
        subjectId: id,
        before,
        after: null,
        note: ctx.note ?? null,
        executionId: ctx.executionId ?? null,
      });
    },

    /** Edges pointing at a node, optionally of one kind. */
    async incoming(toId: string, kind?: RelationKind) {
      const clauses = [eq(relations.toId, toId), isNull(relations.deletedAt)];
      if (kind) clauses.push(eq(relations.kind, kind));
      return db
        .select()
        .from(relations)
        .where(and(...clauses));
    },

    async outgoing(fromId: string, kind?: RelationKind) {
      const clauses = [eq(relations.fromId, fromId), isNull(relations.deletedAt)];
      if (kind) clauses.push(eq(relations.kind, kind));
      return db
        .select()
        .from(relations)
        .where(and(...clauses));
    },

    /** Everything touching a node, in either direction. */
    async touching(id: string) {
      return db
        .select()
        .from(relations)
        .where(and(or(eq(relations.fromId, id), eq(relations.toId, id)), isNull(relations.deletedAt)));
    },

    /**
     * The contribution subgraph feeding a goal. This IS the progress
     * computation's input — nothing enters a number through another path
     * (docs/03 §5 rule 1).
     */
    async contributorsOf(goalId: string) {
      return db
        .select()
        .from(relations)
        .where(
          and(
            eq(relations.toId, goalId),
            eq(relations.kind, 'contributes_to'),
            isNull(relations.deletedAt),
          ),
        );
    },
  };

  return repo;
}

export type RelationsRepository = ReturnType<typeof createRelationsRepository>;
