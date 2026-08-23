import { useState } from 'react';
import { Button, Dialog, Empty, ErrorNote, Field, Input, Select, Skeleton, Subtle, Textarea } from '../../components/ui.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { date, dateInput, fromDateInput, metricValue, relativeDays } from '../../lib/format.js';
import { MetricSettings } from './metric-settings.tsx';
import { BackfillCard } from './backfill-card.tsx';

export function MetricsPage() {
  const [creating, setCreating] = useState(false);
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);

  const metrics = useApi(keys.metrics, () => trpc.metrics.list.query({ limit: 200 }));
  const stale = useApi(keys.needingData, () => trpc.readings.needingData.query({}));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold m-0">Metrics</h1>
          <Subtle>The things you actually measure</Subtle>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New metric
        </Button>
      </header>

      {/* The most useful nag in the system is not "you have tasks" — it is
          "you stopped measuring the thing you said mattered" (docs/03 §6). */}
      {(stale.data ?? []).length > 0 && (
        <div className="border border-at-risk/40 bg-at-risk/5 rounded-card p-4">
          <h2 className="text-[11px] uppercase tracking-[0.08em] text-at-risk m-0 mb-2">
            Needs data
          </h2>
          <ul className="list-none p-0 m-0 space-y-1">
            {(stale.data ?? []).map((metric) => (
              <li key={metric.id} className="flex justify-between text-[13px]">
                <span>{metric.name}</span>
                <span className="text-fg-subtle mono">
                  {metric.daysSince === null
                    ? 'never recorded'
                    : relativeDays(metric.daysSince)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {metrics.isPending && <Skeleton className="h-24 w-full" />}
      {metrics.isError && <ErrorNote error={metrics.error} />}
      {metrics.data?.items.length === 0 && (
        <Empty
          title="No metrics yet"
          hint="A metric is a measurable quantity with a direction and, usually, a target."
        />
      )}

      <div className="grid gap-2">
        {(metrics.data?.items ?? []).map((metric) => (
          <div
            key={metric.id}
            className="bg-surface border border-line rounded-card p-4 flex items-center gap-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{metric.name}</span>
                <code className="text-[11px] text-fg-subtle">{metric.key}</code>
                {!metric.bounded && (
                  <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                    unbounded
                  </span>
                )}
                {metric.collectorKey !== null && (
                  <span className="text-[10px] mono text-accent" title="fed by a collector">
                    ⟲ {metric.collectorKey}
                  </span>
                )}
                {(metric.components?.length ?? 0) > 0 && (
                  <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                    {metric.components?.length} parts
                  </span>
                )}
              </div>
              <div className="text-[12px] text-fg-subtle mt-0.5">
                {metric.direction} · {metric.cadence}
                {metric.target !== null && (
                  <> · target {metricValue(metric.target, metric.unit)}</>
                )}
              </div>
            </div>

            <div className="text-right">
              <div className="mono text-[16px]">
                {metric.lastValue === null
                  ? '—'
                  : metricValue(metric.lastValue, metric.unit)}
              </div>
              <div className="text-[11px] text-fg-subtle">
                {metric.lastReadingAt === null ? 'no readings' : date(metric.lastReadingAt)}
              </div>
            </div>

            <Button variant="ghost" onClick={() => setConfiguring(metric.id)}>
              Configure
            </Button>
            <Button onClick={() => setRecordingFor(metric.id)}>Record</Button>
          </div>
        ))}
      </div>

      <BackfillCard />

      {creating && <NewMetricDialog onClose={() => setCreating(false)} />}
      {configuring && (
        <MetricSettings
          metric={(metrics.data?.items ?? []).find((m) => m.id === configuring)!}
          onClose={() => setConfiguring(null)}
        />
      )}
      {recordingFor && (
        <RecordReadingDialog
          metric={(metrics.data?.items ?? []).find((m) => m.id === recordingFor)!}
          onClose={() => setRecordingFor(null)}
        />
      )}
    </div>
  );
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);

function NewMetricDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [unit, setUnit] = useState('count');
  const [direction, setDirection] = useState<'increase' | 'decrease' | 'maintain'>('increase');
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly'>('monthly');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');
  const [bounded, setBounded] = useState(true);
  const [history, setHistory] = useState('');

  const create = useApiMutation(
    async (input: { history: Array<{ at: number; value: number }> }) => {
      const metric = await trpc.metrics.create.mutate({
        key: key || slug(name),
        name,
        unit: unit as 'count',
        direction,
        cadence,
        source: 'manual',
        bounded,
        ...(baseline !== '' ? { baseline: Number(baseline) } : {}),
        ...(target !== '' && bounded ? { target: Number(target) } : {}),
      });

      // docs/12 — backfill is a Phase 1 feature, not a nicety. Trajectory needs
      // history and a new system has none, so the form accepts it up front.
      for (const point of input.history) {
        await trpc.readings.record.mutate({
          metricId: metric.id,
          at: point.at,
          value: point.value,
        });
      }
      return metric;
    },
    { invalidates: [keys.metrics, keys.needingData], onSuccess: onClose },
  );

  const parsedHistory = parseHistory(history);

  return (
    <Dialog title="New metric" onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ history: parsedHistory.points });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (key === '' || key === slug(name)) setKey(slug(e.target.value));
              }}
              placeholder="Monthly revenue"
            />
          </Field>
          <Field label="Key" hint="Immutable. Used by expressions and quick capture.">
            <Input value={key} onChange={(e) => setKey(slug(e.target.value))} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Unit">
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {['count', 'currency', 'percent', 'duration', 'score', 'ratio', 'weight'].map(
                (option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <Field label="Direction">
            <Select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'increase')}
            >
              <option value="increase">increase</option>
              <option value="decrease">decrease</option>
              <option value="maintain">maintain</option>
            </Select>
          </Field>
          <Field label="Cadence">
            <Select value={cadence} onChange={(e) => setCadence(e.target.value as 'monthly')}>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="quarterly">quarterly</option>
            </Select>
          </Field>
        </div>

        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={!bounded}
            onChange={(e) => setBounded(!e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            No meaningful target
            <span className="block text-[11px] text-fg-subtle">
              Counts like "projects shipped" never finish. These can only be rate
              contributors on a momentum goal.
            </span>
          </span>
        </label>

        {bounded && (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Baseline"
              hint="Where progress is measured from. Blank uses your first reading — never zero."
            >
              <Input
                type="number"
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
              />
            </Field>
            <Field label="Target">
              <Input
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </Field>
          </div>
        )}

        <Field
          label="History (optional)"
          hint="One per line: YYYY-MM-DD value. Trajectory needs history, and a new metric has none."
          {...(parsedHistory.error ? { error: parsedHistory.error } : {})}
        >
          <Textarea
            value={history}
            onChange={(e) => setHistory(e.target.value)}
            rows={5}
            placeholder={'2026-03-01 120000\n2026-04-01 135000'}
          />
        </Field>

        {parsedHistory.points.length > 0 && (
          <Subtle>
            {parsedHistory.points.length} readings will be backfilled, from{' '}
            {date(parsedHistory.points[0]!.at)}
          </Subtle>
        )}

        {create.isError && <ErrorNote error={create.error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={
              create.isPending ||
              name.trim() === '' ||
              key === '' ||
              parsedHistory.error !== null
            }
          >
            {create.isPending ? 'Creating…' : 'Create metric'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function parseHistory(raw: string): {
  points: Array<{ at: number; value: number }>;
  error: string | null;
} {
  const points: Array<{ at: number; value: number }> = [];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const [index, line] of lines.entries()) {
    const match = /^(\d{4}-\d{2}-\d{2})\s+(-?[\d,._]+)$/.exec(line);
    if (!match) {
      return { points: [], error: `Line ${index + 1}: expected "YYYY-MM-DD value"` };
    }
    const at = fromDateInput(match[1] as string);
    const value = Number((match[2] as string).replace(/[,_]/g, ''));
    if (!Number.isFinite(at) || !Number.isFinite(value)) {
      return { points: [], error: `Line ${index + 1}: could not read that date or value` };
    }
    points.push({ at, value });
  }

  points.sort((a, b) => a.at - b.at);
  return { points, error: null };
}

function RecordReadingDialog({
  metric,
  onClose,
}: {
  metric: {
    id: string;
    name: string;
    unit: string;
    components?: Array<{ key: string; label: string; controllable: boolean }> | null;
  };
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [when, setWhen] = useState(dateInput(Date.now()));
  const [note, setNote] = useState('');
  const components = metric.components ?? [];
  // The engine refuses a whole-metric reading once a metric is decomposed, so
  // offering "Whole metric" would be offering something that cannot be saved.
  const [component, setComponent] = useState(components[0]?.key ?? '');

  const record = useApiMutation(
    () =>
      trpc.readings.record.mutate({
        metricId: metric.id,
        at: fromDateInput(when),
        value: Number(value),
        ...(component ? { component } : {}),
        ...(note ? { note } : {}),
      }),
    {
      invalidates: [keys.metrics, keys.needingData, keys.goals],
      onSuccess: onClose,
    },
  );

  return (
    <Dialog title={`Record — ${metric.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          record.mutate(undefined as never);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Value">
            <Input
              autoFocus
              type="number"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Field label="Date">
            <Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        </div>

        {/* A decomposed metric is fed per part, which is what lets the
            trajectory separate durable growth from borrowed (docs/03 §11). */}
        {components.length > 0 && (
          <Field
            label="Component"
            hint="Which part moved. A decomposed metric is only ever fed per part, and that split is what separates durable growth from borrowed."
          >
            <Select
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              aria-label="Component"
              required
            >
              {components.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} {c.controllable ? '· durable' : '· market-dependent'}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Note" hint="Optional context for this reading">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {record.isError && <ErrorNote error={record.error} />}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={record.isPending || value === ''}
          >
            Record
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
