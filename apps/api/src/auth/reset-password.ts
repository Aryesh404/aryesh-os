import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { configureConnection, createDb, schema } from '@aryesh/db';
import { loadEnv } from '../env.js';
import { ARGON } from './service.js';

/**
 * Local password recovery.
 *
 * `changePassword` deliberately demands the current password, so a forgotten
 * one has no path through the API — which is correct for something reachable
 * over a tunnel. Recovery is therefore local and deliberately unauthenticated:
 * whoever holds `data/aryesh.db` can already read every row in it, so requiring
 * a secret here would protect nothing and only guarantee permanent lockout.
 *
 * Run with `npm run auth:reset`.
 */

const { credentials, sessions } = schema;

/**
 * A terminal gets two prompts. Piped input is read as two lines instead —
 * readline's second `question` never settles once stdin has ended, which would
 * hang a recovery script rather than fail it.
 */
async function readNewPassword(): Promise<[string, string]> {
  if (process.stdin.isTTY !== true) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const lines = Buffer.concat(chunks)
      .toString('utf8')
      .split('\n')
      .map((line) => line.trimEnd());
    return [lines[0] ?? '', lines[1] ?? ''];
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return [
      await rl.question('New password (at least 10 characters): '),
      await rl.question('Repeat it: '),
    ];
  } finally {
    rl.close();
  }
}

const env = loadEnv();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { db, client } = createDb({
  url: env.DATABASE_URL,
  root: repoRoot,
  authToken: env.DATABASE_AUTH_TOKEN,
});
await configureConnection(client, env.DATABASE_URL);

// A declaration rather than an arrow: TypeScript only narrows on a `never`
// return through a function declaration or an explicitly annotated variable.
function fail(message: string): never {
  console.error(`${message} Nothing was changed.`);
  client.close();
  process.exit(1);
}

const existing = (await db.select().from(credentials).limit(1))[0];
if (existing === undefined) {
  fail('No credential exists — this database has never been set up.');
}

const [next, again] = await readNewPassword();

if (next !== again) fail('Those do not match.');
if (next.length < 10) fail('Password must be at least 10 characters.');

const now = Date.now();

// Same rules as `changePassword`: bumping the generation invalidates every
// existing session, which is exactly what a recovered account wants. The
// session rows are then dead weight, so they go too.
await db
  .update(credentials)
  .set({
    passwordHash: await hash(next, ARGON),
    generation: existing.generation + 1,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: now,
  })
  .where(eq(credentials.id, existing.id));

await db.delete(sessions);

client.close();
console.warn('Password reset. Every existing session was signed out.');
