# Aryesh OS — working notes for Claude Code

Personal progress intelligence system. One user. The specification lives in
`docs/` and **the docs are the spec** — if a decision changes, update the doc in
the same change.

## What this product is

It answers four questions across personal, career, business, finance, projects,
and long-term goals:

1. How am I actually progressing? (advancement, not activity)
2. Am I on trajectory to hit what I said I'd hit?
3. What is slowing me down?
4. What should I do next, and why?

The loop: **Observe → Measure → Understand → Visualize → Decide → Act → Measure again.**

Read `docs/00-index.md` first. `docs/02`, `03`, `04` are the product;
`docs/05` is the visual system; `docs/14` is the engine validated against four
real goals.

## Commands

```bash
npm run dev         # api (:4317) + web (:5173)
npm run ci          # lint + typecheck + test + build — run before saying done
npm test            # vitest
npm run typecheck
npm run lint
npm run db:generate # drizzle migration from packages/db/src/schema/tables/*.ts
npm run db:migrate
```

## Non-negotiable rules

1. **Measure advancement, not activity.** A closed task is not progress. Task
   completion may support *project* evidence but never becomes goal progress
   except through an explicit weighted `contributes_to` edge.
2. **Honest over impressive.** Never project from fewer than 5 snapshots. Never
   show a point estimate without its band. Never treat stale data as current.
   Never assert causation. Never hide a decline. Every claim carries clickable
   evidence. These are engine-enforced and tested — see `docs/04 §9`.
3. **Not everything is a percentage.** Goals carry `measurementMode`:
   `completion` (0–100% toward a definable end) or `momentum` (rate vs expected,
   **no percentage**). Forcing a percentage onto "become a stronger engineer"
   invents a denominator that does not exist.
4. **Every number is explainable.** Computations return `Explained<T>` — value,
   method, inputs, confidence, caveats. Explainability is a return type, not a
   log.
5. **`packages/intelligence` is pure.** No I/O, no network, no clock. Anything
   depending on "now" takes `now: number` as a parameter. Enforced by lint.
6. **Only `contributes_to` affects progress.** Everything else is context.
7. **Simplicity beats elegance.** Do not build a general mechanism where a
   specific one is clearer. Generality is earned by a second real use case.
8. **AI proposes, the user accepts.** Never silently write memory, preferences,
   or configuration.

## Settled architecture decisions

- **React 19 + Vite stays.** No Next.js migration (`docs/16`, D13). One Vite-
  specific line exists in the whole codebase, so the move would be cheap and
  pointless: no SEO, no cold-load path, no images, every route behind a session
  cookie — and Tauri wants the static bundle Vite already produces.
- **Deployment is one origin**, with `/api/*` reverse-proxied to Fastify, so the
  session cookie stays first-party (`docs/16 §3`). Never deploy web and API to
  different registrable domains talking directly — `SameSite=Lax` stops sending
  the cookie and the fix is a third-party cookie.
- **Tauri, mobile, and CLI authenticate with `Authorization: Bearer` device
  tokens**, not cookies. `resolvePrincipal` already prefers the header.
- **The API is the only write path.** No second server runtime, no server
  actions, no frontend-direct database access, no duplicated auth.

## Architecture in one paragraph

npm workspaces + Turborepo. TypeScript everywhere, `strict` plus
`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. libSQL (embedded
SQLite) via Drizzle — the whole OS is one copyable file. Fastify + tRPC v11 API
is the only door; web, CLI, and mobile are peer clients. Vite + React 19 SPA,
Tauri wrapper from Phase 2. Fixed domain model (no user-authored entity types);
customization is scoped to dashboards, widgets, goals, metrics, fields,
categories, views, graph config, and personal structure — see `docs/08`.

## Dependency rule (lint-enforced)

```
domain <- intelligence
   ^          ^
   +-- db <- core <- agent
              ^        ^
        contracts -----+---> api -> { web, cli, mobile }
                 ui, viz, graph ---> web
