import { useState } from 'react';
import {
  Button,
  Dialog,
  ErrorNote,
  Field,
  Input,
  Select,
  Subtle,
} from '../../components/ui.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { metricValue, pct } from '../../lib/format.js';

type Metric = Awaited<ReturnType<typeof trpc.metrics.list.query>>['items'][number];

/**
 * docs/15 §0 — a metric's collector and its component decomposition were both
 * settable at creation only, and neither had a form field. That made every
 * computed metric and the whole contributions-vs-returns split unreachable
 * without editing the database by hand.
 */
export function MetricSettings({
  metric,
  onClose,
}: {
  metric: Metric;
  onClose: () => void;
}) {
  const collectors = useApi(['collectors'], () => trpc.collectors.list.query());

  const update = useApiMutation(
    (input: Parameters<typeof trpc.metrics.update.mutate>[0]) =>
      trpc.metrics.update.mutate(input),
    { invalidates: [keys.metrics, keys.needingData] },
  );

  const [components, setComponents] = useState(metric.components ?? []);
  const dirty =
    JSON.stringify(components) !== JSON.stringify(metric.components ?? []);

  const compatible = (collectors.data ?? []).filter((c) => c.unit === metric.unit);

  return (
    <Dialog title={metric.name} onClose={onClose}>
      <div className="space-y-5">
        <Preview metric={metric} />

        <Field
          label="Collector"
          hint="A collector derives this metric from data already in the system, and can rebuild history from it."
        >
          <Select
            value={metric.collectorKey ?? ''}
            onChange={(e) =>
              update.mutate({
                id: metric.id,
                expectedVersion: metric.version,
                patch: {
                  collectorKey: e.target.value === '' ? null : e.target.value,
                  source: e.target.value === '' ? ('manual' as const) : ('computed' as const),
                },
              })
            }
          >
            <option value="">Manual — readings are entered by hand</option>
            {compatible.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name} ({c.key}) · {c.cadence}
              </option>
            ))}
          </Select>
        </Field>

        {compatible.length === 0 && collectors.isSuccess && (
          <Subtle>
            No collector produces {metric.unit} values. Collectors are matched by unit so
            a currency metric cannot silently be fed a count.
          </Subtle>
        )}

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle">
              Components
            </span>
            <Button
              variant="ghost"
              onClick={() =>
                setComponents((prev) => [
                  ...prev,
                  { key: `part_${prev.length + 1}`, label: '', controllable: true },
                ])
              }
            >
              Add
            </Button>
          </div>

          {/* docs/03 §11 — a corpus that grows from contributions is durable;
              one that grows from returns is borrowed. A system that cannot tell
              them apart reports a great trajectory in a rising market. */}
          <Subtle>
            Split this metric into parts so the trajectory can say how much growth was
            yours and how much was the market&rsquo;s.
          </Subtle>

          {components.length > 0 && (
            <ul className="list-none p-0 m-0 space-y-2 mt-3">
              {components.map((component, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Input
                    className="w-[110px]"
                    value={component.key}
                    placeholder="key"
                    onChange={(e) =>
                      setComponents((prev) =>
                        prev.map((c, j) => (j === i ? { ...c, key: e.target.value } : c)),
                      )
                    }
                  />
                  <Input
                    className="flex-1"
                    value={component.label}
                    placeholder="Label"
                    onChange={(e) =>
                      setComponents((prev) =>
                        prev.map((c, j) => (j === i ? { ...c, label: e.target.value } : c)),
                      )
                    }
                  />
                  <label className="flex items-center gap-1 text-[11px] whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={component.controllable}
                      onChange={(e) =>
                        setComponents((prev) =>
                          prev.map((c, j) =>
                            j === i ? { ...c, controllable: e.target.checked } : c,
                          ),
                        )
                      }
                    />
                    I control this
                  </label>
                  <button
                    className="text-fg-subtle hover:text-at-risk px-1"
                    onClick={() => setComponents((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove ${component.key}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {dirty && (
            <Button
              className="mt-3"
              onClick={() =>
                update.mutate({
                  id: metric.id,
                  expectedVersion: metric.version,
                  patch: { components: components.length === 0 ? null : components },
                })
              }
              disabled={update.isPending || components.some((c) => c.label.trim() === '')}
            >
              {update.isPending ? 'Saving…' : 'Save components'}
            </Button>
          )}
        </div>

        {update.isError && <ErrorNote error={update.error} />}
      </div>
    </Dialog>
  );
}

/**
 * The API has had `metrics.preview` since M5 and nothing used it, so the
 * baseline/target fields gave no sense of what they would produce. This shows
 * the engine's own answer — including its refusal.
 */
function Preview({ metric }: { metric: Metric }) {
  const [value, setValue] = useState(String(metric.lastValue ?? metric.baseline ?? 0));

  const preview = useApi(
    ['metrics', 'preview', metric.id, value],
    () =>
      trpc.metrics.preview.query({
        direction: metric.direction,
        current: Number(value),
        ...(metric.baseline === null ? {} : { baseline: metric.baseline }),
        ...(metric.target === null ? {} : { target: metric.target }),
        ...(metric.tolerance === null ? {} : { tolerance: metric.tolerance }),
        label: metric.name,
      }),
    { retry: false, enabled: value !== '' && Number.isFinite(Number(value)) },
  );

  return (
    <div className="border border-line rounded-card p-3">
      <div className="flex items-end gap-3">
        <Field label="If the value were">
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-[140px]"
          />
        </Field>
        <div className="pb-1">
          {preview.isSuccess ? (
            <>
              <div className="mono text-[20px] tabular-nums">
                {pct(preview.data.value)}
              </div>
              <Subtle>{preview.data.method}</Subtle>
            </>
          ) : preview.isError ? (
            // The refusal is the useful answer here: it names the missing
            // baseline or target rather than showing a plausible number.
            <div className="text-[12px] text-at-risk max-w-[280px]">
              ◆ {preview.error.message}
            </div>
          ) : (
            <Subtle>…</Subtle>
          )}
        </div>
      </div>

      <p className="text-[11px] text-fg-subtle mt-2 mb-0">
        baseline {metric.baseline ?? '—'} → target{' '}
        {metric.target === null ? '—' : metricValue(metric.target, metric.unit)}
      </p>
    </div>
  );
}
