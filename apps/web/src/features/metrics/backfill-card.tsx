import { useState } from 'react';
import { Button, Card, ErrorNote, Select, Subtle } from '../../components/ui.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';

/**
 * docs/12 — the day-one problem. A new system has no history, and a trajectory
 * needs one: the honesty gates refuse to project from fewer than five points,
 * so a fresh install can say nothing useful for a week.
 *
 * Backfill is the honest way out. Collectors are pure `(period, data)`
 * functions, so running one over past months computes what the metric *was*
 * from records that already existed — which is derivation, not invention.
 *
 * This is deliberately different from backfilling *snapshots*, which is
 * forbidden (docs/03 §7): a snapshot records what the system knew on a day,
 * and that cannot be reconstructed. A collector reading recomputes a value
 * from source records that carry their own dates.
 */
export function BackfillCard() {
  const [months, setMonths] = useState('12');
  const collectors = useApi(keys.collectors, () => trpc.collectors.list.query());

  const backfill = useApiMutation(
    (input: { months: number }) => trpc.collectors.backfill.mutate(input),
    { invalidates: [keys.metrics, keys.needingData, keys.goals] },
  );

  const available = collectors.data ?? [];

  return (
    <Card title="Collectors">
      <Subtle>
        Collectors derive a metric from data already in the system. Attach one to a
        metric from its Configure panel, then rebuild history here.
      </Subtle>

      {available.length > 0 && (
        <ul className="list-none p-0 m-0 mt-3 grid gap-1 sm:grid-cols-2">
          {available.map((collector) => (
            <li key={collector.key} className="flex justify-between text-[12px]">
              <span>
                <code className="text-fg-subtle">{collector.key}</code>
                <span className="ml-2">{collector.name}</span>
              </span>
              <span className="text-fg-subtle">{collector.cadence}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-line">
        <Select
          value={months}
          onChange={(e) => setMonths(e.target.value)}
          className="w-36"
          aria-label="Backfill window"
        >
          <option value="3">Last 3 months</option>
          <option value="6">Last 6 months</option>
          <option value="12">Last 12 months</option>
          <option value="24">Last 24 months</option>
        </Select>

        <Button
          onClick={() => backfill.mutate({ months: Number(months) })}
          disabled={backfill.isPending}
        >
          {backfill.isPending ? 'Rebuilding…' : 'Rebuild history'}
        </Button>

        {backfill.isSuccess && (
          <span className="text-[12px] text-fg-muted">
            {summarise(backfill.data)}
          </span>
        )}
      </div>

      {backfill.isError && <ErrorNote error={backfill.error} />}

      <p className="text-[11px] text-fg-subtle mt-3 mb-0">
        Safe to re-run: readings dedupe on metric, date, source and component, so a
        second pass updates rather than doubles. This rebuilds{' '}
        <em>readings</em> from source records — it never writes past snapshots, which
        would be inventing history the system did not have.
      </p>
    </Card>
  );
}

function summarise(result: unknown): string {
  if (result === null || typeof result !== 'object') return 'done';
  const record = result as Record<string, unknown>;
  const written = record['written'] ?? record['readings'] ?? record['count'];
  return typeof written === 'number' ? `${written} readings written` : 'done';
}
