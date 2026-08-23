import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { AppError, NotFoundError, type Actor } from '@aryesh/domain';

import { auditEvents, revisions } from '../schema/index.js';
import type { Db } from '../client.js';
import { newId } from '../ids.js';

/**
 * Every domain table carries these. Audit, soft delete, and optimistic
 * concurrency are handled once here rather than remembered eleven times.
 */
export interface RecordTable extends SQLiteTable {
  id: SQLiteColumn;
  createdAt: SQLiteColumn;
  updatedAt: SQLiteColumn;
  createdBy: SQLiteColumn;
  updatedBy: SQLiteColumn;
  version: SQLiteColumn;
  deletedAt: SQLiteColumn;
}

export interface Ctx {
  actor: Actor;
  /** Set when the change came from a Claude execution (docs/10). */
  executionId?: string;
  note?: string;
}

export interface RepoDeps {
  db: Db;
  /** Injected so nothing in the data layer reads the wall clock directly. */
  clock: () => number;
}

/**
 * Structural, so `base` need not import the custom-field module that imports it.
 */
export interface CustomFieldsGuard {
  objectKind: string;
  validate(objectKind: string, values: unknown): Promise<Record<string, unknown>>;
}

export interface RepositoryOptions {
  /**
   * Write a revision with an inverse patch on every update, making undo a
   * lookup (docs/08 §5). On for configuration-shaped records.
   */
  revisioned?: boolean;
  /** Validate the `customFields` bag on write against its definitions. */
  customFields?: CustomFieldsGuard;
}

export interface ListOptions {
  includeDeleted?: boolean;
  where?: SQL | undefined;
  limit?: number;
  /** Keyset pagination cursor: the last seen `(updatedAt, id)`. No OFFSET. */
  after?: { updatedAt: number; id: string };
}

export class VersionConflictError extends AppError {
  constructor(subjectType: string, id: string, expected: number, actual: number) {
    super('CONFLICT', `${subjectType} ${id} was modified by someone else`, {
      expected,
      actual,
    });
    this.name = 'VersionConflictError';
  }
}

/** Fields the caller may never set directly. */
const MANAGED_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'version',
  'deletedAt',
] as const;

export type ManagedField = (typeof MANAGED_FIELDS)[number];

/**
 * `Partial<T>` is not enough under `exactOptionalPropertyTypes`: a Zod-inferred
 * optional is `k?: V | undefined`, which a plain `Partial` rejects. Patches
 * come from parsed input, so they always have that shape.
 */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

const MANAGED: ReadonlySet<string> = new Set<string>(MANAGED_FIELDS);

function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { patch: Record<string, unknown>; inverse: Record<string, unknown> } {
  const patch: Record<string, unknown> = {};
  const inverse: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (MANAGED.has(key)) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    patch[key] = after[key];
    inverse[key] = before[key] ?? null;
  }
  return { patch, inverse };
}

