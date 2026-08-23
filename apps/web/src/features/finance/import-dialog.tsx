import { useState } from 'react';
import { Button, Dialog, ErrorNote, Field, Subtle, Textarea } from '../../components/ui.tsx';
import { keys, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { date as formatDate, money } from '../../lib/format.js';

type ImportResult = Awaited<ReturnType<typeof trpc.transactions.importCsv.mutate>>;
/** Only the dry-run branch carries a header mapping to show. */
type Preview = Extract<ImportResult, { mapping: Record<string, string | null> }>;

/**
 * Import always previews before it writes.
 *
 * A bank export is the one input where a silent misparse is both likely and
 * invisible afterwards — a decimal read wrong turns ₹45,000 into ₹45 and
 * nothing downstream looks broken. So the header mapping and the first rows
 * are shown, and the write is a second, deliberate action.
 */
export function ImportDialog({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);

  const dryRun = useApiMutation(
    (input: { accountId: string; csv: string; dryRun: boolean }) =>
      trpc.transactions.importCsv.mutate(input),
    {
      onSuccess: (result) =>
        setPreview('mapping' in result ? (result as Preview) : null),
    },
  );

  const commit = useApiMutation(
    (input: { accountId: string; csv: string; dryRun: boolean }) =>
      trpc.transactions.importCsv.mutate(input),
    { invalidates: [keys.transactions, keys.accounts], onSuccess: onClose },
  );

  return (
    <Dialog title="Import transactions" onClose={onClose}>
      <div className="space-y-3">
        <Field
          label="CSV"
          hint="Paste a bank export. Column names are matched automatically — date, amount or debit/credit, and description."
        >
          <Textarea
            rows={7}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
            }}
            placeholder={'Date,Narration,Withdrawal Amount,Deposit Amount\n01/03/2026,Client payment,,120000'}
            autoFocus
          />
        </Field>

        {dryRun.isError && <ErrorNote error={dryRun.error} />}
        {commit.isError && <ErrorNote error={commit.error} />}

        {preview && (
          <div className="border border-line rounded-card p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle">
                Mapping
              </span>
              <Subtle>
                {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'} shown
              </Subtle>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] m-0">
              {Object.entries(preview.mapping).map(([field, header]) => (
                <div key={field} className="flex justify-between">
                  <dt className="text-fg-subtle">{field}</dt>
                  <dd className="mono m-0">{header ?? '—'}</dd>
                </div>
              ))}
            </dl>

            {preview.rows.length > 0 && (
              <ul className="list-none p-0 m-0 divide-y divide-line text-[12px]">
                {preview.rows.map((row, i) => (
                  <li key={i} className="flex items-center gap-2 py-1">
                    <span className="mono text-fg-subtle w-[80px] shrink-0">
                      {formatDate(row.occurredAt)}
                    </span>
                    <span className="flex-1 truncate">{row.description ?? '—'}</span>
                    <span
                      className={`mono ${row.direction === 'in' ? 'text-ahead' : 'text-fg-muted'}`}
                    >
                      {row.direction === 'in' ? '+' : '−'}
                      {money(row.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Rows that could not be read are named, never dropped quietly. */}
            {preview.errors.length > 0 && (
              <ul className="list-none p-0 m-0 space-y-1">
                {preview.errors.slice(0, 5).map((err) => (
                  <li key={err.line} className="text-[11px] text-at-risk">
                    ◆ line {err.line}: {err.reason}
                  </li>
                ))}
                {preview.errors.length > 5 && (
                  <li className="text-[11px] text-fg-subtle">
                    …and {preview.errors.length - 5} more
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {preview === null ? (
            <Button
              onClick={() => dryRun.mutate({ accountId, csv, dryRun: true })}
              disabled={csv.trim() === '' || dryRun.isPending}
            >
              {dryRun.isPending ? 'Reading…' : 'Preview'}
            </Button>
          ) : (
            <Button
              onClick={() => commit.mutate({ accountId, csv, dryRun: false })}
              disabled={commit.isPending || preview.rows.length === 0}
            >
              {commit.isPending ? 'Importing…' : 'Import'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
