import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@aryesh/db';
import { newId, schema } from '@aryesh/db';
import { AppError } from '@aryesh/domain';

const { credentials, sessions, deviceTokens } = schema;

/**
 * Single-user authentication.
 *
 * There is no user table because there is no second user (docs/01 §1), but
 * mobile access over a tunnel is real network exposure, so this is proper auth
 * rather than a token in a config file.
 */

/**
 * OWASP-recommended Argon2id parameters: 19 MiB, 2 passes.
 *
 * `algorithm` is left at the library default, which is Argon2id — its enum is
 * an ambient const enum and cannot be imported under `verbatimModuleSyntax`.
 * A test asserts the produced hash actually carries the `$argon2id$` prefix, so
 * this is verified rather than assumed.
 */
const ARGON: Parameters<typeof hash>[1] = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const CREDENTIAL_ID = 'primary';

export type DeviceScope = 'read' | 'capture' | 'full';

export interface Principal {
  kind: 'session' | 'device';
  id: string;
  scope: DeviceScope;
}

export class AuthError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('UNAUTHORIZED', message, details);
    this.name = 'AuthError';
  }
}

/** Tokens are stored hashed, so a leaked database does not hand over sessions. */
const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

const newToken = (): string => randomBytes(32).toString('base64url');

const constantTimeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export interface AuthDeps {
  db: Db;
  clock: () => number;
}