```

Violations fail `npm run lint` with a message pointing at
`docs/11-repository-structure.md`. Do not weaken the rule to make an import
work — the import is the problem.

## Conventions

- Money: integer **minor units** + currency code. Never a float.
- Dates: UTC epoch ms in storage, formatted only at the edge.
- Files: soft limit 300 lines, hard 500. One primary export per file.
- Naming: `kebab-case` files, `PascalCase` components/types, `camelCase` values.
- Errors: `AppError` subclasses with stable codes from `@aryesh/contracts`.
  Never throw strings. Domain errors map to real HTTP statuses — a
  `NotMeasurableError` is a 422, not a 500.
- Imports inside packages use explicit `.js` extensions (ESM).
- Numbers in the UI render through one component that owns tabular figures.

## Gotchas already paid for

- **tRPC middleware `next()` resolves with a result object; it does not throw.**
  Inspect `result.ok` — a `try/catch` around `next()` silently never fires.
  There is a regression test for this in `apps/api/src/routers/index.test.ts`.
- **One Vite across the workspace**, pinned via `overrides` in the root
  `package.json`. Two copies means two sets of types, and
  `exactOptionalPropertyTypes` turns that into a hard error.
- **drizzle-kit reads `packages/db/src/schema/tables/*.ts` directly**, not the
  barrel, because it resolves via CJS and chokes on ESM `.js` specifiers. Put
  new tables in `tables/` and re-export them from `schema/index.ts`.
- **Relative `DATABASE_URL` resolves against the repo root**, not cwd — see
  `resolveDbUrl` in `packages/db`. The API passes its own root explicitly.
- `exactOptionalPropertyTypes` means `foo?: string` and `foo?: string | undefined`
  differ. Zod-inferred optionals need the explicit `| undefined`, and passing
  `{ opt: undefined }` is NOT the same as omitting the key.
- **SQLite treats NULLs as DISTINCT in a UNIQUE index.** A nullable column in a
  dedupe key silently exempts every row that leaves it null. `readings.component`
  is `NOT NULL DEFAULT ''` for exactly this reason — with it nullable, collector
  re-runs doubled history instead of updating it.
- Drizzle strips each builder method from the type once called, so conditional
  chaining (`if (where) q = q.where(...)`) needs `.$dynamic()`.
- Self-referencing FKs need an explicit return type:
  `.references((): AnySQLiteColumn => goals.id)`.
- Errors live in `@aryesh/domain`, not `@aryesh/contracts`, so the db layer can
  raise them without importing upward. `contracts` re-exports them.

## Data layer notes (M2)

- Repositories come from `createRepositories({ db, clock })`. The factory in
  `packages/db/src/repositories/base.ts` handles audit, soft delete, optimistic
  version, revisions, and custom-field validation once — do not hand-roll them.
- Every write takes a `Ctx { actor, executionId?, note? }`. There is no
  anonymous write.
- `belongs_to` is never stored; containment is a foreign key. The graph derives
  those edges.
- Only `contributes_to` feeds progress. `relations.contributorsOf(goalId)` IS
  the progress engine's input.
- Readings are append-only and idempotent by
  `(metric, at, source, component)`. A correction is a new reading.
- Use `createTestDb()` from `packages/db/src/testing.js` — real in-memory libSQL
  with migrations and a controllable clock.
- After changing a table, run `npm run db:generate`. New tables go in
  `packages/db/src/schema/tables/` and are re-exported from `schema/index.ts`.

## Intelligence core notes (M3)

- `computeProgress(goal, { now })` is the entry point. It takes **facts, not
  rows** — `packages/core` maps database rows into `GoalInput`/`ContributorInput`.
- Completion mode consumes `evaluation: 'level'` contributors and returns a
  0–1 percentage. Momentum mode consumes `evaluation: 'rate'` contributors,
  returns a 0–1.5 score where >1 means exceeding, and **never returns a
  percentage**. Bounded signals on a momentum goal come back as separate
  `levels`, never blended in.
- An unsatisfied contributor drops out, the rest renormalise, and the result
  carries a `degraded` reason. It never silently computes a different way, and
  it never counts an unknown as zero.
- `findOverlaps()` before saving a progress model: two contributors reading the
  same events double-count.
- Expression language: `validateExpression` at save time, `evaluate` at read
  time. Errors are values (`{ ok: false, error }`), never exceptions.
  `findExpressionCycle` before saving a derived metric.
- **Nothing here may read a clock or use randomness** — both are lint errors.

## Core notes (M4)

- `createCore({ db, clock })` is the composition root: repos, event bus,
  progress service, collectors, snapshotter, job queue.
- `packages/core` is the only layer that knows both rows and the pure engine.
  `buildGoalInput` maps rows → facts; nothing in `packages/intelligence` ever
  sees a row.
- **Snapshots start at M4 and cannot be backfilled honestly.** Every goal gets a
  row every day, including unmeasurable ones — with the reason.
- Collectors are pure `(period, data)` functions, which is what makes the same
  code compute today and rebuild two years. Return `null` for "no data", never
  `0`.
- Re-running a collector is safe: readings dedupe on
  `(metric, at, source, component)` and collectors stamp `at` at the period
  start.
- Use `createTestCore()` from `packages/core/src/testing.js` — real libSQL,
  real migrations, controllable clock.

## API notes (M5)

- Procedures come in four levels: `publicProcedure` (health, auth status,
  login), `protectedProcedure` (read), `captureProcedure` (record observations),
  `fullProcedure` (structural change and deletion).
- `crudRouter` in `apps/api/src/routers/crud.ts` covers the objects where CRUD
  is the whole story. It is **generic over the row type** — do not let it
  degrade to `unknown` or the web client loses its end-to-end types.
- Goals, metrics, relations, and progress are hand-written because they have
  real behaviour.
- Search is FTS5 maintained by triggers created in `ensureSearchIndex`. After
  adding a searchable table, add it to `SEARCHABLE` in `packages/db/src/search.ts`.
- `createTestApi()` from `apps/api/src/testing.ts` gives callers at any scope
  without a cookie round-trip.
- The API does **not** migrate on boot — `npm run db:migrate` is a setup step,
  so a mistyped `DATABASE_URL` cannot quietly create an empty database. Startup
  checks for the schema and exits 1 naming the fix; without that check the first
  symptom is an FTS trigger failing on a missing table.

## Web notes (M6)

- `apps/web` is a hash-routed SPA; there is no router library yet (five
  destinations did not justify one). It moves to TanStack Router in Phase 2 when
  routes carry real state.
- Tailwind v4 reads the design tokens from `styles/tokens.css` via `@theme
  inline`, so tokens stay the single source of truth (docs/05).
- Numbers render through `components/metric.tsx` — tabular figures, and
  animation *from the previous value*, never from zero.
- The progress-model editor never recomputes locally. Weights write to the
  relation and the number comes back from the engine; a second implementation
  would drift from the first.
- `crudRouter` takes an `afterWrite` hook for emitting domain events. Do not try
  to override a generated procedure via `mergeRouters` — it throws
  `Duplicate key` at startup.
- Metric values are plain numbers; only `transactions.amountMinor` and
  `accounts.balanceMinor` are minor units. `currencyAmount()` vs `money()`.

## Trajectory notes (M7)

- `computeTrajectory(input)` is pure and takes the snapshot series. The honesty
  gates live there, not in the UI: fewer than 5 snapshots, a dead velocity, or a
  passed target date each return `projection.available: false` **with a reason**,
  and the reason is what gets rendered.
- `paceRatio` is `null` for anything undated. That null is meaningful — branch
  on it rather than defaulting it to a number.
- **Never backfill snapshots.** Progress is computed from the readings that
  exist now, so writing one for a past date invents history. The scheduler
  snapshots today only; missed days stay empty.
- For a momentum goal, `stalled` means the activity stopped — not that the score
  is flat. A steady shipper has a constant momentum score.
- The trajectory chart takes `scale: 'momentum'` to label the axis in multiples.
  A momentum series must never be drawn as a percentage.

## Hardening notes (M8)

- Performance budgets live in `packages/core/src/performance.test.ts` and print
  the measured figure on failure. If one starts failing, find the query storm;
  do not raise the threshold.
- Two backup mechanisms, and they are not interchangeable: `VACUUM INTO` for
  recovery (exact, includes secrets, stays local), JSON export for ownership
  (readable, checksummed, excludes credentials and sessions).
- Import validates before writing, runs in one transaction, and snapshots first.
- Refusals log at `info`. Only genuine faults log at `error`.
- A tRPC **query** puts its input in the URL. Anything carrying a payload of
  unbounded size must be a mutation even when it reads nothing.

## Reachability notes (M9)

- **Currency collectors return major units.** Storage is integer minor units;
  metrics are plain numbers. `toMajor` in `collectors/builtin.ts` is the one
  crossing point — without it a goal reports 100× its real progress.
- **A decomposed metric's value is the sum of its components' latest readings**,
  and its `lastReadingAt` is the *oldest* of them: a metric is only as current
  as the part that stopped being fed.
- The engine refuses a whole-metric reading once a metric has components, so
  never offer one in the UI.
- **A compounding projection stores only the assumption** (rate, contribution,
  scenarios). `current` and `target` are read from the metric at compute time by
  `resolveProjection`; storing copies would let the projection drift from the
  readings. `StoredProjectionModel` (domain) and `ProjectionModel`
  (intelligence) are deliberately different types.
- `metrics.update` accepts everything `metrics.create` does. When they diverge,
  a field becomes settable once and then unreachable forever.
- CSV import is a **mutation** and always previews before writing. Amount
  parsing disambiguates `45,000` from `1.234,56` by counting digits after the
  separator — three means grouping.

## Current state

**Phase 1 complete — M1 through M8. Phase 2 M9 complete.** 286 tests green.

M9 closed the reachability gap from `docs/15`: finance screens with CSV import,
collector configuration and backfill, metric component decomposition,
projection configuration, `expectedRate`, theme attachment, and metric preview.
All four real goals are now enterable through the interface.

Next is **Phase 2 — Visualization** (`docs/12-phase-plan.md`): the full visual
system, the motion layer, the neural graph, the dashboard builder, and the Tauri
wrapper.

Two things still open before Phase 2 starts:
- Passkeys remain unbuilt — `docs/13` D11 recommends Phase 5, with mobile.
- `docs/13` D9 asks for your real goals. Phase 1 can now hold them, and using it
  for a fortnight would say more about what Phase 2 should be than any plan.

Snapshots are now being written (M4). The series they build is the only input
trajectory has, and it cannot be reconstructed — so never "temporarily" disable
the snapshot job to speed something up.