export function createRepository<T extends RecordTable>(
  deps: RepoDeps,
  table: T,
  subjectType: string,
  options: RepositoryOptions = {},
) {
  type Row = T['$inferSelect'];
  type Insert = T['$inferInsert'];

  const { db, clock } = deps;

  // Drizzle cannot narrow a generic `T extends SQLiteTable` for its query
  // builders. The runtime shape is correct and RecordTable constrains it; only
  // the builder generics are widened here.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const t = table as any;

  const audit = async (
    action: string,
    id: string,
    before: unknown,
    after: unknown,
    ctx: Ctx,
  ): Promise<void> => {
    await db.insert(auditEvents).values({
      id: newId(),
      at: clock(),
      actor: ctx.actor,
      action,
      subjectType,
      subjectId: id,
      before: before ?? null,
      after: after ?? null,
      note: ctx.note ?? null,
      executionId: ctx.executionId ?? null,
    });
  };

  const notDeleted = (extra?: SQL): SQL =>
    (extra ? and(isNull(table.deletedAt), extra) : isNull(table.deletedAt)) as SQL;

  const repo = {
    async findById(id: string, opts: { includeDeleted?: boolean } = {}) {
      const where = opts.includeDeleted
        ? eq(table.id, id)
        : and(eq(table.id, id), isNull(table.deletedAt));
      const rows = (await db.select().from(t).where(where).limit(1)) as Row[];
      return rows[0];
    },

    async getById(id: string, opts: { includeDeleted?: boolean } = {}): Promise<Row> {
      const row = await repo.findById(id, opts);
      if (!row) throw new NotFoundError(subjectType, id);
      return row;
    },

    async list(opts: ListOptions = {}): Promise<Row[]> {
      const clauses: SQL[] = [];
      if (!opts.includeDeleted) clauses.push(isNull(table.deletedAt) as SQL);
      if (opts.where) clauses.push(opts.where);
      if (opts.after) {
        clauses.push(
          sql`(${table.updatedAt}, ${table.id}) > (${opts.after.updatedAt}, ${opts.after.id})`,
        );
      }
      const where = clauses.length > 0 ? and(...clauses) : undefined;
      // `$dynamic()` keeps the builder type stable across conditional chaining;
      // without it drizzle strips each method from the type once called.
      let q = db.select().from(t).$dynamic();
      if (where) q = q.where(where);
      q = q.orderBy(table.updatedAt, table.id);
      if (opts.limit !== undefined) q = q.limit(opts.limit);
      return (await q) as Row[];
    },

    async create(
      values: Omit<Insert, ManagedField> & { id?: string },
      ctx: Ctx,
    ): Promise<Row> {
      const now = clock();
      const id = (values as { id?: string }).id ?? newId();
      const incoming = values as Record<string, unknown>;
      const guard = options.customFields;
      const customFields = guard
        ? await guard.validate(guard.objectKind, incoming['customFields'] ?? {})
        : undefined;
      const row = {
        ...values,
        ...(customFields ? { customFields } : {}),
        id,
        createdAt: now,
        updatedAt: now,
        createdBy: ctx.actor,
        updatedBy: ctx.actor,
        version: 1,
        deletedAt: null,
      };

      await db.insert(t).values(row);
      await audit('create', id, null, row, ctx);
      return repo.getById(id);
    },

    async update(
      id: string,
      patch: Patch<Omit<Insert, ManagedField>>,
      ctx: Ctx,
      opts: { expectedVersion?: number; label?: string } = {},
    ): Promise<Row> {
      const before = (await repo.getById(id)) as Record<string, unknown>;
      const currentVersion = before['version'] as number;

      if (opts.expectedVersion !== undefined && opts.expectedVersion !== currentVersion) {
        throw new VersionConflictError(
          subjectType,
          id,
          opts.expectedVersion,
          currentVersion,
        );
      }

      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (!MANAGED.has(key)) clean[key] = value;
      }

      const guard = options.customFields;
      if (guard && 'customFields' in clean) {
        clean['customFields'] = await guard.validate(
          guard.objectKind,
          clean['customFields'],
        );
      }

      const now = clock();
      await db
        .update(t)
        .set({
          ...clean,
          updatedAt: now,
          updatedBy: ctx.actor,
          version: currentVersion + 1,
        })
        .where(eq(table.id, id));

      const after = (await repo.getById(id)) as Record<string, unknown>;
      await audit('update', id, before, after, ctx);

      if (options.revisioned) {
        const { patch: forward, inverse } = diff(before, after);
        if (Object.keys(forward).length > 0) {
          await db.insert(revisions).values({
            id: newId(),
            subjectType,
            subjectId: id,
            version: currentVersion + 1,
            patch: forward,
            inverse,
            actor: ctx.actor,
            at: now,
            label: opts.label ?? null,
          });
        }
      }

      return after as Row;
    },

    /** docs/02 §4 — soft delete everywhere, with a restore window. */
    async softDelete(id: string, ctx: Ctx): Promise<void> {
      const before = await repo.getById(id);
      const now = clock();
      await db
        .update(t)
        .set({ deletedAt: now, updatedAt: now, updatedBy: ctx.actor })
        .where(eq(table.id, id));
      await audit('delete', id, before, null, ctx);
    },

    async restore(id: string, ctx: Ctx): Promise<Row> {
      const before = await repo.getById(id, { includeDeleted: true });
      const now = clock();
      await db
        .update(t)
        .set({ deletedAt: null, updatedAt: now, updatedBy: ctx.actor })
        .where(eq(table.id, id));
      await audit('restore', id, before, null, ctx);
      return repo.getById(id);
    },

    async count(where?: SQL): Promise<number> {
      const rows = (await db
        .select({ n: sql<number>`count(*)` })
        .from(t)
        .where(notDeleted(where))) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return repo;
}

export type Repository<T extends RecordTable> = ReturnType<typeof createRepository<T>>;
