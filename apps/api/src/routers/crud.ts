import { z, type ZodTypeAny } from 'zod';
import type { Repositories } from '@aryesh/db';
import type { Context } from '../trpc.js';
import {
  actorOf,
  captureProcedure,
  fullProcedure,
  protectedProcedure,
  router,
} from '../trpc.js';

/**
 * The CRUD surface every domain object shares. Written once so ten routers do
 * not each re-derive pagination, soft delete, and optimistic concurrency
 * slightly differently.
 *
 * Anything with real behaviour — goals, metrics, relations, progress — gets a
 * hand-written router instead. This factory is for objects where CRUD genuinely
 * is the whole story.
 */

export const cursorSchema = z.object({
  updatedAt: z.number().int(),
  id: z.string(),
});

export const listInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: cursorSchema.optional(),
  includeDeleted: z.boolean().default(false),
});

type Actor = { actor: 'user' };

/**
 * Generic over the row type so the client keeps real end-to-end types. An
 * `unknown` here would quietly cost the web app the main reason for using tRPC.
 */
interface RepoLike<TRow> {
  list(opts: {
    limit?: number;
    after?: { updatedAt: number; id: string };
    includeDeleted?: boolean;
  }): Promise<TRow[]>;
  getById(id: string): Promise<TRow>;
  create(values: never, ctx: Actor): Promise<TRow>;
  update(
    id: string,
    patch: never,
    ctx: Actor,
    opts?: { expectedVersion?: number },
  ): Promise<TRow>;
  softDelete(id: string, ctx: Actor): Promise<void>;
  restore(id: string, ctx: Actor): Promise<TRow>;
}

export interface CrudRow {
  id: string;
  updatedAt: number;
}

export interface CrudHooks<TRow> {
  /**
   * Runs after a create or update. Used to emit the domain event that keeps
   * derived state true — the event bus is the seam, so nothing here calls the
   * progress engine directly.
   */
  afterWrite?: (row: TRow, ctx: Context) => Promise<void>;
}

export function crudRouter<TRow extends CrudRow>(
  pick: (repos: Repositories) => RepoLike<TRow>,
  schemas: { create: ZodTypeAny; update: ZodTypeAny },
  hooks: CrudHooks<TRow> = {},
) {
  const updateInput = z.object({
    id: z.string(),
    patch: schemas.update,
    expectedVersion: z.number().int().optional(),
  });

  return router({
    list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
      const repo = pick(ctx.core.repos);
      // One extra row tells us whether another page exists, without a count.
      const rows = await repo.list({
        limit: input.limit + 1,
        includeDeleted: input.includeDeleted,
        ...(input.cursor ? { after: input.cursor } : {}),
      });

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const last = items.at(-1);

      return {
        items,
        nextCursor: hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null,
      };
    }),

    byId: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(({ ctx, input }) => pick(ctx.core.repos).getById(input.id)),

    create: captureProcedure
      .input(schemas.create)
      .mutation(async ({ ctx, input }) => {
        const row = await pick(ctx.core.repos).create(input as never, actorOf(ctx));
        await hooks.afterWrite?.(row, ctx);
        return row;
      }),

    update: captureProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
      const row = await pick(ctx.core.repos).update(
        input.id,
        input.patch as never,
        actorOf(ctx),
        input.expectedVersion === undefined
          ? {}
          : { expectedVersion: input.expectedVersion },
      );
      await hooks.afterWrite?.(row, ctx);
      return row;
    }),

    // Deletion is structural, so it needs full access even though creating
    // only needs capture.
    remove: fullProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await pick(ctx.core.repos).softDelete(input.id, actorOf(ctx));
        return { ok: true as const };
      }),

    restore: fullProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => pick(ctx.core.repos).restore(input.id, actorOf(ctx))),
  });
}

export const customFields = z.record(z.string(), z.unknown()).optional();
