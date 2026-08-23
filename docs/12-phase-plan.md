# 12 — Phase Plan

Sequencing principle: **get the loop closing as early as possible, then make it
beautiful, then make it smart.** A working Observe→Measure→Visualize cycle with
three goals is more valuable than a half-built version of everything.

## The day-one problem

Trajectory needs history, and a new system has none. Three answers, all in
Phase 1 because retrofitting them is worse:

1. **Backfill on metric creation** — the metric form accepts historical values
   ("revenue for the last 6 months"), entered as dated readings.
2. **Collectors backfill** — collectors are pure functions of `(period, data)`,
   so they rebuild the past from existing transactions and task history the
   moment they are registered.
3. **Snapshots start at M4**, before anything displays them. Cheap now,
   impossible to reconstruct honestly later.

---

## Phase 1 — Measurement & Trajectory  (~27 days)

**Ends with:** goals and metrics defined, data flowing in, progress computed
honestly, and a trajectory chart that answers "am I on track?".

### M1 — Skeleton (2d) — COMPLETE
Monorepo, Turbo, tsconfig, ESLint with boundary rules, Vitest, Fastify + tRPC,
Vite shell with the `05` token set, libSQL + Drizzle, `CLAUDE.md`,
`ShellAdapter` interface (browser impl now, Tauri in Phase 2).

*Done when:* `npm run dev` starts both, CI passes, a boundary violation fails lint.

**Verified:** `npm run ci` green (6 typecheck tasks, 18 tests, 2 builds); a probe
importing `node:fs` and `@aryesh/db` from `packages/intelligence` fails lint with
exit 1; `npm run db:migrate` creates `data/aryesh.db`; both servers serve.
Delivered past the checklist: `normaliseMetric` with 14 property-based tests, and
domain-error-to-HTTP mapping (a `NotMeasurableError` is 422, not 500) with a
regression test.

### M2 — Domain & storage (4d) — COMPLETE
Tables and repositories for areas, themes, goals, metrics, readings, milestones,
projects, tasks, habits, relations. Relation endpoint validation. Custom-field
definitions and validation. Soft delete, audit, revisions.

*Done when:* integration tests exercise every object against real libSQL; every
mutation writes an audit row; relation cycles are rejected with the path shown.

**Verified:** 16 tables, 31 indexes, 71 tests green. Every object round-trips
create/read/update/soft-delete/restore against real in-memory libSQL; audit rows
carry actor, before, and after (including `agent:` actors and execution ids);
cycles are rejected with the offending path (`A → B → C → A`).

