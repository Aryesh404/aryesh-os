import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keys, useApi } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { Subtle } from '../../components/ui.tsx';
import type { Route } from '../../app.js';

/**
 * docs/07 §5 — the universal entry point.
 *
 * Quick capture is the part that matters: capture friction is what kills a
 * measurement habit, and measurement is the whole spine. Typing
 * `revenue 142000` records a reading without navigating anywhere.
 */

type Item = {
  id: string;
  label: string;
  hint?: string;
  kind: string;
  run: () => void | Promise<void>;
};

/** `<metric key> <number>` — the fastest path from noticing to recorded. */
function parseCapture(input: string): { key: string; value: number } | null {
  const match = /^([a-z][a-z0-9_]*)\s+(-?[\d,._]+)$/i.exec(input.trim());
  if (!match) return null;
  const value = Number(match[2]?.replace(/[,_]/g, ''));
  if (!Number.isFinite(value)) return null;
  return { key: (match[1] as string).toLowerCase(), value };
}

export function CommandPalette({
  onClose,
  navigate,
}: {
  onClose: () => void;
  navigate: (route: Route) => void;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const metrics = useApi(keys.metrics, () => trpc.metrics.list.query({ limit: 200 }));
  const search = useApi(
    ['search', query],
    () => trpc.search.query.query({ q: query, limit: 8 }),
    { enabled: query.trim().length >= 2 },
  );

  const capture = useMemo(() => parseCapture(query), [query]);
  const captureMetric = useMemo(
    () =>
      capture
        ? (metrics.data?.items ?? []).find((m) => m.key === capture.key)
        : undefined,
    [capture, metrics.data],
  );

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];

    if (capture && captureMetric) {
      list.push({
        id: 'capture',
        kind: 'record',
        label: `Record ${captureMetric.name} = ${capture.value}`,
        hint: 'Enter to save',
        run: async () => {
          await trpc.readings.record.mutate({
            metricId: captureMetric.id,
            at: Date.now(),
            value: capture.value,
          });
          await client.invalidateQueries();
          setNote(`Recorded ${captureMetric.name} = ${capture.value}`);
          setQuery('');
        },
      });
    } else if (capture && !captureMetric && metrics.isSuccess) {
      list.push({
        id: 'capture-missing',
        kind: 'record',
        label: `No metric with key '${capture.key}'`,
        hint: 'Create it under Metrics first',
        run: () => navigate({ name: 'metrics' }),
      });
    }

    for (const hit of search.data ?? []) {
      list.push({
        id: `${hit.kind}:${hit.id}`,
        kind: hit.kind,
        label: hit.title,
        hint: hit.snippet.replace(/[[\]]/g, ''),
        run: () => {
          if (hit.kind === 'goal') navigate({ name: 'goal', id: hit.id });
          else if (hit.kind === 'metric') navigate({ name: 'metrics' });
          else navigate({ name: 'work' });
          onClose();
        },
      });
    }

    const destinations: Array<[string, Route]> = [
      ['Goals', { name: 'goals' }],
      ['Metrics', { name: 'metrics' }],
      ['Work', { name: 'work' }],
      ['Structure', { name: 'structure' }],
    ];
    for (const [label, route] of destinations) {
      if (query === '' || label.toLowerCase().includes(query.toLowerCase())) {
        list.push({
          id: `go:${label}`,
          kind: 'go to',
          label,
          run: () => {
            navigate(route);
            onClose();
          },
        });
      }
    }

    return list;
  }, [capture, captureMetric, metrics.isSuccess, search.data, query, navigate, onClose, client]);

  useEffect(() => setCursor(0), [query]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') return onClose();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void items[cursor]?.run();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 p-4 pt-[12vh] flex justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-raised border border-line-strong rounded-panel overflow-hidden h-fit">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search, or type a metric key and a value…"
          aria-label="Command palette"
          className="w-full bg-transparent border-0 border-b border-line px-4 py-3 text-[14px] outline-none"
        />

        {note && (
          <div className="px-4 py-2 text-[12px] text-on-track border-b border-line">
            ● {note}
          </div>
        )}

        <ul className="list-none m-0 p-1 max-h-80 overflow-y-auto">
          {items.length === 0 && (
            <li className="px-3 py-6 text-center">
              <Subtle>
                {query.trim().length >= 2 ? 'Nothing found' : 'Start typing'}
              </Subtle>
            </li>
          )}
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                onMouseEnter={() => setCursor(index)}
                onClick={() => void item.run()}
                className={`w-full text-left px-3 py-2 rounded-control flex items-baseline gap-3 ${
                  index === cursor ? 'bg-surface' : ''
                }`}
              >
                <span className="text-[10px] uppercase tracking-wider text-fg-subtle w-16 shrink-0">
                  {item.kind}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && (
                  <span className="text-[11px] text-fg-subtle truncate max-w-[45%]">
                    {item.hint}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
