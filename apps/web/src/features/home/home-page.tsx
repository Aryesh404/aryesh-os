import { useState } from 'react';
import { dayStamp, PLANNING_TIME_ZONE } from '@aryesh/domain';
import { Button, Dialog, ErrorNote, Skeleton } from '../../components/ui.js';
import { Icon } from '../../components/icon.js';
import { keys, useApi } from '../../lib/query.js';
import { useRecords } from '../../lib/use-records.js';
import { trpc } from '../../lib/trpc.js';
import { date } from '../../lib/format.js';
import { useCapture } from '../capture/capture-context.js';
import { FocusPicker } from './focus-picker.js';
import { TaskCheck } from './task-check.js';
import { HabitRow } from './habit-row.js';
import { GoalCard } from './goal-card.js';
import { FocusOrbit } from './focus-orbit.js';
import type { Route } from '../../app.js';

export function HomePage({ navigate }: { navigate: (route: Route) => void }) {
  const today = useApi(keys.today, () => trpc.today.summary.query(), { refetchInterval: 30_000, refetchOnWindowFocus: 'always' });
  const stale = useApi(keys.needingData, () => trpc.readings.needingData.query({}));
  const [picking, setPicking] = useState(false);
  const [allDue, setAllDue] = useState(false);
  const capture = useCapture();
  const data = today.data;
  const finished = data?.focusTasks.filter((t) => t.status === 'done').length ?? 0;
  const selected = data?.focusTasks.length ?? 0;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: PLANNING_TIME_ZONE }).format(Date.now()));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = data ? new Date(dayStamp(data.date)).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }) : 'Your day, at a glance';
  return <div>
    <header className="page-heading today-heading">
      <div><p className="eyebrow today-date"><span className="day-marker" />{dateLabel}</p><h1>{greeting},<br className="sm:hidden" /> <span className="greeting-name">Aryesh.</span></h1><p className="page-description">Make a little room for a day that feels like you.</p></div>
      {data && <FocusOrbit completed={data.focusTasks.map((task) => task.status === 'done')} />}
    </header>
    {today.isPending && <div className="workspace-grid"><Skeleton className="h-80 w-full" /><Skeleton className="h-80 w-full" /></div>}
    {today.isError && <div className="notice mb-5"><ErrorNote error={today.error} /><Button onClick={() => void today.refetch()} className="mt-3">Try again</Button></div>}
    {data && <>
      <div className="workspace-grid">
        <div className="workspace-stack">
          <section className="panel focus-panel" aria-labelledby="focus-heading">
            <header className="panel-heading"><div><p className="eyebrow !text-accent !mt-0 !mb-2">Make room for what matters</p><h2 id="focus-heading">Your three priorities</h2><p>Less on your list. More of your attention.</p></div><button className="text-action" onClick={() => setPicking(true)}>{selected ? 'Edit' : 'Choose'}<Icon name="plus" size={15} /></button></header>
            <div className="panel-body">
              {data.focusTasks.map((task, index) => <div className="priority-row" key={task.id} data-complete={task.status === 'done'}>
                <span className="priority-index">0{index + 1}</span><TaskCheck task={task} />
                <div className="min-w-0 flex-1"><p className={'task-title' + (task.status === 'done' ? ' is-done' : '')}>{task.title}</p><div className="row-meta">{task.status === 'done' ? 'Done. A little more space in your day.' : task.dueDate ? 'Due ' + date(task.dueDate) : 'Chosen by you, for today'}</div></div>
              </div>)}
              {Array.from({ length: 3 - selected }, (_, index) => <button key={index} className="empty-priority" onClick={() => setPicking(true)}><span className="priority-index">0{selected + index + 1}</span><span className="icon-button"><Icon name="plus" size={17} /></span>{selected + index === 0 ? 'Choose your first priority' : 'Leave space, or choose another'}</button>)}
              <div className="focus-footer" role="status"><span className="focus-steps" aria-hidden="true">{[0, 1, 2].map((index) => <span key={index} data-filled={index < finished} />)}</span><span>{selected && finished === selected ? 'Your priorities are done. Enjoy a little breathing room.' : selected ? finished + ' of ' + selected + ' complete. One small win at a time.' : 'Start with one thing. Let the rest follow.'}</span></div>
              {!!data.unfinished.length && <button className="text-action mt-2" onClick={() => setPicking(true)}>{data.unfinished.length} unfinished from yesterday<Icon name="arrow" size={14} /></button>}
              {data.focus.taskIds.length !== selected && <p className="notice mt-4">A priority is no longer available. <button className="text-action" onClick={() => setPicking(true)}>Review priorities</button></p>}
            </div>
          </section>
          <section className="panel" aria-labelledby="due-heading">
            <header className="panel-heading"><div><h2 id="due-heading">Also on your radar</h2><p>Due today and earlier. One thing at a time.</p></div><button className="text-action" onClick={() => setAllDue(true)}>View all<Icon name="arrow" size={15} /></button></header>
            <div className="panel-body">
              {!data.dueTasks.length && <div className="quiet-empty flex items-start gap-3"><Icon name="sun" /><div>No deadlines asking for your attention.<button className="text-action block" onClick={() => capture({ kind: 'task' })}>Add a task</button></div></div>}
              {data.dueTasks.map((task) => <div key={task.id} className="due-row"><TaskCheck task={task} /><div className="flex-1 min-w-0"><p className="task-title !text-[14px]">{task.title}</p><div className={'row-meta ' + (task.dueDate! < dayStamp(data.date) ? 'text-at-risk' : '')}>{task.dueDate! < dayStamp(data.date) ? 'Overdue · ' + date(task.dueDate!) : 'Due today'}</div></div></div>)}
              {data.dueCount > data.dueTasks.length && <button className="text-action" onClick={() => setAllDue(true)}>See all {data.dueCount} tasks</button>}
            </div>
          </section>
        </div>
        <div className="workspace-stack">
          <section className="panel habits-panel" aria-labelledby="habits-heading">
            <header className="panel-heading"><div><h2 id="habits-heading">Small steps, often</h2><p>Consistency starts with showing up.</p></div><span className="section-emblem"><Icon name="leaf" size={23} /></span></header>
            <div className="panel-body">
              {!data.habits.length && <div className="quiet-empty">A little routine goes a long way.<button className="text-action block" onClick={() => navigate({ name: 'work' })}>Add your first habit<Icon name="arrow" size={15} /></button></div>}
              {data.habits.map((habit) => <HabitRow key={habit.id} habit={habit} date={data.date} />)}
              {data.habitCount > data.habits.length && <button className="text-action" onClick={() => capture({ kind: 'habit' })}>See all {data.habitCount} habits<Icon name="arrow" size={15} /></button>}
            </div>
          </section>
          <section className="panel updates-panel" aria-labelledby="updates-heading">
            <header className="panel-heading"><div><h2 id="updates-heading">Keep the picture clear</h2><p>A quick update helps you see your progress.</p></div><span className="section-emblem"><Icon name="chart" size={23} /></span></header>
            <div className="panel-body">
              {stale.isPending && <Skeleton className="h-16 w-full" />}
              {stale.isError && <ErrorNote error={stale.error} />}
              {stale.isSuccess && !stale.data.length && <p className="row-meta !text-[14px] m-0">Nothing is waiting for an update.</p>}
              {(stale.data ?? []).slice(0, 3).map((metric) => <button className="detail-link" key={metric.id} onClick={() => capture({ kind: 'reading', metricId: metric.id })}><span className="min-w-0"><span className="block break-words">{metric.name}</span><span className="row-meta">{metric.daysSince === null ? 'Ready for your first update' : 'Last updated ' + metric.daysSince + ' days ago'}</span></span><Icon name="plus" size={17} /></button>)}
              {(stale.data?.length ?? 0) > 3 && <button className="text-action" onClick={() => navigate({ name: 'metrics' })}>View all updates<Icon name="arrow" size={15} /></button>}
            </div>
          </section>
        </div>
      </div>
      <div className="section-heading"><div><p className="eyebrow !mb-1">The bigger picture</p><h2>Where you're heading</h2></div><button className="text-action" onClick={() => navigate({ name: 'goals' })}>All goals<Icon name="arrow" size={15} /></button></div>
      {data.goals.length ? <div className="goal-grid">{data.goals.map((goal) => <GoalCard key={goal.id} goal={goal} onOpen={() => navigate({ name: 'goal', id: goal.id })} />)}</div> : <div className="panel p-6"><p className="page-description">Give your daily steps a direction.</p><button className="text-action" onClick={() => navigate({ name: 'goals' })}>Set your first goal<Icon name="arrow" size={16} /></button></div>}
      <p className="text-[11px] text-fg-subtle text-center mt-8">A day well spent is built one choice at a time.</p>
      {picking && <FocusPicker key={data.date} focus={data.focus} selectedTasks={data.focusTasks} unfinished={data.unfinished} onClose={() => setPicking(false)} />}
    </>}
    {allDue && <DueTasks onClose={() => setAllDue(false)} />}
  </div>;
}

function DueTasks({ onClose }: { onClose: () => void }) {
  const tasks = useRecords(['tasks', 'due'], (page) => trpc.tasks.browse.query({ ...page, due: true }));
  return <Dialog title="On your radar" onClose={onClose}>
    <p className="page-description mb-4">Your open tasks, due today or earlier.</p>
    {tasks.isPending && <Skeleton className="h-24 w-full" />}
    {tasks.isError && <ErrorNote error={tasks.error} />}
    {tasks.isSuccess && !tasks.items.length && <p className="quiet-empty">You're clear of deadlines for today.</p>}
    {tasks.items.map((task) => <div className="due-row" key={task.id}><TaskCheck task={task} /><div className="min-w-0"><p className="task-title">{task.title}</p><span className="row-meta">Due {date(task.dueDate!)}</span></div></div>)}
    {tasks.hasNextPage && <Button className="mt-4" disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>Load more</Button>}
  </Dialog>;
}
