import { useState } from 'react';
import { Button, Card, Empty, ErrorNote, Input, Select, Skeleton, Subtle } from '../../components/ui.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';

/**
 * Areas and themes — the user's own top-level structure (docs/02 §1). Themes are
 * named strands of intent rather than calendar buckets, which is why nothing
 * here asks for a quarter.
 */

const SWATCHES = [
  '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#7c6bff',
  '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#c084fc',
  '#2dd4bf', '#94a3b8',
];

export function StructurePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold m-0">Structure</h1>
        <Subtle>Areas of your life, and the themes running through them</Subtle>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <Areas />
        <Themes />
      </div>
    </div>
  );
}

function Areas() {
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0] as string);
  const areas = useApi(keys.areas, () => trpc.areas.list.query({ limit: 100 }));

  const create = useApiMutation(
    () => trpc.areas.create.mutate({ name, color, sortOrder: areas.data?.items.length ?? 0 }),
    { invalidates: [keys.areas], onSuccess: () => setName('') },
  );

  const setShare = useApiMutation(
    (input: { id: string; targetShare: number | null }) =>
      trpc.areas.update.mutate({ id: input.id, patch: { targetShare: input.targetShare } }),
    { invalidates: [keys.areas] },
  );

  return (
    <Card title="Areas">
      {areas.isPending && <Skeleton className="h-16 w-full" />}
      {areas.data?.items.length === 0 && (
        <Empty title="No areas yet" hint="Business, Career, Finance, Health — whatever you actually think in." />
      )}

      <ul className="list-none p-0 m-0 space-y-2">
        {(areas.data?.items ?? []).map((area) => (
          <li key={area.id} className="flex items-center gap-3">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: area.color }}
              aria-hidden
            />
            <span className="flex-1">{area.name}</span>
            {/* Intended attention share feeds the allocation analysis in docs/04 §4. */}
            <label className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
              target
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={area.targetShare === null ? '' : Math.round(area.targetShare * 100)}
                onChange={(e) =>
                  setShare.mutate({
                    id: area.id,
                    targetShare: e.target.value === '' ? null : Number(e.target.value) / 100,
                  })
                }
                className="field-input w-16 py-0.5 text-right mono"
                aria-label={`Target attention share for ${area.name}`}
              />
              %
            </label>
          </li>
        ))}
      </ul>

      <form
        className="mt-4 pt-3 border-t border-line space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(undefined as never);
        }}
      >
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New area…" />
          <Button type="submit" disabled={name.trim() === ''}>Add</Button>
        </div>
        <div className="flex gap-1.5">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              aria-label={`Colour ${swatch}`}
              className="w-5 h-5 rounded-full border transition-transform"
              style={{
                background: swatch,
                borderColor: color === swatch ? 'var(--text-primary)' : 'transparent',
                transform: color === swatch ? 'scale(1.15)' : 'none',
              }}
            />
          ))}
        </div>
        {create.isError && <ErrorNote error={create.error} />}
      </form>
    </Card>
  );
}

function Themes() {
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState('');
  const areas = useApi(keys.areas, () => trpc.areas.list.query({ limit: 100 }));
  const themes = useApi(keys.themes, () => trpc.themes.list.query({ limit: 100 }));

  const create = useApiMutation(
    () => trpc.themes.create.mutate({ areaId: areaId || (areas.data?.items[0]?.id ?? ''), name }),
    { invalidates: [keys.themes], onSuccess: () => setName('') },
  );

  const areaName = (id: string): string =>
    (areas.data?.items ?? []).find((a) => a.id === id)?.name ?? '';

  return (
    <Card title="Themes">
      {themes.data?.items.length === 0 && (
        <Empty
          title="No themes yet"
          hint="A theme is a strand of intent — 'Build Samarth into a stronger recurring business'. It needs no deadline."
        />
      )}

      <ul className="list-none p-0 m-0 space-y-2">
        {(themes.data?.items ?? []).map((theme) => (
          <li key={theme.id}>
            <div className="flex items-baseline gap-2">
              <span>{theme.name}</span>
              <Subtle>{areaName(theme.areaId)}</Subtle>
            </div>
            {theme.why && <p className="text-[12px] text-fg-subtle m-0">{theme.why}</p>}
          </li>
        ))}
      </ul>

      <form
        className="mt-4 pt-3 border-t border-line flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(undefined as never);
        }}
      >
        <Select
          value={areaId}
          onChange={(e) => setAreaId(e.target.value)}
          className="w-32"
          aria-label="Area"
        >
          {(areas.data?.items ?? []).map((area) => (
            <option key={area.id} value={area.id}>{area.name}</option>
          ))}
        </Select>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New theme…" />
        <Button type="submit" disabled={name.trim() === '' || (areas.data?.items.length ?? 0) === 0}>
          Add
        </Button>
      </form>
      {create.isError && <ErrorNote error={create.error} />}
    </Card>
  );
}
