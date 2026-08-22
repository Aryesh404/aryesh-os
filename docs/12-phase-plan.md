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

### M4 — Snapshots, collectors, jobs (2d) ★
Job queue, cron, the snapshotter, the v1 collectors (`03` §2), backfill.

*Done when:* a nightly snapshot writes for every goal and metric; collectors
rebuild 12 months of history from seeded transactions and re-run idempotently.

### M5 — API & auth (2d)
tRPC routers, Argon2id + passkey, session cookies, device tokens, FTS, keyset
pagination, typed errors.

### M6 — Capture & structure UI (5d)
Areas and **themes**; the goal builder including the **progress-model editor**
(pick contributors, set weights, see the resulting number update live); metric
creation with backfill; quick capture in the command palette; readings entry;
project and task basics.

*Done when:* a goal with four mixed contributors can be built entirely in the UI
and its progress explained via drill-down.

### M7 — Trajectory & home (5d) ★
Trajectory engine (velocity, projection, bands, honesty gates, status), the
trajectory chart (`05` §5.1), progress rings, contribution breakdown, and the
home dashboard v1.

*Done when:* the chart draws actual, required pace, and a banded projection for
a dated goal; renders the **momentum vocabulary** for an undated theme without
inventing a deadline; and **correctly refuses to project** with fewer than 5
snapshots, showing the explanation instead.

### M8 — Hardening (3d)
Performance budgets asserted, empty/loading/stale states, error handling,
structured logging, backup and export.

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
