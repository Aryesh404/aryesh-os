import { useState } from 'react';
import {
  Button,
  Card,
  Dialog,
  Empty,
  ErrorNote,
  Field,
  Input,
  Select,
  Skeleton,
  Subtle,
} from '../../components/ui.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { date as formatDate, dateInput, fromDateInput, money } from '../../lib/format.js';
import { ImportDialog } from './import-dialog.tsx';

/**
 * docs/15 §5 M9 — finance had working routers and no screens, so the ₹1 Cr goal
 * could only be tracked by typing a number computed somewhere else.
 *
 * Money is integer minor units end to end. Nothing here ever holds a float.
 */
export function FinancePage() {
  const [addingAccount, setAddingAccount] = useState(false);
  const [addingTxn, setAddingTxn] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const accounts = useApi(keys.accounts, () => trpc.accounts.list.query({ limit: 100 }));
  const transactions = useApi(keys.transactions, () =>
    trpc.transactions.list.query({ limit: 200 }),
  );

  const rows = accounts.data?.items ?? [];
  const active = selected ?? rows[0]?.id ?? null;

  // Assets minus liabilities, in minor units. Net worth is the one figure that
  // makes the ₹1 Cr goal legible at a glance.
  const netWorthMinor = rows.reduce(
    (sum, a) => sum + (a.isLiability ? -a.balanceMinor : a.balanceMinor),
    0,
  );

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-[20px] font-semibold m-0">Finance</h1>
          <Subtle>Accounts and transactions — what the money is actually doing</Subtle>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAddingAccount(true)}>New account</Button>
          <Button variant="ghost" onClick={() => setImporting(true)} disabled={rows.length === 0}>
            Import CSV
          </Button>
        </div>
      </header>

      {accounts.isPending && <Skeleton className="h-24 w-full" />}
      {accounts.isError && <ErrorNote error={accounts.error} />}

      {accounts.isSuccess && rows.length === 0 && (
        <Empty
          title="No accounts yet"
          hint="Add a bank account, an investment account, and any liabilities. Balances here are what net worth is computed from."
          action={<Button onClick={() => setAddingAccount(true)}>Add an account</Button>}
        />
      )}

      {rows.length > 0 && (
        <>
          <Card title="Net worth">
            <div className="flex items-baseline gap-3">
              <span className="mono text-[26px] tabular-nums">{money(netWorthMinor)}</span>
              <Subtle>
                across {rows.length} account{rows.length === 1 ? '' : 's'}
              </Subtle>
            </div>
            <p className="text-[11px] text-fg-subtle mt-2 mb-0">
              Assets minus liabilities, from the balances below. Attach the
              <span className="mono"> finance.net_worth </span>
              collector to a metric to track this over time.
            </p>
          </Card>

          <Card title="Accounts">
            <ul className="list-none p-0 m-0 divide-y divide-line">
              {rows.map((account) => (
                <li key={account.id} className="flex items-center justify-between py-2">
                  <button
                    className="text-left flex-1"
                    onClick={() => setSelected(account.id)}
                  >
                    <span className={active === account.id ? 'font-medium' : ''}>
                      {account.name}
                    </span>
                    <span className="text-fg-subtle text-[11px] ml-2">{account.kind}</span>
                    {account.isLiability && (
                      <span className="text-at-risk text-[11px] ml-2">liability</span>
                    )}
                  </button>
                  <span
                    className={`mono tabular-nums text-[13px] ${
                      account.isLiability ? 'text-at-risk' : ''
                    }`}
                  >
                    {money(account.balanceMinor, account.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="Transactions"
            action={
              <Button variant="ghost" onClick={() => setAddingTxn(true)}>
                Record
              </Button>
            }
          >
            {transactions.isPending && <Skeleton className="h-20 w-full" />}
            {(transactions.data?.items ?? []).length === 0 ? (
              <Empty
                title="No transactions"
                hint="Import a bank CSV, or record one by hand. Collectors turn these into revenue, expenses, and savings-rate metrics."
              />
            ) : (
              <ul className="list-none p-0 m-0 divide-y divide-line">
                {(transactions.data?.items ?? []).slice(0, 50).map((txn) => (
                  <li key={txn.id} className="flex items-center gap-3 py-2 text-[13px]">
                    <span className="mono text-fg-subtle w-[86px] shrink-0">
                      {formatDate(txn.occurredAt)}
                    </span>
                    <span className="flex-1 truncate">{txn.description ?? '—'}</span>
                    <span
                      className={`mono tabular-nums ${
                        txn.direction === 'in' ? 'text-ahead' : 'text-fg-muted'
                      }`}
                    >
                      {txn.direction === 'in' ? '+' : '−'}
                      {money(txn.amountMinor, txn.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {addingAccount && <NewAccountDialog onClose={() => setAddingAccount(false)} />}
      {addingTxn && active && (
        <NewTransactionDialog accountId={active} onClose={() => setAddingTxn(false)} />
      )}
      {importing && active && (
        <ImportDialog accountId={active} onClose={() => setImporting(false)} />
      )}
    </div>
  );
}

function NewAccountDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('bank');
  const [balance, setBalance] = useState('');
  const [isLiability, setLiability] = useState(false);

  const create = useApiMutation(
    (input: Parameters<typeof trpc.accounts.create.mutate>[0]) =>
      trpc.accounts.create.mutate(input),
    { invalidates: [keys.accounts], onSuccess: onClose },
  );

  return (
    <Dialog title="New account" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            name,
            kind,
            currency: 'INR',
            // Rupees in the field, minor units in storage. The conversion
            // happens once, here, at the edge.
            balanceMinor: Math.round(Number(balance || '0') * 100),
            isLiability,
            isLiquid: kind === 'bank' || kind === 'cash',
          });
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>

        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="bank">Bank</option>
            <option value="investment">Investment / SIP</option>
            <option value="cash">Cash</option>
            <option value="credit_card">Credit card</option>
            <option value="loan">Loan</option>
          </Select>
        </Field>

        <Field label="Current balance" hint="In rupees. Stored as integer paise.">
          <Input
            type="number"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </Field>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={isLiability}
            onChange={(e) => setLiability(e.target.checked)}
          />
          This is a liability — it subtracts from net worth
        </label>

        {create.isError && <ErrorNote error={create.error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create account'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function NewTransactionDialog({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [when, setWhen] = useState(dateInput(Date.now()));
  const [description, setDescription] = useState('');

  const create = useApiMutation(
    (input: Parameters<typeof trpc.transactions.create.mutate>[0]) =>
      trpc.transactions.create.mutate(input),
    { invalidates: [keys.transactions, keys.accounts], onSuccess: onClose },
  );

  return (
    <Dialog title="Record transaction" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            accountId,
            amountMinor: Math.round(Number(amount) * 100),
            currency: 'INR',
            direction,
            occurredAt: fromDateInput(when),
            ...(description ? { description } : {}),
          });
        }}
      >
        <Field label="Amount">
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoFocus
          />
        </Field>

        <Field label="Direction">
          <Select
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
          >
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </Select>
        </Field>

        <Field label="Date">
          <Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </Field>

        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        {create.isError && <ErrorNote error={create.error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Record'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
