import { useState } from 'react';
import { Button, Card, Dialog, Empty, ErrorNote, Skeleton } from '../../components/ui.js';
import { Icon } from '../../components/icon.js';
import { Num, ProgressRing, StatusChip } from '../../components/metric.js';
import { keys, useApi } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { date, metricValue, pct } from '../../lib/format.js';
import { ExplainPanel, type Outcome } from './explain-panel.js';
import { ProgressModelEditor } from './progress-model-editor.js';
import { TrajectoryPanel } from './trajectory-panel.js';
import { GoalSettings } from './goal-settings.js';
import { GoalMilestones } from './goal-milestones.js';
import { ErrorBoundary } from '../../components/error-boundary.js';
import { useCapture } from '../capture/capture-context.js';
import type { Route } from '../../app.js';

export function GoalDetail({ id, navigate }: { id: string; navigate: (route: Route) => void }) {
  const [tab, setTab] = useState<'overview' | 'settings'>('overview');
  const [updating, setUpdating] = useState(false);
  const capture = useCapture();
  const goal = useApi(keys.goal(id), () => trpc.goals.byId.query({ id }));
  const explain = useApi(keys.explain(id), () => trpc.goals.explain.query({ id }));
  const workspace = useApi(['goals', id, 'workspace'], () => trpc.goals.workspace.query({ id }));
  const trajectory = useApi(['goals', id, 'trajectory'], () => trpc.goals.trajectory.query({ id }));
  const overlaps = useApi(['goals', id, 'overlaps'], () => trpc.goals.checkOverlaps.query({ id }));
  if (goal.isPending) return <Skeleton className="h-80 w-full" />;
  if (goal.isError) return <ErrorNote error={goal.error} />;
  if (!goal.data) return <Empty title="Goal not found" />;
  const item = goal.data;
  const outcome = explain.data;
  const measured = outcome?.measurable ? (outcome.mode === 'completion' ? outcome.progress : outcome.momentum) : null;
  const value = measured?.value ?? null;
  const momentum = item.measurementMode === 'momentum';
  const linked = workspace.data;
  const update = () => {
    if (linked?.metrics.length === 1 && !linked.habits.length) capture({ kind: 'reading', metricId: linked.metrics[0]!.id });
    else setUpdating(true);
  };
  return <div>
    <button className="text-action !text-fg-subtle mb-4" onClick={() => navigate({ name: 'goals' })}><Icon name="back" size={16} />All goals</button>
    <header className="page-heading !items-start">
      <div><p className="eyebrow">{momentum ? 'An ongoing practice' : 'Something worth working toward'}</p><h1>{item.name}</h1><p className="page-description">{item.targetDate ? 'Working toward ' + date(item.targetDate) : 'An open-ended goal, at your own pace'}</p></div>
      <Button variant="primary" onClick={update} className="shrink-0 max-sm:!px-3"><Icon name="plus" size={17} /><span>Update<span className="hidden sm:inline"> progress</span></span></Button>
    </header>
    <div className="tabs" role="tablist" aria-label="Goal views" onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'settings' : tab === 'overview' ? 'settings' : 'overview';
      setTab(next); document.getElementById(next + '-tab')?.focus();
    }}>
      <button id="overview-tab" role="tab" tabIndex={tab === 'overview' ? 0 : -1} aria-controls="goal-overview" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>Overview</button>
      <button id="settings-tab" role="tab" tabIndex={tab === 'settings' ? 0 : -1} aria-controls="goal-settings" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>Tracking & settings</button>
    </div>
    {(overlaps.data ?? []).length > 0 && <div className="notice !border-at-risk/40 mb-6"><p className="m-0 text-at-risk">Some progress may be counted twice.</p>{overlaps.data?.map((overlap) => <p className="row-meta" key={overlap.source}>{overlap.message}</p>)}</div>}
    {tab === 'overview' ? <div id="goal-overview" role="tabpanel" aria-labelledby="overview-tab" className="workspace-stack">
      <section className="panel goal-hero">
        <div>
          <p className="eyebrow">Where you are now</p>
          {explain.isPending ? <Skeleton className="h-14 w-32" /> : explain.isError ? <ErrorNote error={explain.error} /> : <div className="goal-number">{value === null ? 'Not measured yet' : <Num value={value} format={momentum ? (n) => n.toFixed(2) + '×' : pct} />}</div>}
          <p className="row-meta !text-[14px] mt-3">{outcome && !outcome.measurable ? outcome.reason : momentum ? 'of your expected pace' : 'of the way to your target'}</p>
          {trajectory.data && <div className="mt-4"><StatusChip status={trajectory.data.status} /></div>}
          {trajectory.isError && <ErrorNote error={trajectory.error} />}
          {measured && measured.confidence < .5 && <p className="row-meta !text-at-risk">Limited evidence — treat this as an early picture.</p>}
          {outcome?.measurable && outcome.degraded && <p className="row-meta !text-at-risk">{outcome.degraded.reason}</p>}
          {item.why && <p className="text-fg-muted text-[14px] mt-5 mb-0 max-w-xl">{item.why}</p>}
        </div>
        {!momentum && value !== null && <div className="hidden sm:flex items-center"><ProgressRing value={value} confidence={measured?.confidence ?? 0} status={trajectory.data?.status ?? 'unknown'} size={112} /></div>}
      </section>
      <ErrorBoundary label="Your progress history"><TrajectoryPanel goalId={id} /></ErrorBoundary>
      <div className="workspace-grid">
        <Card title="The steps behind this goal">
          {workspace.isPending && <Skeleton className="h-24 w-full" />}
          {workspace.isError && <ErrorNote error={workspace.error} />}
          {linked && !linked.projects.length && !linked.habits.length && !linked.metrics.length && <Empty title="Choose how to follow your progress" hint="Link a number, a project, or a habit when you are ready." action={<Button onClick={() => setTab('settings')}>Set up tracking</Button>} />}
          {linked?.metrics.map((metric) => <button className="detail-link" key={metric.id} onClick={() => capture({ kind: 'reading', metricId: metric.id })}><span className="flex items-center gap-3 min-w-0"><Icon name="chart" /><span className="break-words">{metric.name}<span className="row-meta block">{metric.lastValue === null ? 'No update yet' : metricValue(metric.lastValue, metric.unit)}</span></span></span><span className="text-accent text-[12px] shrink-0">Update</span></button>)}
          {linked?.projects.map((project) => <button className="detail-link" key={project.id} onClick={() => navigate({ name: 'work' })}><span className="flex items-center gap-3"><Icon name="work" />{project.name}</span><Icon name="arrow" size={16} /></button>)}
          {linked?.habits.map((habit) => <button className="detail-link" key={habit.id} onClick={() => capture({ kind: 'habit' })}><span className="flex items-center gap-3"><Icon name="leaf" />{habit.name}</span><span className="text-accent text-[12px] shrink-0">Check in</span></button>)}
        </Card>
        <GoalMilestones goalId={id} />
      </div>
      <details className="panel p-5 md:p-6">
        <summary className="cursor-pointer min-h-11 flex items-center gap-3 text-[14px]"><Icon name="info" size={17} />How this is calculated</summary>
        <div className="pt-5 overflow-x-auto">{explain.isError && <ErrorNote error={explain.error} />}{outcome && <ExplainPanel outcome={outcome as Outcome} />}</div>
      </details>
    </div> : <div id="goal-settings" role="tabpanel" aria-labelledby="settings-tab">
      <p className="page-description mb-6">Choose what moves this goal forward. You can return here whenever your plans change.</p>
      <div className="grid gap-6 xl:grid-cols-2"><GoalSettings goal={item} /><ProgressModelEditor goalId={id} /></div>
    </div>}
    {updating && <Dialog title="Move this goal forward" onClose={() => setUpdating(false)}>
      {workspace.isPending && <Skeleton className="h-24 w-full" />}
      {workspace.isError && <ErrorNote error={workspace.error} />}
      {linked?.metrics.map((metric) => <button key={metric.id} className="choice-row" onClick={() => { setUpdating(false); capture({ kind: 'reading', metricId: metric.id }); }}><Icon name="chart" /><span className="flex-1">{metric.name}</span><Icon name="arrow" size={16} /></button>)}
      {!!linked?.habits.length && <button className="choice-row" onClick={() => { setUpdating(false); capture({ kind: 'habit' }); }}><Icon name="leaf" /><span className="flex-1">Check in to a habit</span><Icon name="arrow" size={16} /></button>}
      {!!linked?.projects.length && <button className="choice-row" onClick={() => { setUpdating(false); navigate({ name: 'work' }); }}><Icon name="work" /><span className="flex-1">Update your project tasks</span><Icon name="arrow" size={16} /></button>}
      {linked && !linked.metrics.length && !linked.habits.length && !linked.projects.length && <Empty title="Start with a way to track this goal" hint="Link a number, a project, or a habit. Your existing milestones are on the overview." action={<Button onClick={() => { setUpdating(false); setTab('settings'); }}>Set up tracking</Button>} />}
    </Dialog>}
  </div>;
}
