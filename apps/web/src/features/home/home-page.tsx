import { Card, Empty, ErrorNote, Skeleton, Subtle } from '../../components/ui.tsx';
import { ProgressRing, StatusChip } from '../../components/metric.tsx';
import { keys, useApi } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { date, relativeDays, type Status } from '../../lib/format.js';
import type { Route } from '../../app.js';

/**
 * docs/07 §1 — home v1.
 *
 * Deliberately only the widgets whose data exists. The graph is Phase 2 and
 * attention allocation and insights are Phase 3; shipping placeholders for them
 * would teach the wrong thing about what this product currently knows.
 */
export function HomePage({ navigate }: { navigate: (route: Route) => void }) {
  const goals = useApi(keys.goals, () => trpc.goals.list.query({ limit: 100 }));
  const areas = useApi(keys.areas, () => trpc.areas.list.query({ limit: 100 }));
  const stale = useApi(keys.needingData, () => trpc.readings.needingData.query({}));

  const active = (goals.data?.items ?? []).filter((g) => g.status === 'active');
  const areaOf = (id: string) => (areas.data?.items ?? []).find((a) => a.id === id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold m-0">Today</h1>
        <Subtle>How you are actually progressing</Subtle>
      </header>

      {goals.isPending && <Skeleton className="h-32 w-full" />}
      {goals.isError && <ErrorNote error={goals.error} />}

      {goals.isSuccess && active.length === 0 && (
        <Empty
          title="Nothing to report yet"
          hint="Create a goal and give it something that moves — a metric, a project, a habit."
        />
      )}

      {active.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((goal) => (
            <GoalTile
              key={goal.id}
              goal={goal}
              areaColor={areaOf(goal.areaId)?.color}
              onOpen={() => navigate({ name: 'goal', id: goal.id })}
            />
          ))}
        </div>
      )}

      {/* The most useful nag is not "you have tasks" — it is "you stopped
          measuring the thing you said mattered" (docs/03 §6). */}
      {(stale.data ?? []).length > 0 && (
        <Card title="Needs data">
          <ul className="list-none p-0 m-0 space-y-1">
            {(stale.data ?? []).map((metric) => (
              <li key={metric.id} className="flex justify-between text-[13px]">
                <span>{metric.name}</span>
                <span className="mono text-fg-subtle">
                  {metric.daysSince === null
                    ? 'never recorded'
                    : relativeDays(metric.daysSince)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-fg-subtle mt-3 mb-0">
            A goal cannot be assessed from data that stopped arriving.
          </p>
        </Card>
      )}
    </div>
  );
}

type GoalRow = {
  id: string;
  name: string;
  progress: number | null;
  confidence: number | null;
  measurementMode: string;
  targetDate: number | null;
  degradedReason: string | null;
};

function GoalTile({
  goal,
  areaColor,
  onOpen,
}: {
  goal: GoalRow;
  areaColor?: string | undefined;
  onOpen: () => void;
}) {
  const trajectory = useApi(
    ['goals', goal.id, 'trajectory'],
    () => trpc.goals.trajectory.query({ id: goal.id }),
    { staleTime: 60_000 },
  );

  const status = (trajectory.data?.status ?? 'unknown') as Status;

  return (
    <button
      onClick={onOpen}
      className="text-left bg-surface border border-line rounded-card p-4 flex items-center gap-4 hover:border-line-strong transition-colors duration-[120ms]"
    >
      <ProgressRing
        value={goal.measurementMode === 'momentum' ? null : goal.progress}
        confidence={goal.confidence ?? 0}
        status={status}
        {...(areaColor ? { areaColor } : {})}
        size={60}
      />

      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{goal.name}</div>

        <div className="mt-1 flex items-center gap-3">
          {trajectory.isPending ? (
            <Skeleton className="h-3 w-20" />
          ) : (
            <StatusChip status={status} />
          )}
          <Subtle>
            {goal.targetDate ? `by ${date(goal.targetDate)}` : 'no target date'}
          </Subtle>
        </div>

        {/* The refusal is the content, not an empty space (docs/05 §7). */}
        {trajectory.data && !trajectory.data.projection.available && (
          <div className="text-[11px] text-fg-subtle mt-1 truncate">
            {trajectory.data.projection.reason}
          </div>
        )}
        {goal.degradedReason && (
          <div className="text-[11px] text-at-risk mt-1 truncate">
            ◆ {goal.degradedReason}
          </div>
        )}
      </div>
    </button>
  );
}
