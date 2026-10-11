import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../api/src/routers/index.js';

const API_URL =
  import.meta.env['VITE_API_URL'] ??
  (import.meta.env.PROD ? '/api' : 'http://localhost:4317');

/**
 * Type-only import of the router keeps end-to-end types with no codegen step.
 * The web app never imports API *runtime* code — only its shape.
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      // The session lives in an httpOnly cookie, so it has to ride along.
      // tRPC's init type has `signal?: AbortSignal | undefined`, which
      // exactOptionalPropertyTypes will not hand to the DOM's `RequestInit`.
      fetch: (url, options) =>
        fetch(url, { ...options, credentials: 'include' } as RequestInit),
    }),
  ],
});
