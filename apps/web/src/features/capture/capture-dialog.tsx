import { useState } from 'react';
import { Button, Dialog, Empty, ErrorNote, Input, Skeleton } from '../../components/ui.js';
import { Icon, type IconName } from '../../components/icon.js';
import { useApi } from '../../lib/query.js';
import { useRecords } from '../../lib/use-records.js';
import { trpc } from '../../lib/trpc.js';
import { TaskForm } from './task-form.js';
import type { CaptureRequest } from './capture-context.js';
import { RecordReadingDialog } from '../metrics/metrics-page.js';
import { NewTransactionDialog } from '../finance/finance-page.js';
import { HabitRow } from '../home/habit-row.js';

const OPTIONS: Array<{ kind: NonNullable<CaptureRequest['kind']>; label: string; hint: string; icon: IconName }> = [
  { kind: 'task', label: 'Task', hint: 'Get a next step out of your head', icon: 'check' },
  { kind: 'reading', label: 'Progress update', hint: 'Record a number you are tracking', icon: 'chart' },
  { kind: 'habit', label: 'Habit check-in', hint: 'Acknowledge showing up today', icon: 'leaf' },
  { kind: 'transaction', label: 'Transaction', hint: 'Keep track of money in or out', icon: 'wallet' },
];

export function CaptureDialog({ request, onClose }: { request: CaptureRequest; onClose: () => void }) {
  const [kind, setKind] = useState(request.kind);
  if (kind === 'reading') return <ReadingCapture initialId={request.metricId} onClose={onClose} />;
  if (kind === 'habit') return <HabitCapture onClose={onClose} />;
  if (kind === 'transaction') return <TransactionCapture onClose={onClose} />;
  return <Dialog title={kind === 'task' ? 'Add a task' : 'Make a little room in your head'} onClose={onClose}>
    {kind === 'task' ? <TaskForm onSaved={onClose} onCancel={onClose} /> : <>
      <p className="page-description mb-5">What would you like to add?</p>
      {OPTIONS.map((item) => <button key={item.kind} className="choice-row" onClick={() => setKind(item.kind)}>
        <span className="brand-mark !h-10 !w-10"><Icon name={item.icon} /></span>
        <span className="flex-1"><span className="block text-[15px]">{item.label}</span><span className="row-meta">{item.hint}</span></span><Icon name="arrow" size={16} />
      </button>)}
    </>}
  </Dialog>;
}

function ReadingCapture({ initialId, onClose }: { initialId?: string | undefined; onClose: () => void }) {
  const [selected, setSelected] = useState(initialId);
  const [q, setQ] = useState('');
  const metrics = useRecords(['metrics', 'capture', q], (page) => trpc.capture.metrics.query({ ...page, q }));
  const metric = useApi(['metrics', selected], () => trpc.metrics.byId.query({ id: selected! }), { enabled: !!selected });
  if (metric.data && selected) return <RecordReadingDialog metric={metric.data} onClose={onClose} />;
  return <Dialog title="Update your progress" onClose={onClose}>
    {selected ? <>{metric.isError ? <ErrorNote error={metric.error} /> : <Skeleton className="h-24 w-full" />}<Button onClick={() => setSelected(undefined)} className="mt-4">Choose another</Button></> : <>
      <Input aria-label="Find a measurement" autoFocus placeholder="Find by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      {metrics.isPending && <Skeleton className="h-24 w-full mt-4" />}
      {metrics.isError && <ErrorNote error={metrics.error} />}
      {metrics.isSuccess && !metrics.items.length && <Empty title="Nothing to update yet" hint="Set up a measurement in Tracking, then record it here." />}
      {metrics.items.map((item) => <button className="choice-row" key={item.id} onClick={() => setSelected(item.id)}><span className="flex-1">{item.name}</span><Icon name="arrow" size={16} /></button>)}
      {metrics.hasNextPage && <Button disabled={metrics.isFetchingNextPage} onClick={() => void metrics.fetchNextPage()} className="mt-4">Load more</Button>}
    </>}
  </Dialog>;
}

function HabitCapture({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const habits = useRecords(['habits', 'capture', q], (page) => trpc.habits.browse.query({ ...page, q }));
  // Use the server's calendar date, including when another device has a different timezone.
  const date = useApi(['today', 'habit-date'], () => trpc.today.summary.query());
  return <Dialog title="Small steps, taken often" onClose={onClose}>
    <Input autoFocus aria-label="Find a habit" placeholder="Find a habit…" value={q} onChange={(e) => setQ(e.target.value)} />
    {habits.isPending && <Skeleton className="h-24 w-full mt-4" />}
    {habits.isError && <ErrorNote error={habits.error} />}
    {date.isError && <ErrorNote error={date.error} />}
    {habits.isSuccess && !habits.items.length && <Empty title="No habits found" hint="Add a habit in Work to start checking in." />}
    {date.data && habits.items.map((habit) => <HabitRow key={habit.id} habit={habit} date={date.data.date} />)}
    {habits.hasNextPage && <Button disabled={habits.isFetchingNextPage} onClick={() => void habits.fetchNextPage()}>Load more</Button>}
  </Dialog>;
}

function TransactionCapture({ onClose }: { onClose: () => void }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const accounts = useRecords(['accounts', 'capture', q], (page) => trpc.capture.accounts.query({ ...page, q }));
  if (accountId) return <NewTransactionDialog accountId={accountId} onClose={onClose} />;
  return <Dialog title="Which account?" onClose={onClose}>
    <Input autoFocus aria-label="Find an account" placeholder="Find an account…" value={q} onChange={(e) => setQ(e.target.value)} />
    {accounts.isPending && <Skeleton className="h-24 w-full mt-4" />}
    {accounts.isError && <ErrorNote error={accounts.error} />}
    {accounts.isSuccess && !accounts.items.length && <Empty title="No accounts found" hint="Add an account in Money to record a transaction." />}
    {accounts.items.map((account) => <button className="choice-row" key={account.id} onClick={() => setAccountId(account.id)}><span className="flex-1">{account.name}</span><span className="row-meta">{account.currency}</span><Icon name="arrow" size={16} /></button>)}
    {accounts.hasNextPage && <Button disabled={accounts.isFetchingNextPage} onClick={() => void accounts.fetchNextPage()} className="mt-4">Load more</Button>}
  </Dialog>;
}
