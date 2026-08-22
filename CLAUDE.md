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
  differ. Zod-inferred optionals need the explicit `| undefined`.

## Current state

Phase 1 · **M1 complete** (skeleton). Next: **M2 — domain & storage**
(`docs/12-phase-plan.md`). M4 starts writing snapshots, which cannot be
backfilled honestly later — do not let it slip.
