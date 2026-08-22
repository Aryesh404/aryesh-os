import { z } from 'zod';
import { normaliseMetric } from '@aryesh/intelligence';
import { NotMeasurableError } from '@aryesh/contracts';
import { publicProcedure, router } from '../trpc.js';

const health = router({
  ping: publicProcedure.query(({ ctx }) => ({
    ok: true as const,
    at: ctx.now(),
    version: '0.1.0',
  })),
});

/**
 * M1 exposes exactly one real computation, end to end: a value entering the
 * API, normalised by the pure intelligence core, returned with its derivation.
 * It proves the wiring the rest of Phase 1 is built on.
 */
const measure = router({
  normalise: publicProcedure
    .input(
      z.object({
        direction: z.enum(['increase', 'decrease', 'maintain']),
        current: z.number().finite(),
        baseline: z.number().finite().optional(),
        target: z.number().finite().optional(),
        tolerance: z.number().finite().positive().optional(),
        label: z.string().max(120).optional(),
      }),
    )
    .query(({ input }) => {
      const result = normaliseMetric(input);
      if (!result.satisfied) {
        throw new NotMeasurableError(result.reason, { input });
      }
      return result.result;
    }),
});

export const appRouter = router({ health, measure });

export type AppRouter = typeof appRouter;
