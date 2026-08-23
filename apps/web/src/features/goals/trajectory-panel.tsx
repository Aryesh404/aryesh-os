import { Card, Empty, ErrorNote, Skeleton, Subtle } from '../../components/ui.tsx';
import { StatusChip } from '../../components/metric.tsx';
import { TrajectoryChart } from '../../components/trajectory-chart.tsx';
import { useApi } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { date as formatDate, pct, type Status } from '../../lib/format.js';

/** docs/04 — "am I on track?", with the engine's refusals shown as answers. */
export function TrajectoryPanel({ goalId }: { goalId: string }) {
  const goal = useApi(['goals', goalId], () => trpc.goals.byId.query({ id: goalId }));
  const history = useApi(['goals', goalId, 'history'], () =>
    trpc.goals.history.query({ id: goalId }),
  );
  const trajectory = useApi(['goals', goalId, 'trajectory'], () =>
    trpc.goals.trajectory.query({ id: goalId }),
  );

  if (history.isPending || trajectory.isPending) {
    return (
      <Card title="Trajectory">
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }
  if (trajectory.isError) {
    return (
      <Card title="Trajectory">
        <ErrorNote error={trajectory.error} />
      </Card>
    );
  }

  const t = trajectory.data;
  const points = (history.data ?? [])
    .filter((s) => s.progress !== null || s.momentum !== null)
    .map((s) => ({ date: s.date, value: (s.progress ?? s.momentum) as number }));

  if (points.length === 0) {
    return (
      <Card title="Trajectory">
        <Empty
          title="No history yet"
          hint="Snapshots are written nightly. The series they build is what a trajectory is made of, and it cannot be reconstructed after the fact."
        />
      </Card>
    );
  }

  const now = Date.now();
  const last = points[points.length - 1];
  const band = t?.projection.available ? t.projection.band : undefined;

  return (
    <Card title="Trajectory">
      <div className="flex items-baseline gap-4 mb-3">
        <StatusChip status={(t?.status ?? 'unknown') as Status} />
        <Subtle>
          {t?.vocabulary === 'dated'
            ? 'judged against its target date'
            : 'judged on momentum — nothing is late that was never due'}
        </Subtle>
      </div>

      <TrajectoryChart
        actual={points}
        band={band}
        now={now}
        {...(goal.data?.targetDate ? { targetDate: goal.data.targetDate } : {})}
        status={(t?.status ?? 'unknown') as Status}
        scale={goal.data?.measurementMode === 'momentum' ? 'momentum' : 'completion'}
        {...(t?.vocabulary === 'dated' && last
          ? { requiredFrom: { date: last.date, value: last.value } }
          : {})}
        {...(t && !t.projection.available
          ? { projectionRefusal: t.projection.reason }
          : {})}
      />

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-4 text-[12px]">
        <Stat
          label="30-day pace"
          value={t?.velocity.d30 === null || t === undefined
            ? '—'
            : `${(t.velocity.d30 * 100).toFixed(2)}%/day`}
        />
        <Stat
          label="required"
          value={
            t?.requiredPace == null
              ? 'no deadline'
              : `${(t.requiredPace * 100).toFixed(2)}%/day`
          }
        />
        <Stat
          label="pace ratio"
          value={t?.paceRatio == null ? '—' : `${t.paceRatio.toFixed(2)}×`}
        />
        <Stat label="data points" value={String(t?.dataPoints ?? 0)} />
      </dl>

      {t?.projection.available && t.projection.atTarget && (
        <p className="text-[12px] text-fg-muted mt-3 mb-0">
          {t.projection.atTarget.high - t.projection.atTarget.low < 0.005 ? (
            // Every scenario lands in the same place, so quoting a range
            // ("between 100% and 100%") would be noise dressed as precision.
            <>
              At this pace it reaches{' '}
              <span className="mono">{pct(t.projection.atTarget.mid)}</span> by the
              target date under every scenario.
            </>
          ) : (
            <>
              At this pace it lands near{' '}
              <span className="mono">{pct(t.projection.atTarget.mid)}</span> by the
              target date, somewhere between{' '}
              <span className="mono">{pct(t.projection.atTarget.low)}</span> and{' '}
              <span className="mono">{pct(t.projection.atTarget.high)}</span>.
            </>
          )}
        </p>
      )}

      {t?.projection.available && t.projection.completionDate && (
        <p className="text-[12px] text-fg-muted mt-1 mb-0">
          Reaches 100% around{' '}
          <span className="mono">{formatDate(t.projection.completionDate.mid)}</span>.
        </p>
      )}

      {/* docs/03 §11 — durable growth versus borrowed growth. */}
      {t?.attribution && t.attribution.length > 0 && (
        <div className="mt-4 pt-3 border-t border-line">
          <h3 className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle m-0 mb-2">
            Where the growth came from
          </h3>
          <ul className="list-none p-0 m-0 space-y-1 text-[12px]">
            {t.attribution.map((component) => (
              <li key={component.key} className="flex justify-between">
                <span>
                  {component.label}
                  <span className="text-fg-subtle ml-2">
                    {component.controllable ? 'durable' : 'market-dependent'}
                  </span>
                </span>
                <span className="mono text-fg-muted">
                  {component.perDay >= 0 ? '+' : ''}
                  {(component.perDay * 30).toFixed(0)}/month
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(t?.caveats.length ?? 0) > 0 && (
        <ul className="list-none p-0 m-0 mt-3 space-y-1">
          {t?.caveats.map((caveat) => (
            <li key={caveat} className="text-[11px] text-at-risk">
              ◆ {caveat}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="mono m-0">{value}</dd>
    </div>
  );
}
