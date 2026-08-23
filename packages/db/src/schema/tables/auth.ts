import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Single-user auth. There is no user table because there is no second user:
 * the credential row IS the account (docs/01 §1).
 *
 * Mobile access over a tunnel is still real network exposure, so this is
 * proper auth rather than a token in a config file.
 */
export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  /** Argon2id. Never a fast hash, never reversible. */
  passwordHash: text('password_hash').notNull(),
  /** Bumped on password change; invalidates every existing session. */
  generation: integer('generation').notNull().default(1),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  /** Set after repeated failures. Cleared on success. */
  lockedUntil: integer('locked_until'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** WebAuthn passkeys. Registered against the single account. */
export const passkeys = sqliteTable(
  'passkeys',
  {
    id: text('id').primaryKey(),
    /** Base64url credential id from the authenticator. */
    credentialId: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    /** Replay guard: must not go backwards. */
    counter: integer('counter').notNull().default(0),
    transports: text('transports', { mode: 'json' }).$type<string[]>(),
    label: text('label').notNull(),
    lastUsedAt: integer('last_used_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('idx_passkeys_credential').on(t.credentialId)],
);

/** Short-lived challenges for registration and authentication ceremonies. */
export const authChallenges = sqliteTable('auth_challenges', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull(),
  kind: text('kind').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

/**
 * Browser sessions. The cookie carries an opaque id; the hash is what is
 * stored, so a leaked database does not hand over live sessions.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    generation: integer('generation').notNull().default(1),
    expiresAt: integer('expires_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_sessions_token').on(t.tokenHash),
    index('idx_sessions_expiry').on(t.expiresAt),
  ],
);

/**
 * Long-lived tokens for the CLI and the mobile companion, which cannot hold a
 * cookie. Scoped and individually revocable, so losing a phone does not mean
 * rotating the password.
 */
export const deviceTokens = sqliteTable(
  'device_tokens',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    label: text('label').notNull(),
    /** `read` | `capture` | `full`. Capture is enough for quick entry. */
    scope: text('scope').notNull().default('capture'),
    lastUsedAt: integer('last_used_at'),
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('idx_device_tokens_hash').on(t.tokenHash)],
);
