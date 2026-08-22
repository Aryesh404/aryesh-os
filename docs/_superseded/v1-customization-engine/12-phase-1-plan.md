# 12 — Phase 1 Implementation Plan

**Goal of Phase 1:** the customization engine, working end to end, proven by
deleting the seed pack and rebuilding a working system from an empty schema
through the UI alone.

Not "goals and projects exist". The engine exists, and goals and projects happen
to be seeded onto it.

## Milestones

### M1 — Skeleton (≈2 days)
Monorepo, Turbo, tsconfig presets, ESLint with boundary rules, Vitest, Fastify +
tRPC hello-world, Vite shell with the dark theme, libSQL connection, Drizzle
migration runner, `CLAUDE.md`, `.env.example`.

Plus the **`ShellAdapter` interface** (`13` D2): global hotkey registration,
notifications, and secret read/write, with a browser implementation now and a
Tauri implementation in Phase 2. Three methods, written once, so the desktop
wrapper is additive rather than a refactor.

*Done when:* `npm run dev` starts API + web, `npm run typecheck && npm test`
passes in CI, and a boundary violation actually fails lint.

### M2 — Primitives & storage (≈4 days)
`entity_types`, `fields`, `entities`, `relation_types`, `relations` tables.
Repositories. The field-type registry with all 18 kinds (logic + Zod, no UI yet).
Dynamic schema compilation and caching. Entity CRUD with validation, soft delete,
versioning, optimistic concurrency. Relation CRUD with constraint checking. The
event bus. Audit + revision writing on every mutation.

*Done when:* integration tests create a type, add each of the 18 field kinds,
write and read entities against a real libSQL instance, and every mutation
produces an audit row and a revision.

### M3 — Traits & the progress engine (≈3 days)
Trait registry with the v1 traits (`02` §4). Role mapping and unsatisfied-trait
degradation. The progress engine (`02` §9): contribution graph, weight
normalisation, cycle detection, caching, event-driven recomputation. Formula
evaluator with its parser, whitelist, step budget, and dependency graph.

*Done when:* a nested goal tree with weighted mixed contributors computes correct
progress; a cycle is rejected at definition time with the path shown; changing a
task's status recomputes the ancestor goal within one event tick.

### M4 — Auth & API surface (≈2 days)
Argon2id password login, session cookies, WebAuthn passkey registration, device
tokens for CLI. tRPC routers for schema, entities, relations, search. FTS5
indexing. Keyset pagination. Error mapping. Rate limiting on auth.

*Done when:* the API is unusable unauthenticated, a passkey works, and a device
token authenticates a scripted request.

### M5 — Schema Studio (≈5 days)
The UI for the engine, and the milestone that actually proves R1: create/edit/
delete entity types; add/reorder/rename/retype fields with per-kind config
editors; manage select options with semantics; define relation types; assign
traits and map roles; impact analysis before destructive changes; revision
history with diffs; undo; Trash with restore.

*Done when:* **a new entity type with six field kinds, two relations, and a
working view can be built entirely through the UI, with zero code changes and
zero migrations** — and then renamed and restructured without data loss.

### M6 — Generic entity UI (≈4 days)
Dynamic form rendering from field definitions. Table and list views with
filtering (the shared DSL), sorting, grouping, inline edit. Entity detail with
relation management. Global search. Views: create, save, set default.

*Done when:* every seeded type is fully usable through generic components only.
Grep proves no component special-cases a type key.

### M7 — Memory foundation (≈3 days)
Memory tables, CRUD, classes, FTS retrieval, entity links, the Memory view,
proposal states. Embeddings + vector retrieval **if** the provider decision (D5)
lands; otherwise FTS + graph, behind an interface with the vector path stubbed.

*Done when:* memories are creatable, searchable, editable, pinnable, exportable,
and their provenance is visible.

### M8 — Seed pack & data ownership (≈3 days)
Pack format, installer, exporter, three-way-merge updater. The
`aryesh-default` pack (`02` §6). Backup scheduler (`VACUUM INTO`), portable JSON
export, restore-with-validation.

*Done when:* a fresh database seeds into a usable OS; export → wipe → import
round-trips losslessly with checksums verified; **and the seed pack can be
uninstalled, leaving a bare but functional system.**

### M9 — Hardening (≈3 days)
Performance budgets from `01` §7 asserted against 50k seeded entities. Redaction
unit tests. Playwright journeys. Error and empty states. Structured logging with
correlation ids.

*Done when:* the budget test suite passes with a generated 50k-entity dataset.

**Total: roughly 29 working days.** Sequential where it must be — M2 gates
everything, M3 and M4 can overlap, M5 and M6 are the long pole.

## Definition of done (every milestone)

1. Types check with zero `any` and no `@ts-expect-error` without a linked issue.
2. Unit tests on domain logic; integration tests on anything touching the DB.
3. No hardcoded entity-type keys outside the seed pack loader (lint-enforced).
4. Every mutation writes audit + revision.
5. Errors are typed, surfaced, and recoverable.
6. Docs updated when a design decision changes — these documents are the
   specification, and they go stale the moment that stops being true.

## Explicitly deferred from Phase 1

Graph rendering (Phase 2 — the projection API lands in M3 but nothing draws it),
dashboards and widgets (Phase 2), Claude bridge (Phase 3), workflows (Phase 7),
finance aggregation beyond the `monetary` trait's storage (Phase 5), CLI beyond
an auth smoke test (Phase 6), mobile (Phase 6).

The temptation in Phase 1 will be to build the graph early because it is the fun
part. Resist it: the graph is a projection of the primitives, and building it
before they are stable means building it twice.

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| The JSON+generated-column approach underperforms at scale | High | **Hard gate at M2**: benchmark 50k entities before building on it. This is also the review point for D1 (libSQL vs. Postgres), which was resolved as "proceed and revisit with real data". Fallback: promote more role columns, or port behind the repository layer |
| Trait role-mapping proves too abstract to use in the UI | High | M5 is the test. If mapping is confusing, add a guided "create the fields this trait needs" flow — the model stays |
| The formula evaluator becomes a language | Medium | Fixed function whitelist; no user-defined functions in v1; ship the smallest grammar that covers the seeded formulas |
| Agent SDK API drift between now and Phase 3 | Medium | Re-verify `07` against the live reference at Phase 3 kickoff; pin the SDK version; isolate all SDK contact in `packages/agent` |
| Scope creep from the brief's breadth | High | The core-loop test in `00-index.md`. Anything failing it goes in a backlog file, not the codebase |
| Single-user assumptions become load-bearing | Low | Accepted deliberately. `ActorRef` polymorphism is the only concession made in advance |

## What Phase 1 will feel like when it works

An empty database. You open Schema Studio, create an entity type called
"Research Thread", give it five fields including a formula and a relation to
Project, tag it with the `progress` and `temporal` traits, map the roles, and
save. Without a restart, a rebuild, or a migration: it appears in the navigation,
it is creatable from the command palette, it has table and timeline views, its
progress rolls up into whatever goal you connect it to, and it is exportable.

That is the product. Everything after Phase 1 is surface area on top of it.
