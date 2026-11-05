// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { FocusPicker } from './focus-picker.js';
import { HabitRow, type HabitState } from './habit-row.js';
import { TaskCheck, type TaskRow } from './task-check.js';
import { TaskForm } from '../capture/task-form.js';
import { Dialog } from '../../components/ui.js';

const api = vi.hoisted(() => ({
  browse: vi.fn(), save: vi.fn(), check: vi.fn(), update: vi.fn(), create: vi.fn(), summary: vi.fn(),
}));
vi.mock('../../lib/trpc.js', () => ({ trpc: {
  tasks: { browse: { query: api.browse }, update: { mutate: api.update }, create: { mutate: api.create } },
  habits: { checkIn: { mutate: api.check } },
  today: { saveFocus: { mutate: api.save }, summary: { query: api.summary } },
} }));
const task = (id: string): TaskRow => ({ id, title: 'Task ' + id, status: 'todo', version: 1, startedAt: null } as TaskRow);
const habit = { id: 'walk', name: 'Evening walk', cadence: 'weekly', targetPerPeriod: 3, completedDays: 1, checkedToday: false } as HabitState;
let client: QueryClient;
function wrap(children: ReactNode) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // jsdom has no native dialog implementation. Browser focus trapping remains
  // a manual check; this shim only verifies our open/close/focus-return contract.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  api.browse.mockResolvedValue({ items: ['A', 'B', 'C', 'D'].map(task), nextCursor: null });
});
afterEach(() => { cleanup(); client.clear(); });

describe('daily workflow interactions', () => {
  it('responds immediately to a task click and rolls back if the slow save fails', async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    api.update.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(wrap(<TaskCheck task={task('A')} />));
    await user.dblClick(screen.getByRole('button', { name: 'Complete Task A' }));
    expect(api.update).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Reopen Task A' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Saving…');
    reject(new Error('Network unavailable'));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Complete Task A' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows habit progress immediately, then reverts the count after a rejected save', async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    api.check.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(wrap(<HabitRow habit={habit} date="2026-11-01" />));
    await user.click(screen.getByRole('button', { name: 'Check in to Evening walk' }));
    expect(screen.getByText('2 of 3 days this week')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Undo check-in for Evening walk' }).getAttribute('aria-busy')).toBe('true');
    reject(new Error('Save failed'));
    await screen.findByRole('alert');
    expect(screen.getByText('1 of 3 days this week')).toBeDefined();
  });

  it('limits choices to three and keeps them after a failed save for retry', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    api.save.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({});
    render(wrap(<FocusPicker focus={{ date: '2026-11-01', taskIds: [], revision: 0 }} selectedTasks={[]} unfinished={[]} onClose={close} />));
    await screen.findByRole('button', { name: 'Task A' });
    for (const name of ['Task A', 'Task B', 'Task C']) await user.click(screen.getByRole('button', { name }));
    expect((screen.getByRole('button', { name: 'Task D' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save priorities' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Connection lost');
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Task A' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Save priorities' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(api.save).toHaveBeenLastCalledWith({ date: '2026-11-01', taskIds: ['A', 'B', 'C'], revision: 0 });
  });

  it('reloads a conflicting selection before saving with the new revision', async () => {
    const user = userEvent.setup();
    api.save.mockRejectedValue(new Error('Changed on another device'));
    api.summary.mockResolvedValue({ date: '2026-11-01', focus: { revision: 4 }, focusTasks: [task('B')] });
    render(wrap(<FocusPicker focus={{ date: '2026-11-01', taskIds: ['A'], revision: 1 }} selectedTasks={[task('A')]} unfinished={[]} onClose={vi.fn()} />));
    await user.click(screen.getByRole('button', { name: 'Save priorities' }));
    await user.click(await screen.findByRole('button', { name: 'Use latest priorities' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Task B' }).getAttribute('aria-pressed')).toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Save priorities' }));
    expect(api.save).toHaveBeenLastCalledWith({ date: '2026-11-01', taskIds: ['B'], revision: 4 });
  });

  it('prevents duplicate task submissions while saving and needs only a title', async () => {
    const user = userEvent.setup();
    let resolve!: (value: TaskRow) => void;
    api.create.mockImplementation(() => new Promise<TaskRow>((done) => { resolve = done; }));
    const saved = vi.fn();
    render(wrap(<TaskForm onSaved={saved} onCancel={vi.fn()} />));
    await user.type(screen.getByLabelText('What would you like to do?'), 'Read a chapter');
    await user.dblClick(screen.getByRole('button', { name: 'Add task' }));
    expect(api.create).toHaveBeenCalledOnce();
    expect(api.create).toHaveBeenCalledWith({ title: 'Read a chapter' });
    resolve(task('new'));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  });

  it('shows a failed check-in without claiming success, and can undo a saved day', async () => {
    const user = userEvent.setup();
    api.check.mockRejectedValueOnce(new Error('Could not save')).mockResolvedValueOnce({});
    const view = render(wrap(<HabitRow habit={habit} date="2026-11-01" />));
    await user.click(screen.getByRole('button', { name: 'Check in to Evening walk' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Check in to Evening walk' }).getAttribute('aria-pressed')).toBe('false');
    view.rerender(wrap(<HabitRow habit={{ ...habit, checkedToday: true, completedDays: 2 }} date="2026-11-01" />));
    await user.click(screen.getByRole('button', { name: 'Undo check-in for Evening walk' }));
    expect(api.check).toHaveBeenLastCalledWith({ habitId: 'walk', date: '2026-11-01', completed: false, requireToday: true });
  });

  it('reopens completed priorities without removing their selection', async () => {
    const user = userEvent.setup();
    api.update.mockResolvedValue({});
    render(wrap(<TaskCheck task={{ ...task('A'), status: 'done' }} />));
    await user.click(screen.getByRole('button', { name: 'Reopen Task A' }));
    expect(api.update).toHaveBeenCalledWith({ id: 'A', expectedVersion: 1, patch: { status: 'todo', completedAt: null } });
  });

  it('opens a labelled modal, handles Escape cancellation, and returns focus', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger); trigger.focus();
    const close = vi.fn();
    const view = render(<Dialog title="Review priorities" onClose={close}><button>Save</button></Dialog>);
    const dialog = screen.getByRole('dialog', { name: 'Review priorities' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