export function createAuthService({ db, clock }: AuthDeps) {
  const service = {
    async isInitialised(): Promise<boolean> {
      const rows = await db.select({ id: credentials.id }).from(credentials).limit(1);
      return rows.length > 0;
    },

    /** First-run setup. Refuses to overwrite an existing credential. */
    async initialise(password: string): Promise<void> {
      if (await service.isInitialised()) {
        throw new AppError('CONFLICT', 'already initialised');
      }
      if (password.length < 10) {
        throw new AppError(
          'INVALID_INPUT',
          'password must be at least 10 characters',
        );
      }
      const now = clock();
      await db.insert(credentials).values({
        id: CREDENTIAL_ID,
        passwordHash: await hash(password, ARGON),
        generation: 1,
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: now,
        updatedAt: now,
      });
    },

    async login(
      password: string,
      context: { userAgent?: string; ip?: string } = {},
    ): Promise<{ token: string; expiresAt: number }> {
      const now = clock();
      const credential = (await db.select().from(credentials).limit(1))[0];

      if (!credential) throw new AuthError('not initialised');

      if (credential.lockedUntil !== null && credential.lockedUntil > now) {
        const seconds = Math.ceil((credential.lockedUntil - now) / 1000);
        throw new AuthError(`too many attempts — locked for ${seconds}s`, {
          lockedUntil: credential.lockedUntil,
        });
      }

      const ok = await verify(credential.passwordHash, password, ARGON);

      if (!ok) {
        const attempts = credential.failedAttempts + 1;
        await db
          .update(credentials)
          .set({
            failedAttempts: attempts,
            lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : null,
            updatedAt: now,
          })
          .where(eq(credentials.id, credential.id));
        throw new AuthError('incorrect password');
      }

      await db
        .update(credentials)
        .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
        .where(eq(credentials.id, credential.id));

      return service.createSession(credential.generation, context, now);
    },

    async createSession(
      generation: number,
      context: { userAgent?: string; ip?: string },
      now = clock(),
    ): Promise<{ token: string; expiresAt: number }> {
      const token = newToken();
      const expiresAt = now + SESSION_TTL_MS;

      await db.insert(sessions).values({
        id: newId(),
        tokenHash: hashToken(token),
        generation,
        expiresAt,
        lastSeenAt: now,
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
        revokedAt: null,
        createdAt: now,
      });

      return { token, expiresAt };
    },

    /** Resolves a session cookie. Returns null rather than throwing. */
    async resolveSession(token: string): Promise<Principal | null> {
      const now = clock();
      const row = (
        await db
          .select()
          .from(sessions)
          .where(eq(sessions.tokenHash, hashToken(token)))
          .limit(1)
      )[0];

      if (!row) return null;
      if (row.revokedAt !== null) return null;
      if (row.expiresAt <= now) return null;

      const credential = (await db.select().from(credentials).limit(1))[0];
      // A password change bumps the generation, which invalidates every
      // session issued before it without having to enumerate them.
      if (!credential || credential.generation !== row.generation) return null;

      await db
        .update(sessions)
        .set({ lastSeenAt: now })
        .where(eq(sessions.id, row.id));

      return { kind: 'session', id: row.id, scope: 'full' };
    },

    async logout(token: string): Promise<void> {
      await db
        .update(sessions)
        .set({ revokedAt: clock() })
        .where(eq(sessions.tokenHash, hashToken(token)));
    },

    async changePassword(current: string, next: string): Promise<void> {
      const credential = (await db.select().from(credentials).limit(1))[0];
      if (!credential) throw new AuthError('not initialised');

      if (!(await verify(credential.passwordHash, current, ARGON))) {
        throw new AuthError('current password is incorrect');
      }
      if (next.length < 10) {
        throw new AppError('INVALID_INPUT', 'password must be at least 10 characters');
      }

      const now = clock();
      // Bumping the generation logs out every existing session, which is the
      // behaviour someone changing their password is asking for.
      await db
        .update(credentials)
        .set({
          passwordHash: await hash(next, ARGON),
          generation: credential.generation + 1,
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(credentials.id, credential.id));
    },

    // ---- device tokens (CLI, mobile) ------------------------------------

    async issueDeviceToken(
      label: string,
      scope: DeviceScope = 'capture',
      expiresAt?: number,
    ): Promise<{ id: string; token: string }> {
      const now = clock();
      const token = `aos_${newToken()}`;
      const id = newId();

      await db.insert(deviceTokens).values({
        id,
        tokenHash: hashToken(token),
        label,
        scope,
        lastUsedAt: null,
        expiresAt: expiresAt ?? null,
        revokedAt: null,
        createdAt: now,
      });

      // The only time the plaintext exists. It is never stored or shown again.
      return { id, token };
    },

    async resolveDeviceToken(token: string): Promise<Principal | null> {
      const now = clock();
      const row = (
        await db
          .select()
          .from(deviceTokens)
          .where(eq(deviceTokens.tokenHash, hashToken(token)))
          .limit(1)
      )[0];

      if (!row) return null;
      if (row.revokedAt !== null) return null;
      if (row.expiresAt !== null && row.expiresAt <= now) return null;

      await db
        .update(deviceTokens)
        .set({ lastUsedAt: now })
        .where(eq(deviceTokens.id, row.id));

      return { kind: 'device', id: row.id, scope: row.scope as DeviceScope };
    },

    async listDeviceTokens() {
      return db
        .select({
          id: deviceTokens.id,
          label: deviceTokens.label,
          scope: deviceTokens.scope,
          lastUsedAt: deviceTokens.lastUsedAt,
          expiresAt: deviceTokens.expiresAt,
          revokedAt: deviceTokens.revokedAt,
          createdAt: deviceTokens.createdAt,
        })
        .from(deviceTokens);
    },

    async revokeDeviceToken(id: string): Promise<void> {
      await db
        .update(deviceTokens)
        .set({ revokedAt: clock() })
        .where(eq(deviceTokens.id, id));
    },

    async listSessions() {
      const now = clock();
      return db
        .select({
          id: sessions.id,
          lastSeenAt: sessions.lastSeenAt,
          userAgent: sessions.userAgent,
          ip: sessions.ip,
          createdAt: sessions.createdAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(and(isNull(sessions.revokedAt), sql`${sessions.expiresAt} > ${now}`));
    },

    async revokeSession(id: string): Promise<void> {
      await db.update(sessions).set({ revokedAt: clock() }).where(eq(sessions.id, id));
    },

    /** Housekeeping: drop rows that can no longer authenticate anything. */
    async pruneExpired(): Promise<number> {
      const now = clock();
      const result = await db
        .delete(sessions)
        .where(or(lt(sessions.expiresAt, now), sql`${sessions.revokedAt} IS NOT NULL`))
        .returning({ id: sessions.id });
      return result.length;
    },

    /** Exposed for the passkey ceremony, which compares challenges. */
    constantTimeEqual,
  };

  return service;
}

export type AuthService = ReturnType<typeof createAuthService>;
