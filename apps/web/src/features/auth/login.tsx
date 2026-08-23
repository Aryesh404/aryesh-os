import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorNote, Field, Input, Subtle } from '../../components/ui.tsx';
import { keys } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';

/**
 * First run sets the password; afterwards it signs in. One screen, because
 * there is one account (docs/01 §1).
 */
export function LoginScreen({ initialised }: { initialised: boolean }) {
  const client = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = !initialised && password.length > 0 && password.length < 10;
  const mismatch = !initialised && confirm.length > 0 && confirm !== password;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (initialised) {
        await trpc.auth.login.mutate({ password });
      } else {
        await trpc.auth.initialise.mutate({ password });
      }
      await client.invalidateQueries({ queryKey: keys.auth });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-full grid place-items-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-surface border border-line rounded-panel p-6 space-y-4"
      >
        <header>
          <h1 className="text-[20px] font-semibold m-0">Aryesh OS</h1>
          <p className="text-fg-subtle text-[12px] mt-1 mb-0">
            {initialised ? 'Sign in to continue' : 'Set a password to get started'}
          </p>
        </header>

        <Field
          label="Password"
          {...(tooShort ? { error: 'At least 10 characters' } : {})}
        >
          <Input
            type="password"
            autoFocus
            autoComplete={initialised ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {!initialised && (
          <Field
            label="Confirm password"
            {...(mismatch ? { error: 'Passwords do not match' } : {})}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        )}

        {error && <ErrorNote error={new Error(error)} />}

        <Button
          type="submit"
          variant="primary"
          className="w-full justify-center"
          disabled={
            busy ||
            password.length === 0 ||
            (!initialised && (tooShort || mismatch || confirm.length === 0))
          }
        >
          {busy ? 'Working…' : initialised ? 'Sign in' : 'Create account'}
        </Button>

        {!initialised && (
          <p className="m-0">
            <Subtle>
              This unlocks the database on this machine. There is no recovery — the
              data is yours and lives only here.
            </Subtle>
          </p>
        )}
      </form>
    </main>
  );
}
