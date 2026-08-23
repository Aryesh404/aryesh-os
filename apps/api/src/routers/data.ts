import { z } from 'zod';
import {
  exportAll,
  importAll,
  listBackups,
  pruneBackups,
  snapshotDatabase,
  validateExport,
  type ExportPayload,
} from '@aryesh/db';
import { fullProcedure, router } from '../trpc.js';

/**
 * docs/27 — the user must be able to export, back up, restore, and delete their
 * own data. This is the router that makes "your data is yours" operable rather
 * than a claim in a document.
 *
 * Everything here is `full` scope: a capture-scoped phone should not be able to
 * pull the whole database, and restoring is the single most destructive action
 * in the product.
 */
export const dataRouter = router({
  /** Readable JSON. Diffable, and importable into a fresh instance. */
  export: fullProcedure.query(({ ctx }) => exportAll(ctx.db, ctx.now())),

  backups: router({
    list: fullProcedure.query(({ ctx }) => listBackups(ctx.backupDir)),

    /** `VACUUM INTO` — hot, consistent, and safe to run while the app is open. */
    create: fullProcedure.mutation(async ({ ctx }) => {
      const stamp = new Date(ctx.now()).toISOString().replace(/[:.]/g, '-');
      const backup = await snapshotDatabase(
        ctx.client,
        `${ctx.backupDir}/aryesh-${stamp}.db`,
      );
      const removed = pruneBackups(ctx.backupDir, ctx.now());
      return { ...backup, pruned: removed.length };
    }),
  }),

  /**
   * Checks an export without touching anything, so the UI can warn first.
   *
   * A mutation despite reading nothing: tRPC puts query input in the URL, and a
   * whole database export does not fit in one.
   */
  validateImport: fullProcedure
    .input(z.object({ payload: z.unknown() }))
    .mutation(({ input }) => validateExport(input.payload as ExportPayload)),

  /**
   * Replaces everything in the exported tables.
   *
   * A binary snapshot is taken first, unconditionally: this is the one
   * operation where "are you sure?" is not enough, because the answer is only
   * discoverable afterwards.
   */
  import: fullProcedure
    .input(
      z.object({
        payload: z.unknown(),
        confirm: z.literal('replace everything'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stamp = new Date(ctx.now()).toISOString().replace(/[:.]/g, '-');
      const safety = await snapshotDatabase(
        ctx.client,
        `${ctx.backupDir}/aryesh-before-import-${stamp}.db`,
      );

      const result = await importAll(ctx.client, input.payload as ExportPayload);
      return { ...result, revertTo: safety.path };
    }),
});
