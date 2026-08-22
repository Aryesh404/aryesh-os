import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../api/src/routers/index.js';

const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:4317';

/**
 * Type-only import of the router keeps end-to-end types with no codegen step.
 * The web app never imports API *runtime* code — only its shape.
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc` })],
});
