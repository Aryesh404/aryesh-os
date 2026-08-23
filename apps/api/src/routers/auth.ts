import { z } from 'zod';
import { fullProcedure, publicProcedure, router } from '../trpc.js';

const password = z.string().min(10).max(200);

export const authRouter = router({
  /** Unauthenticated on purpose: the login screen needs to know what to render. */
  status: publicProcedure.query(async ({ ctx }) => ({
    initialised: await ctx.auth.isInitialised(),
    authenticated: ctx.principal !== null,
    scope: ctx.principal?.scope ?? null,
  })),

  /** First run only. Refuses to overwrite an existing credential. */
  initialise: publicProcedure
    .input(z.object({ password }))
    .mutation(async ({ ctx, input }) => {
      await ctx.auth.initialise(input.password);
      const session = await ctx.auth.login(input.password);
      ctx.setSessionCookie(session.token, session.expiresAt);
      return { ok: true as const };
    }),

  login: publicProcedure
    .input(z.object({ password: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.auth.login(input.password);
      ctx.setSessionCookie(session.token, session.expiresAt);
      return { ok: true as const, expiresAt: session.expiresAt };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.principal?.kind === 'session') {
      await ctx.auth.revokeSession(ctx.principal.id);
    }
    ctx.clearSessionCookie();
    return { ok: true as const };
  }),

  changePassword: fullProcedure
    .input(z.object({ current: z.string().max(200), next: password }))
    .mutation(async ({ ctx, input }) => {
      // Bumping the credential generation invalidates every session, including
      // this one. Signing back in is the correct, expected consequence.
      await ctx.auth.changePassword(input.current, input.next);
      ctx.clearSessionCookie();
      return { ok: true as const, signedOutEverywhere: true };
    }),

  sessions: router({
    list: fullProcedure.query(({ ctx }) => ctx.auth.listSessions()),
    revoke: fullProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.auth.revokeSession(input.id);
        return { ok: true as const };
      }),
  }),

  devices: router({
    list: fullProcedure.query(({ ctx }) => ctx.auth.listDeviceTokens()),

    /**
     * Returns the plaintext token exactly once. It is stored hashed, so it
     * cannot be shown again — losing it means issuing a new one.
     */
    issue: fullProcedure
      .input(
        z.object({
          label: z.string().min(1).max(80),
          scope: z.enum(['read', 'capture', 'full']).default('capture'),
          expiresAt: z.number().int().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.auth.issueDeviceToken(input.label, input.scope, input.expiresAt),
      ),

    revoke: fullProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.auth.revokeDeviceToken(input.id);
        return { ok: true as const };
      }),
  }),
});
