# 17 — Workspace redesign: approved design delivery

Status: preview approved by the user on 2026-11-05 for integration and GitHub
delivery. The approved design is the default application UI, using the normal
authenticated API and configured persistent database. Browser visual acceptance
remains pending; the wider screen rollout is separate follow-up work.

### Visual refinement — 2026-11-02

Following positive preview feedback and a request for more personality, the
review slice now adds a warmer greeting, a three-segment priority indicator,
subtle violet/sage/sand accents, clearer completed-task feedback, and area-tinted
goal cards with filled historical sparklines. Hover elevation and pressed states
are brief and respect reduced motion. The indicator uses actual selected tasks;
there are no invented scores, streaks, or extra daily setup steps. This is a
refinement of the review slice, not the wider screen rollout.

The supplied AS logo is used unchanged in the desktop sidebar, mobile header,
sign-in screen, and browser tab. The global header shows a live date and time
in Asia/Kolkata (IST), including seconds. It refreshes from the device clock
every second and on returning to the tab, with a separate row on mobile.
The clock does not announce every tick to screen readers.

## Review locally

Run `npm.cmd run review` from the repository root, then open
[the review workspace](http://localhost:5174). Its banner links to:

- Populated Today: three priorities, habits, due tasks, and three different goal states.
- Empty Today: a separate empty workspace with actionable empty states.
- Goal overview: progress, recorded history, linked work, milestones, and tracking settings.

All records and history in this preview are fictional fixtures. Two isolated
in-memory APIs run on loopback ports 4318 and 4319; Vite uses 5174. Both browser
tabs share each fixture's server state. Changes survive refresh while the process
runs, and disappear when it stops. No personal database or credentials are loaded.
The demo is automatically authenticated only in its separate local entrypoint.
The production entrypoint and authentication are unchanged.

Normal `npm.cmd run dev` continues to use the configured real database. Daily
priorities and check-ins there persist across restarts. There is no new migration:
priorities use settings, and check-ins use habit_entries.

## What changed

- Charcoal/slate tokens, self-hosted Inter, violet actions, shared SVG icons,
  readable form inputs, larger headings, responsive cards and compact task rows.
- Desktop sidebar; below 1024px a single column with Today, Work, Goals, Money,
  and More in bottom navigation. Existing hashes remain usable.
- Today: ordered choices capped at three, create/select/replace, complete/reopen,
  yesterday's unfinished choices, due tasks, habit check/undo, and named progress updates.
- Global Quick Add: title-only tasks, searchable measurements, habits, and accounts.
  Existing reading and transaction forms are reused; transactions retain account currency.
- Goal overview: present measurements, history with uncertainty and gap notices,
  linked work, milestones, and Update progress. Configuration stays in a separate
  tab; calculation details are expandable.
- Native modal dialogs provide focus containment and Escape handling; the wrapper
  returns focus on close. Phone forms use full-height sheets. Chart points support
  pointer and keyboard interaction. Reduced-motion styles are respected.
- Errors keep selections/form input available for retry. Conflicting priorities
  have a Use latest priorities action. Old-day Today saves and check-ins are rejected.

## Data contracts

Daily focus is keyed by Asia/Kolkata calendar date and contains an ordered list of
task IDs plus a revision. Atomic compare-and-swap writes and audit events run in
one libSQL batch. Repeated identical saves are no-ops. Deleted tasks can be removed
without losing the other choices. Completed priorities stay visible for the day;
nothing is silently copied to tomorrow.

Habit entries retain UTC epoch storage for date-only calendar keys, with one row
per habit/date. Check/undo is idempotent and audited atomically. Affected goals
recompute after every check-in request, including retries after a lost response.
Period displays use Monday-based weeks and actual calendar months/quarters.
Historical snapshots retain their existing UTC conventions.

Today fetches bounded visible results and exact due/habit counts. Task, habit, and
capture pickers use scoped server queries and keyset pagination. The top three
active goals are selected by importance. Their current values are calculated
from current inputs, while change labels come only from recorded history.
Completion displays percentages; momentum displays multiples of expected pace.

## Verification

Automated coverage includes:

- Ordered shared priorities, retry idempotency, simultaneous conflicting saves,
  invalid/duplicate/fourth IDs, removed tasks, and authentication.
- India-midnight boundaries for both priorities and check-ins.
- Habit undo, one entry/day, calendar periods, and goal recomputation.
- Atomic rollback when an audit write fails.
- Due tasks beyond 200 records and filtered keyset pagination.
- Real historical deltas, no invented history, and current momentum before a snapshot.
- UI selection limits, failed-save retry, conflict reload, duplicate-click
  suppression, title-only tasks, task reopening, habit failures/undo, and the
  dialog open/cancel/focus-return contract.

The full gate is `npm.cmd run ci`: lint, all seven package type checks, tests,
and production build. The review server is also smoke-checked over HTTP with
populated and empty summaries.

The production bundle check confirms the approved Today UI, original logo,
IST clock, and normal `/api` route are included, while the review API addresses,
fictional authentication principal, and review banner content are absent.

Latest result (2026-11-05): full CI passed, including 319 tests across 29 files,
all seven package type checks, lint, and production build. The HTTP smoke check
confirmed 3 priorities / 3 habits / 3 goals in the populated fixture and zero
in each category in the empty fixture.

**Still pending:** real browser inspection at 390px, 768px, and 1440px.
The computer-use helper was retried on 2026-11-05 and reported its native pipe
unavailable (Windows error 2).
DOM tests do not verify rendering, native focus trapping, touch, or virtual keyboards.

| Browser acceptance | 390px | 768px | 1440px |
|---|---|---|---|
| Populated / empty Today and goal overview | Pending | Pending | Pending |
| Long names, no horizontal overflow, readable charts | Pending | Pending | Pending |
| Keyboard order, Escape, focus containment/return | Pending | Pending | Pending |
| Touch targets, phone keyboard, visible Save actions | Pending | Pending | Pending |
| Failed saves, offline errors, two-session conflicts | Pending | Pending | Pending |

## Remaining rollout

### Save responsiveness — 2026-11-05

Standard repository creates now return the saved database row and write the
audit in one atomic batch. Updates use one read followed by one atomic batch
for the version-guarded update, audit, and optional revision. With custom-field
definitions already cached, this reduces create round trips from three to one,
and update round trips from four/five to two. Validation and affected-goal
recomputation still finish before success is returned.

Confirmed CRUD responses update cached records before background refreshes.
Only complete, unfiltered root lists receive new rows; filtered/paginated
queries keep server-owned membership and cursors. Overlapping invalidation
prefixes refresh each matching query once. Today priority saves, task changes,
and habit check-ins update their visible data directly from confirmed writes.
Task and habit buttons also show immediate pending feedback, disable duplicate
clicks, and revert on failure. Today batches its base reads and runs independent
goal/history/habit reads concurrently.

Regression coverage checks remote-client round-trip counts, simultaneous
versioned edits, audit-failure rollback, delayed saves with UI rollback, and
saved rows appearing before a slow background read completes. These are local
automated checks, not measured production latency or a change to hosting.

### Further screen work

The user approved the preview, including the visual refinements, logo, and live
clock. The remaining rollout extends the design to Work tabs, goal creation with inline Life
Areas and optional tracking, goal listing, Tracking, Money with filtered
transactions/CSV preview, Settings/data management, search refinement, and sign-in.
Those existing pages remain usable but are not claimed as redesigned here.

Light mode, graph exploration, dashboard builders, AI ranking, native apps, and
deployment changes remain deferred.
