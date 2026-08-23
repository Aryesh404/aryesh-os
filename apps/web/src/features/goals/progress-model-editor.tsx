import { useMemo, useState } from 'react';
import { Card, Empty, ErrorNote, Input, Select, Subtle } from '../../components/ui.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { pct } from '../../lib/format.js';

/**
 * docs/03 §4 — pick contributors, set weights, watch the number move.
 *
 * The displayed figure always comes back from the engine. Recomputing locally
 * for snappier feedback would mean a second implementation of the thing that
 * must be correct, and the two would drift.
 */

type ContributorKind = 'metric' | 'project' | 'milestone' | 'habit' | 'goal';

const KIND_LABEL: Record<ContributorKind, string> = {
  metric: 'Metric',
  project: 'Project',
  milestone: 'Milestone',
  habit: 'Habit',
  goal: 'Sub-goal',
};

export function ProgressModelEditor({ goalId }: { goalId: string }) {
  const [addingKind, setAddingKind] = useState<ContributorKind | ''>('');
  const [error, setError] = useState<string | null>(null);

  const goal = useApi(['goals', goalId], () => trpc.goals.byId.query({ id: goalId }));
  const isMomentum = goal.data?.measurementMode === 'momentum';
  const edges = useApi(['goals', goalId, 'contributors'], () =>
    trpc.relations.contributorsOf.query({ goalId }),
  );

  const metrics = useApi(keys.metrics, () => trpc.metrics.list.query({ limit: 200 }));
  const projects = useApi(keys.projects, () => trpc.projects.list.query({ limit: 200 }));
  const habits = useApi(keys.habits, () => trpc.habits.list.query({ limit: 200 }));
  const milestones = useApi(keys.milestones, () => trpc.milestones.list.query({ limit: 200 }));
  const goals = useApi(keys.goals, () => trpc.goals.list.query({ limit: 200 }));

  const invalidates = [
    ['goals', goalId, 'contributors'],
    keys.explain(goalId),
    keys.goal(goalId),
    keys.goals,
  ];

  const setExpectedRate = useApiMutation(
    (input: {
      id: string;
      rate: { value: number; per: 'week' | 'month' | 'quarter' } | null;
    }) => trpc.relations.setExpectedRate.mutate(input),
    { invalidates },
  );

  const addContributor = useApiMutation(
    (input: { kind: ContributorKind; id: string }) =>
      trpc.relations.create.mutate({
        kind: 'contributes_to',
        fromType: input.kind,
        fromId: input.id,
        toType: 'goal',
        toId: goalId,
        weight: 1,
      }),
    { invalidates, onError: (e) => setError(e.message), onSuccess: () => setError(null) },
  );

  const setWeight = useApiMutation(
    (input: { id: string; weight: number }) => trpc.relations.setWeight.mutate(input),
    { invalidates },
  );

  const removeContributor = useApiMutation(
    (id: string) => trpc.relations.remove.mutate({ id }),
    { invalidates },
  );

  const options = useMemo(() => {
    const byKind: Record<ContributorKind, Array<{ id: string; label: string }>> = {
      metric: (metrics.data?.items ?? []).map((m) => ({ id: m.id, label: m.name })),
      project: (projects.data?.items ?? []).map((p) => ({ id: p.id, label: p.name })),
      habit: (habits.data?.items ?? []).map((h) => ({ id: h.id, label: h.name })),
      milestone: (milestones.data?.items ?? []).map((m) => ({ id: m.id, label: m.name })),
      goal: (goals.data?.items ?? [])
        .filter((g) => g.id !== goalId)
        .map((g) => ({ id: g.id, label: g.name })),
    };
    const taken = new Set((edges.data ?? []).map((e) => e.fromId));
    for (const kind of Object.keys(byKind) as ContributorKind[]) {
      byKind[kind] = byKind[kind].filter((o) => !taken.has(o.id));
    }
    return byKind;
  }, [metrics.data, projects.data, habits.data, milestones.data, goals.data, edges.data, goalId]);

  // A `mode: 'metric'` goal names its metric in the progress model rather than
  // through an edge, so the edge list is legitimately empty. Saying "nothing
  // contributes" there would contradict the number shown right beside it.
  const model = goal.data?.progressModel;
  const singleMetricId = model?.mode === 'metric' ? model.metricId : null;

  const rows = edges.data ?? [];
  const totalWeight = rows.reduce((sum, e) => sum + (e.weight ?? 1), 0) || 1;

  const labelFor = (kind: string, id: string): string => {
    const list = options[kind as ContributorKind];
    const fromOptions = list?.find((o) => o.id === id)?.label;
    if (fromOptions) return fromOptions;
    const all = [
      ...(metrics.data?.items ?? []).map((m) => ({ id: m.id, label: m.name })),
      ...(projects.data?.items ?? []).map((p) => ({ id: p.id, label: p.name })),
      ...(habits.data?.items ?? []).map((h) => ({ id: h.id, label: h.name })),
      ...(milestones.data?.items ?? []).map((m) => ({ id: m.id, label: m.name })),
      ...(goals.data?.items ?? []).map((g) => ({ id: g.id, label: g.name })),
    ];
    return all.find((o) => o.id === id)?.label ?? id;
  };

  return (
    <Card title="Progress model">
      {singleMetricId !== null ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-fg-subtle text-[11px]">Metric</span>
            <span className="flex-1">{labelFor('metric', singleMetricId)}</span>
            <span className="mono text-[12px] text-fg-muted">100%</span>
          </div>
          <Subtle>
            This goal is measured by a single metric. Add another contributor to
            turn it into a weighted model.
          </Subtle>
        </div>
      ) : rows.length === 0 ? (
        <Empty
          title="Nothing contributes to this goal yet"
          hint="Only contributes_to edges move a goal's number. Everything else is context."
        />
      ) : (
        <ul className="list-none p-0 m-0 space-y-2">
          {rows.map((edge) => {
            const weight = edge.weight ?? 1;
            const normalised = weight / totalWeight;
            return (
              <li
                key={edge.id}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <span className="text-fg-subtle text-[11px] mr-1.5">
                    {KIND_LABEL[edge.fromType as ContributorKind] ?? edge.fromType}
                  </span>
                  <span className="truncate">{labelFor(edge.fromType, edge.fromId)}</span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={weight}
                  aria-label={`Weight for ${labelFor(edge.fromType, edge.fromId)}`}
                  onChange={(e) =>
                    setWeight.mutate({ id: edge.id, weight: Number(e.target.value) })
                  }
                  className="w-32 accent-[var(--accent)]"
                />

                {/* Relative weights are what the user sets; the normalised share
                    is what actually lands, so both are shown. */}
                <span className="mono text-[12px] text-fg-muted w-16 text-right">
                  {pct(normalised)}
                </span>

                <button
                  onClick={() => removeContributor.mutate(edge.id)}
                  aria-label="Remove contributor"
                  className="text-fg-subtle hover:text-behind px-1"
                >
                  ×
                </button>

                {/* docs/03 §4 — without a stated cadence the engine scores a
                    momentum contributor against its own trailing average, so
                    the goal is always exactly as fast as itself and can never
                    read `advancing`. */}
                {isMomentum && (
                  <div className="col-span-4 flex items-center gap-2 text-[11px] text-fg-subtle pl-1">
                    <span>expected</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      className="w-16 h-6 text-[11px]"
                      aria-label={`Expected rate for ${labelFor(edge.fromType, edge.fromId)}`}
                      defaultValue={edge.expectedRateValue ?? ''}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        setExpectedRate.mutate({
                          id: edge.id,
                          rate:
                            e.target.value === '' || !Number.isFinite(value) || value <= 0
                              ? null
                              : { value, per: edge.expectedRatePer ?? 'month' },
                        });
                      }}
                    />
                    <span>per</span>
                    <Select
                      className="w-24 h-6 text-[11px]"
                      aria-label={`Rate period for ${labelFor(edge.fromType, edge.fromId)}`}
                      value={edge.expectedRatePer ?? 'month'}
                      onChange={(e) =>
                        setExpectedRate.mutate({
                          id: edge.id,
                          rate: {
                            value: edge.expectedRateValue ?? 1,
                            per: e.target.value as 'week' | 'month' | 'quarter',
                          },
                        })
                      }
                    >
                      <option value="week">week</option>
                      <option value="month">month</option>
                      <option value="quarter">quarter</option>
                    </Select>
                    {edge.expectedRateValue === null && (
                      <span className="text-at-risk">
                        ◆ no stated rate — scored against its own average
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-line">
        <Select
          value={addingKind}
          onChange={(e) => setAddingKind(e.target.value as ContributorKind | '')}
          className="w-36"
          aria-label="Contributor kind"
        >
          <option value="">Add contributor…</option>
          {(Object.keys(KIND_LABEL) as ContributorKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </Select>

        {addingKind !== '' && (
          <Select
            defaultValue=""
            aria-label={`Choose ${KIND_LABEL[addingKind]}`}
            onChange={(e) => {
              if (e.target.value === '') return;
              addContributor.mutate({ kind: addingKind, id: e.target.value });
              setAddingKind('');
            }}
            className="flex-1"
          >
            <option value="">Choose…</option>
            {(options[addingKind] ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </div>

      {/* A task cannot contribute directly, and the API says why. Surfacing the
          engine's reason beats inventing a friendlier, vaguer one. */}
      {error && (
        <div className="mt-3">
          <ErrorNote error={new Error(error)} />
        </div>
      )}

      {rows.length > 0 && (
        <p className="text-[11px] text-fg-subtle mt-3 mb-0">
          <Subtle>
            Weights are relative and normalised across contributors that report. One
            that cannot be evaluated drops out and the rest renormalise.
          </Subtle>
        </p>
      )}
    </Card>
  );
}