Enforced at the data layer rather than by convention:
- **`task → goal` contributions are refused**, with the reason ("activity, not
  advancement") in the error. The activity/advancement boundary is now
  structural (docs/03 §4.4).
- **`belongs_to` is never stored** — containment is already a foreign key, and a
  second copy can drift. The graph derives those edges. This deviates from
  docs/02 §2 as originally written and that section has been updated.
- Goal nesting is guarded by the same acyclicity check as `contributes_to`,
  since it nests by FK rather than by edge.
- Foreign keys are enforced explicitly via pragma, not inherited from a driver
  default.

**D1 storage gate passed** — see docs/13.

### M3 — Intelligence core (4d) ★ — COMPLETE
`packages/intelligence`, pure: progress computation, per-kind normalisation,
weight renormalisation with degradation, confidence and staleness, the
derived-metric expression language.

*Done when:* property tests hold — progress is monotonic in contributor
progress, normalised weights always sum to 1, metric normalisation is correct in
all three directions, a stale metric lowers confidence, an unsatisfied
contributor degrades rather than silently changing the method. **Zero I/O in this
package**, enforced by lint.

**Verified:** 149 tests green (88 in this package). Every named property holds,
plus order-independence. Coverage 94% statements / 85% branches against the
package's own floor.

Purity is enforced two ways now: imports by boundary rule, and the clock by
syntax — `Date.now()`, `new Date()`, and `Math.random()` are lint errors inside
`packages/intelligence`, because a clock needs no import. Every function taking
"now" takes it as a parameter.

Also delivered:
- **Two measurement modes wired end to end** (docs/03 §4.0). Completion consumes
  `level` contributors; momentum consumes `rate` contributors and keeps bounded
  signals as separate level indicators rather than averaging them into a
  meaningless composite.
- **Contributor overlap detection** (docs/03 §5 rule 5) — duplicates and
  shared-source double counting flagged at configuration time.
- **`docs/14` conformance test**: all four real goals — ₹5L MRR, ₹1 Cr corpus,
  the engineering momentum goal, and the Aryesh OS ship/adopt split — now run
  through the actual engine rather than being reasoned about on paper.

Deviation: the expression language ships `rolling_mean(m, n)` and
`rolling_sum(m, n)` instead of `rolling(m, fn, n)`. Same power, no need for
name literals in the grammar.

### M4 — Snapshots, collectors, jobs (2d) ★ — COMPLETE
Job queue, scheduler, the snapshotter, the v1 collectors (`03` §2), backfill.

*Done when:* a nightly snapshot writes for every goal and metric; collectors
rebuild 12 months of history from seeded transactions and re-run idempotently.

**Verified:** 184 tests green. A snapshot run writes one row per goal plus
metric rollups, is idempotent within a day, and accumulates a rising series
across days — the input trajectory needs. Collectors rebuild 12 months from
seeded transactions and produce identical row counts on the second and third
run.

New package `packages/core`, the layer that composes intelligence with storage.
`packages/intelligence` still performs no I/O.

Decisions made while building:
- **An unmeasurable goal still gets a snapshot row**, carrying the reason. A gap
  in the series would later read as "no data recorded" when the truth is "we
  tried and it could not be measured".
- **A period with no data records nothing, not zero.** A month with no
  transactions is not a month of zero revenue, and a fabricated zero would sit
  in the trajectory forever.
- **Net worth is a balance, not a flow**, so it is never backfilled — stamping
  today's balance onto every past month would invent history.
- **Readings are stamped at the period start**, which is what makes a re-run
  land on the same row rather than beside it.
- The scheduler enqueues one deduped job per missed day, so closing the laptop
  for a week leaves seven days to fill rather than seven copies of tonight.

Also fixed: `firstReadingAt` was never threaded into confidence, so the density
term always evaluated to 1 and did nothing. And low freshness now explains
itself rather than only formal staleness — a metric 45 days behind a monthly
cadence was dropping confidence to 0.5 while saying nothing about why.

### M5 — API & auth (2d) — COMPLETE
tRPC routers, Argon2id, session cookies, device tokens, FTS, keyset pagination,
typed errors.

**Verified:** 220 tests green, plus the running server probed over real HTTP:
`/health` 200, anonymous read 401, public `auth.status` 200, an unmeasurable
metric **422 rather than 500**, `auth.initialise` setting an `HttpOnly`
`SameSite` cookie, and authenticated reads/writes and search all working.

- **Three scopes, not one.** A session is always `full`; a device token carries
  the scope it was issued with. A phone can record a reading without being able
  to restructure the goal tree, and the refusal names the scope it needed.
- **Nothing plaintext.** Passwords are Argon2id (verified by asserting the
  `$argon2id$` prefix on the stored hash); session and device tokens are stored
  as SHA-256 digests, so a leaked database hands over neither. A device token's
  plaintext exists exactly once, at issue.
- **Password change bumps a generation**, which invalidates every existing
  session in one write rather than enumerating them.
- **FTS5 is maintained by SQLite triggers**, not application code, so anything
  that writes a row keeps search correct — including soft delete, which removes
  the row from the index rather than leaving an archived goal answering queries.
  User input is tokenised and quoted, so `₹5L MRR` searches instead of erroring.

**Passkeys deferred.** The tables and challenge store are in place, but WebAuthn
is a browser ceremony with no UI to drive it until M6. Shipping a server half
now would be untested surface area; it lands with the login screen.

Bug found: a goal using the `mode: 'metric'` shorthand names its metric in the
progress model rather than through a `contributes_to` edge, so the invalidation
walk never reached it and its cached progress went stale silently. The walk now
also matches goals by `json_extract(progress_model, '$.metricId')`.

### M6 — Capture & structure UI (5d) — COMPLETE
Areas and **themes**; the goal builder including the **progress-model editor**
(pick contributors, set weights, see the resulting number update live); metric
creation with backfill; quick capture in the command palette; readings entry;
project and task basics.

*Done when:* a goal with four mixed contributors can be built entirely in the UI
and its progress explained via drill-down.

**Verified by driving the running app**, not only by tests. "₹5L MRR by March
2027" was built through the interface with four mixed contributors — metric,
project, habit, milestone — and the drill-down rendered:

```
20%  method weighted-mean   confidence 0.78
metric    monthly_revenue              25%  28%  140000 of 500000, baseline 0
project   Retainer platform            25%  50%  1 of 2 effort closed
habit     Weekly client outreach       25%   0%  0 of 13
milestone First retainer client signed 25%   0%  0 of 1 achieved
◆ Retainer platform: task completion is an activity proxy, not measured advancement
```

Dragging the metric weight to 7 renormalised to 70/10/10/10 and moved the goal
to 25% — the figure always comes back from the engine, never from a second
implementation in the UI. Quick capture (`monthly_revenue 152000`) then recorded
a reading, and the event chain recomputed the goal to 26% with the detail line
updated, closing Observe → Measure → Understand → Visualize through the UI.

Three bugs the running app found that tests had not:
- **`npm run dev` did not work at all.** Turbo runs the API with cwd `apps/api`,
  so the relative `DATABASE_URL` resolved to `apps/api/data`. Every prior
  verification had run tsx from the repo root. The API now derives the root from
  its own file location.
- **`projects.progress` was a cached column nothing wrote**, so every project
  read "—". Task writes now emit `task.changed` and the core recomputes it,
  mirroring goals.
- **`mergeRouters` rejects duplicate procedure keys**, so overriding a generated
  CRUD procedure crashed at startup while typechecking cleanly. `crudRouter`
  grew an `afterWrite` hook instead.

Also fixed: metric values are plain numbers, not minor units, so formatting a
currency metric through `money()` under-reported it 100×.

**Passkeys deferred again — see docs/13 D11.** Password auth is complete; this is
a considered scheduling call, not a slip that keeps rolling.

### M7 — Trajectory & home (5d) ★ — COMPLETE
Trajectory engine (velocity, projection, bands, honesty gates, status), the
trajectory chart (`05` §5.1), progress rings, contribution breakdown, and the
home dashboard v1.

*Done when:* the chart draws actual, required pace, and a banded projection for
a dated goal; renders the **momentum vocabulary** for an undated theme without
inventing a deadline; and **correctly refuses to project** with fewer than 5
snapshots, showing the explanation instead.

**All three verified in the running app**, against a seeded database carrying 61
days of real snapshots for two goals and 3 for a third:

| Goal | Vocabulary | Status | Projection |
|---|---|---|---|
| ₹5L MRR by March 2027 | dated | ahead, pace 1.73× | linear, 25-point band |
| Become a stronger engineer | momentum | slowing, `paceRatio: null` | refused — nothing is moving |
| Ship the client portal | dated | at risk | **refused — 5 days of data needed, 3 so far** |

The refusal is rendered where the projection would have been, so a young goal
says what it does not know rather than showing an empty chart.

**Two real bugs found by running it.**

*The scheduler was fabricating history.* Catch-up enqueued a snapshot for each
of the last seven days and stamped **today's** computed progress onto each one —
progress is derived from the readings that exist now, so backfilling six months
of revenue on Monday would have written a week of invented history showing
Monday's figure. Missed days are now simply left empty. A gap is honest; an
invented point is indistinguishable from a real one once written (docs/03 §7).
The M4 test that asserted the old behaviour encoded the wrong rule and has been
replaced.

*`stalled` meant the wrong thing for momentum goals.* It was computed from
flatness of the series, but a goal shipping steadily has a **constant** momentum
score — so the measure was calling the exact behaviour it exists to reward
"stalled". For momentum it now means the activity itself stopped.

Also fixed while looking at real output: velocity required full window coverage,
so a young goal had no velocity at any window and a 90-day decelerating goal had
no baseline and read as "advancing"; the momentum axis was labelled in percent,
which is precisely the denominator momentum mode exists to avoid; and the
progress-model editor claimed "nothing contributes" for a `mode: 'metric'` goal
while showing its number alongside.

Deviation from `13` D6: the chart is hand-rolled SVG rather than visx. It needs
two linear scales, a path builder, and tick selection; a chart library's value
is in the parts this chart does not use, and it would fight the token system for
colour.

### M8 — Hardening (3d) — COMPLETE
Performance budgets asserted, empty/loading/stale states, error handling,
structured logging, backup and export.

**264 tests green.** Phase 1 is done.

**The budgets are now assertions**, with the measured figure printed in the
failure message. Writing them found a real problem: `rollupMetrics` issued one
query *per metric per period* — 120 000 round trips for 300 daily metrics over a
400-day window — which made the nightly job take **19.9 s against a 5 s budget**.
Rewritten to one query per metric with in-memory bucketing and batched upserts,
it now runs in **~0.8 s**. The threshold is the documented 5 s rather than
something loosened to fit.

| Budget | Documented | Measured |
|---|---|---|
| Progress recompute, one goal | 20 ms | ~14 ms |
| Nightly snapshot, 200 goals + 300 metrics | 5 s | ~0.8 s |
| Two-year trajectory read | 100 ms | ~75 ms |
| Command-palette keystroke | 30 ms | ~12 ms |
| Keyset page over 20 000 rows | 100 ms | well inside |

**Backup and export** (docs/27). Two mechanisms, deliberately different: a
binary `VACUUM INTO` snapshot for recovery — hot, exact, taken nightly with
hourly/daily/weekly retention — and a portable JSON export for ownership,
readable and diffable, carrying a manifest with per-table checksums. Import
validates checksums before writing anything, runs in one transaction, and takes
a safety snapshot first, because it is the one operation whose wrongness is only
discoverable afterwards. Secrets and machine-local bookkeeping are excluded from
the export, so a leaked file does not leak the account.

**States and logging.** Scoped error boundaries — one panel failing no longer
blanks the page, and the message says the data is untouched. Stale surfaces
render dimmed with the time they were last true. Every response carries an
`x-request-id`. Domain refusals log at `info`, not `error`: "this cannot be
measured yet" is an answer, and logging answers as faults trains the reader to
ignore the log.

One design error caught by running it: `validateImport` was a query, which puts
an entire database export in a URL. It is a mutation now.

---

## Phase 2 — Visualization (~15 days)

Full visual system implementation; the motion layer; the neural graph
(projection, WebGL rendering, encoding, interaction, contribution-path
highlight); the dashboard builder with drag/resize/configure; the widget
registry and v1 widget set; **Tauri v2 wrapper** with global hotkey and OS
notifications.

*Done when:* the graph holds 60 fps at 2 000 nodes, the dashboard is fully
user-arrangeable, and the app opens from a global hotkey.

## Phase 3 — Understanding & Decisions (~12 days)

Blocker detectors, attention allocation, the insight engine with deduplication
and anti-noise rules, attention ranking, the decision log with review flow and
calibration. All deterministic — no AI yet.

*Done when:* every detector has fixture tests, and the system surfaces a real
finding from real seeded data that the user had not noticed.

## Phase 4 — Work & Money (~12 days)

Project and task depth, habits and streaks, finance (accounts, transactions,
categories, budgets, investments, net worth), finance collectors feeding metrics,
business and client attribution.

## Phase 5 — Claude Layer (~14 days)

Analysis first (insight enrichment, question answering over the graph and
progress), then execution (Agent SDK bridge, permissions, allowance UI, audit,
MCP write-back, `rewindFiles` revert). Then CLI, then the mobile companion for
approvals and capture.

## Phase 6 — Automations & Refinement (~10 days)

The workflow engine as an event-bus subscriber (`08` §4), predictive refinement,
decision calibration analytics, polish.

---

## Definition of done (every milestone)

1. Types check, no `any`, no unexplained `@ts-expect-error`.
2. Pure logic property-tested; anything touching the DB integration-tested.
3. Every computed number is drillable to its `Explained<T>`.
4. Every mutation writes audit.
5. Empty, loading, stale, and error states exist — not just the happy path.
6. Docs updated when a decision changes. These documents are the specification.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| No history makes the product feel empty for weeks | **High** | The three day-one answers above. Backfill is a Phase 1 feature, not a nicety |
| Progress models are too fiddly to configure | High | M6 is the test. Ship 3–4 templates ("outcome metric", "project-driven", "habit-driven") as starting points, editable after |
| Trajectory math produces confident nonsense early | High | The honesty gates in `04` §2 are engine-enforced and tested, not UI conventions |
| Visual ambition slows delivery | Medium | The token system and chart primitives land in M1/M7 and are reused; polish is a Phase 2 pass, not per-screen improvisation |
| libSQL proves limiting | Low | Repository layer; benchmark gate at M2 (`13` D1) |
| Scope regrowth toward a no-code platform | Medium | `08` §2 is the standing answer. New extensibility needs a named progress-intelligence benefit |
