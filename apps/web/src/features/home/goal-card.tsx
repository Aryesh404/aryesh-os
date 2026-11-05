import { Num, StatusChip } from '../../components/metric.js';
import { Icon } from '../../components/icon.js';
import { date, pct } from '../../lib/format.js';
import type { trpc } from '../../lib/trpc.js';
import { useId, type CSSProperties } from 'react';

type Update = Awaited<ReturnType<typeof trpc.today.summary.query>>['goals'][number];
export function GoalCard({ goal, onOpen }: { goal: Update; onOpen: () => void }) {
  const momentum = goal.measurementMode === 'momentum';
  const value = goal.currentValue;
  const delta = goal.change;
  return <button className="panel goal-card" onClick={onOpen} style={{ '--goal-accent': goal.areaColor ?? 'var(--accent)' } as CSSProperties}>
    <div className="goal-card-heading"><span className="goal-area"><span className="goal-area-dot" />{goal.areaName ?? 'Your goal'}</span><span className="goal-open"><Icon name="arrow" size={16} /></span></div>
    <h3>{goal.name}</h3>
    <div className="flex items-end justify-between gap-3">
      <div><div className="goal-number">{value === null ? '—' : <Num value={value} format={momentum ? (n) => `${n.toFixed(1)}×` : pct} />}</div><div className="row-meta mt-2">{momentum ? 'of your expected pace' : 'toward your target'}</div></div>
      {goal.points.length > 1 && <Sparkline points={goal.points} />}
    </div>
    <div className="mt-5"><StatusChip status={goal.trajectory.status} /></div>
    <p className="row-meta mt-3 mb-0">{delta ? <><span className={delta.value < 0 ? 'text-behind' : delta.value > 0 ? 'text-on-track' : ''}>{delta.value > 0 ? '+' : ''}{momentum ? `${delta.value.toFixed(2)}×` : `${(delta.value * 100).toFixed(1)} pp`}</span> · {date(delta.from)} – {date(delta.to)}</> : 'A little more history will reveal the trend.'}</p>
    {goal.degradedReason && <p className="row-meta !text-at-risk mt-3 mb-0">{goal.degradedReason}</p>}
    {!goal.trajectory.projection.available && <p className="row-meta mt-2 mb-0">{goal.trajectory.projection.reason}</p>}
  </button>;
}

function Sparkline({ points }: { points: Array<{ date: number; value: number }> }) {
  const gradientId = useId();
  const values = points.map((p) => p.value);
  const min = Math.min(...values); const max = Math.max(...values);
  const first = points[0]!; const last = points.at(-1)!;
  const line = points.map((p) => `${4 + (p.date - first.date) / Math.max(1, last.date - first.date) * 80},${max === min ? 20 : 35 - (p.value - min) / (max - min) * 28}`).join(' ');
  return <svg width="88" height="42" viewBox="0 0 88 42" aria-hidden="true" className="goal-sparkline">
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".2" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    <polygon points={`4,42 ${line} 84,42`} fill={`url(#${gradientId})`} />
    <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="84" cy={max === min ? 20 : 35 - (last.value - min) / (max - min) * 28} r="2.5" fill="currentColor" />
  </svg>;
}
