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

## Current state

Phase 1 · **M1, M2, M3 complete.** 149 tests green. Next: **M4 — snapshots,
collectors, jobs** (`docs/12-phase-plan.md`).

**M4 is next, and it starts writing snapshots — which cannot be backfilled
honestly later.** A goal whose model changed last month cannot have last
month's progress reconstructed. It is a 2-day milestone that everything in
docs/04 depends on; do not let it slip behind the visible UI work.
