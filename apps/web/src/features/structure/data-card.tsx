import { useState } from 'react';
import { Button, Card, ErrorNote, Subtle } from '../../components/ui.tsx';
import { useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { date } from '../../lib/format.js';

/**
 * docs/27 — you must be able to take your data and leave.
 *
 * An export button that works is the difference between owning your data and
 * being told you do.
 */
export function DataCard() {
  const [note, setNote] = useState<string | null>(null);

  const backups = useApi(['backups'], () => trpc.data.backups.list.query());

  const takeBackup = useApiMutation(() => trpc.data.backups.create.mutate(), {
    invalidates: [['backups']],
    onSuccess: (result) => setNote(`Snapshot written — ${formatBytes(result.bytes)}`),
  });

  const [exporting, setExporting] = useState(false);

  const download = async (): Promise<void> => {
    setExporting(true);
    setNote(null);
    try {
      const payload = await trpc.data.export.query();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `aryesh-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);

      const rows = Object.values(payload.manifest.counts).reduce((a, b) => a + b, 0);
      setNote(`Exported ${rows} rows across ${Object.keys(payload.manifest.counts).length} tables`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card title="Your data">
      <p className="text-[13px] text-fg-muted m-0 mb-3">
        Everything lives in one file on this machine. Nothing is uploaded anywhere.
      </p>

      <div className="flex gap-2">
        <Button onClick={() => void download()} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export as JSON'}
        </Button>
        <Button onClick={() => takeBackup.mutate(undefined as never)} disabled={takeBackup.isPending}>
          {takeBackup.isPending ? 'Backing up…' : 'Take a snapshot'}
        </Button>
      </div>

      {note && (
        <p className="text-[12px] text-on-track mt-3 mb-0">● {note}</p>
      )}
      {takeBackup.isError && (
        <div className="mt-3">
          <ErrorNote error={takeBackup.error} />
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-line">
        <Subtle>
          {(backups.data ?? []).length === 0
            ? 'No snapshots yet. One is taken automatically each day.'
            : `${(backups.data ?? []).length} snapshots kept — hourly today, daily for a fortnight, weekly beyond.`}
        </Subtle>
        {(backups.data ?? []).slice(0, 3).length > 0 && (
          <ul className="list-none p-0 m-0 mt-2 space-y-1">
            {(backups.data ?? []).slice(0, 3).map((backup) => (
              <li key={backup.path} className="flex justify-between text-[12px]">
                <span className="text-fg-muted">{date(backup.createdAt)}</span>
                <span className="mono text-fg-subtle">{formatBytes(backup.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Import is deliberately not here. It replaces everything, and a button
          next to "Export" is too easy to hit by accident — it belongs behind a
          deliberate restore flow, which is Phase 2 work. */}
    </Card>
  );
}

const formatBytes = (bytes: number): string =>
  bytes > 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
