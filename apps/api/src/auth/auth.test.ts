import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@aryesh/db';
import { createTestApi, type TestApi } from '../testing.js';

const { credentials } = schema;
const T0 = 1_700_000_000_000;
const PASSWORD = 'a-long-enough-passphrase';

let api: TestApi;
beforeEach(async () => {
  api = await createTestApi(T0);
});
afterEach(() => api.close());

describe('first run', () => {
  it('reports uninitialised, then initialised', async () => {
    expect(await api.anonymous.auth.status()).toMatchObject({
      initialised: false,
      authenticated: false,
    });

    await api.anonymous.auth.initialise({ password: PASSWORD });

    expect(await api.anonymous.auth.status()).toMatchObject({ initialised: true });
    expect(api.cookies).toHaveLength(1);
  });

  it('refuses to overwrite an existing credential', async () => {
    await api.auth.initialise(PASSWORD);
    await expect(api.auth.initialise('another-password')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects a short password', async () => {
    await expect(api.auth.initialise('short')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('stores an Argon2id hash, never the password', async () => {
    await api.auth.initialise(PASSWORD);
    const [row] = await api.core.db.select().from(credentials);

    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain(PASSWORD);
  });
});

describe('login', () => {
  beforeEach(() => api.auth.initialise(PASSWORD));

  it('issues a session for the right password', async () => {
    const { token, expiresAt } = await api.auth.login(PASSWORD);
    expect(token).toBeTruthy();
    expect(expiresAt).toBeGreaterThan(T0);

    const principal = await api.auth.resolveSession(token);
    expect(principal).toMatchObject({ kind: 'session', scope: 'full' });
  });

  it('rejects the wrong password', async () => {
    await expect(api.auth.login('not-the-password')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('locks out after repeated failures, then reports how long', async () => {
    for (let i = 0; i < 8; i++) {
      await api.auth.login('wrong-password-here').catch(() => undefined);
    }
    await expect(api.auth.login(PASSWORD)).rejects.toThrow(/locked for/);
  });

  it('clears the failure count on a successful login', async () => {
    await api.auth.login('wrong-password-here').catch(() => undefined);
    await api.auth.login(PASSWORD);

    const [row] = await api.core.db.select().from(credentials);
    expect(row?.failedAttempts).toBe(0);
    expect(row?.lockedUntil).toBeNull();
  });

  it('stores the session hashed, so the database does not hand over sessions', async () => {
    const { token } = await api.auth.login(PASSWORD);
    const sessions = await api.core.db.select().from(schema.sessions);
    expect(sessions[0]?.tokenHash).not.toBe(token);
    expect(sessions[0]?.tokenHash).toHaveLength(64);
  });
});

describe('session lifecycle', () => {
  beforeEach(() => api.auth.initialise(PASSWORD));

  it('rejects an expired session', async () => {
    const { token } = await api.auth.login(PASSWORD);
    api.core.setNow(T0 + 31 * 86_400_000);
    expect(await api.auth.resolveSession(token)).toBeNull();
  });

  it('rejects a revoked session', async () => {
    const { token } = await api.auth.login(PASSWORD);
    await api.auth.logout(token);
    expect(await api.auth.resolveSession(token)).toBeNull();
  });

  it('rejects an unknown token', async () => {
    expect(await api.auth.resolveSession('made-up')).toBeNull();
  });

  /**
   * Changing a password should sign out the laptop you lost, without having to
   * enumerate sessions. Bumping the generation does it in one write.
   */
  it('invalidates every existing session on password change', async () => {
    const first = await api.auth.login(PASSWORD);
    const second = await api.auth.login(PASSWORD);

    await api.auth.changePassword(PASSWORD, 'a-brand-new-passphrase');

    expect(await api.auth.resolveSession(first.token)).toBeNull();
    expect(await api.auth.resolveSession(second.token)).toBeNull();

    const fresh = await api.auth.login('a-brand-new-passphrase');
    expect(await api.auth.resolveSession(fresh.token)).not.toBeNull();
  });

  it('refuses a password change with the wrong current password', async () => {
    await expect(
      api.auth.changePassword('wrong-password-x', 'a-brand-new-passphrase'),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('device tokens', () => {
  beforeEach(() => api.auth.initialise(PASSWORD));

  it('issues a scoped token and resolves it', async () => {
    const { token } = await api.auth.issueDeviceToken('Phone', 'capture');
    expect(token).toMatch(/^aos_/);

    const principal = await api.auth.resolveDeviceToken(token);
    expect(principal).toMatchObject({ kind: 'device', scope: 'capture' });
  });

  it('stores the token hashed — the plaintext exists exactly once', async () => {
    const { token } = await api.auth.issueDeviceToken('Phone');
    const rows = await api.core.db.select().from(schema.deviceTokens);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  it('stops resolving once revoked', async () => {
    const { id, token } = await api.auth.issueDeviceToken('Lost phone');
    await api.auth.revokeDeviceToken(id);
    expect(await api.auth.resolveDeviceToken(token)).toBeNull();
  });

  it('stops resolving once expired', async () => {
    const { token } = await api.auth.issueDeviceToken(
      'Temporary',
      'read',
      T0 + 60_000,
    );
    expect(await api.auth.resolveDeviceToken(token)).not.toBeNull();

    api.core.setNow(T0 + 120_000);
    expect(await api.auth.resolveDeviceToken(token)).toBeNull();
  });
});
