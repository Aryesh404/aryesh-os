# 01 — System Architecture

## 1. Constraints discovered on this machine

| Fact | Consequence |
|---|---|
| Windows 11, Node v24.18, npm 11.6, Python 3.13 | Node-native toolchain; no POSIX-only assumptions in paths or scripts |
| **No Docker, no Postgres installed** | An embedded database is not a compromise here — it is the correct default. See §3 |
| Claude Code 2.1.216 installed | The Agent SDK / CLI is present. The execution engine is real, not an aspiration |
| `ANTHROPIC_API_KEY` not in env | Auth for the bridge must be resolved explicitly — see `13-open-decisions.md` D4 |
| `C:/Projects` holds ~12 real projects incl. React, Spring Boot, a portfolio, "Samarth Strategies", "Client Project", FY Sem 5/6 | Project Intelligence must handle heterogeneous stacks (JS + JVM), local paths containing spaces, and non-git folders |
| Single user, single machine, personal data | No multi-tenancy, no org model, no row-level security. Do not build them. |

The single-user constraint is a gift. It removes tenancy, sharding, inter-person
permission matrices, and most caching. Spend that budget on the graph, the
customization engine, and the Claude bridge instead.

## 2. Architectural rules (non-negotiable)

Every later decision is held against these.

1. **R1 — Config over code.** If a behaviour could reasonably be expressed as user
   configuration, it is stored as data, not written as a branch in code. Adding a
   field, status, dashboard, widget, view, relation type, workflow or agent must
   never require a code change or a database migration.
2. **R2 — Code attaches meaning through traits, not type names.** No code anywhere
   may branch on `entityType.key === 'project'`. It may branch on "this entity
   type has the `progress` trait". See `02-domain-model.md` §4.
3. **R3 — Nothing is destroyed silently.** Every config mutation is versioned,
   every entity delete is soft, every AI-caused change is attributable.
4. **R4 — The AI never mutates configuration or preference silently.** Agents
   propose; the user accepts. A proposal is a first-class record with a
   pending / accepted / rejected state.
5. **R5 — Secrets never enter the entity, memory, or graph substrate.** Separate
   store, separate code path, redaction at the model boundary. See §8.
6. **R6 — Every AI-visible surface is inspectable.** If Claude can read it, the UI
   can render it. There is no hidden context.
7. **R7 — The API is the only door.** Web, CLI, and mobile are peer clients of one
   typed API. No client-only business logic.

## 3. Stack decisions

| Layer | Decision | Why this, and not the obvious alternative |
|---|---|---|
| Language | TypeScript 5.x, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | Required by brief §29 |
| Monorepo | npm workspaces + Turborepo | pnpm isn't installed; npm workspaces are adequate at this scale. Turbo for the task graph and caching |
| Database | **libSQL (SQLite-compatible), embedded file** via `@libsql/client` | No Docker on this machine. Single user means concurrency is a non-issue. The entire OS becomes one file you can copy — data-ownership (brief §27) solved for free. libSQL adds native `F32_BLOB` vector columns with an ANN index, so memory embeddings need no extension (a genuine pain point for `sqlite-vec` on Windows), and it offers an optional remote-sync path for mobile later without changing drivers |
| ORM | Drizzle ORM | First-class libSQL support, SQL-shaped so we can write real recursive CTEs for graph traversal, migrations as code, zero runtime overhead. Prisma's generated client fights dynamic JSON schemas |
| API transport | **tRPC v11** on Fastify + a thin REST/OpenAPI facade | Every client is TypeScript, so tRPC gives end-to-end types with no codegen step. The REST facade exists only for external automation and webhooks |
| Web app | **Vite + React 19 SPA**, TanStack Router | Not Next.js. No SEO, no public content, no SSR benefit — this is a stateful WebGL workspace behind a login. A server-component boundary would add friction to a graph-heavy client app in exchange for nothing |
| App shell | Browser in Phase 1; **Tauri v2 wrapper from Phase 2** (decided, `13` D2) | Adds a global hotkey, OS notifications for approvals, tray presence, and native DPAPI secret storage — none of which a browser tab can provide. React code is unchanged. Phase 1 therefore puts hotkeys, notifications, and secret access behind a `ShellAdapter` interface with a browser implementation, so the wrapper is additive rather than a refactor |
| Server state | TanStack Query | Invalidation, optimistic updates, request dedupe |
| Client state | Zustand, ephemeral UI only | Hard rule: anything that survives a refresh belongs in the database, not a store (R1) |
| Graph render | **graphology (model) + Sigma.js v3 (WebGL)**, ForceAtlas2 layout in a Web Worker | The brief demands thousands of nodes stay usable. SVG-based options (d3-selection, React Flow) degrade badly past ~1–2k nodes; Sigma handles 50k+. graphology gives a real graph library — traversal, metrics, layouts — instead of a bag of coordinates |
| Dashboard grid | `react-grid-layout` | Proven drag/resize/responsive with a serialisable layout. Layout is data (R1) |
| Validation | Zod v4 | Shared across API, forms, and *dynamically compiled* from field definitions (`04` §3) |
| Forms | React Hook Form + dynamic Zod resolver | Field-definition-driven rendering |
| Styling | Tailwind v4 with CSS custom properties for theme tokens | The theme is config: tokens live in the DB and are injected as CSS variables |
| Charts | visx — see `13-open-decisions.md` D6 | |
| Jobs | In-process durable queue backed by libSQL + `node-cron` | A Redis/BullMQ dependency is unjustifiable for one user on one machine |
| Realtime | SSE for execution streams, one WebSocket for cache invalidation | SSE fits token/tool-event streaming, survives proxies, and reconnects natively |
| AI execution | **`@anthropic-ai/claude-agent-sdk`**, subprocess per execution, plus a custom MCP server exposing Aryesh OS back to Claude | See `07-claude-bridge.md` |
| Auth | Argon2id password + WebAuthn passkey, httpOnly session cookie; scoped device tokens for CLI and mobile | Single user, but mobile access over a tunnel needs real auth |
| Testing | Vitest (unit + integration against real in-memory libSQL), Playwright (e2e) | For a schema this dynamic, mocking the DB tests nothing |
| Logging | Pino to rotating files plus an in-app log viewer | Observability is a product surface here, not just ops |

**Escape hatch.** The storage decision is contained. All SQL lives in
`packages/db` behind repository interfaces, and the Drizzle schema is written so
a Postgres port is a driver + dialect change plus a vector-store swap — not a
rewrite. If the dataset outgrows SQLite (it will not, for one person), that
migration is a day's work, not a quarter's.

## 4. Topology

```
┌───────────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                              │
│  apps/web (Vite SPA)    apps/cli (aryesh)    apps/mobile (Expo)       │
└──────────┬──────────────────┬────────────────────┬───────────────────┘
           │ tRPC/HTTP + SSE  │ tRPC over HTTP     │ tRPC + push
┌──────────▼──────────────────▼────────────────────▼───────────────────┐
│  apps/api  (Fastify, single Node process)                            │
│  ┌────────────┬─────────────┬──────────────┬──────────────────────┐  │
│  │ tRPC router│ REST facade │ SSE hub      │ auth / session       │  │
│  └────────────┴─────────────┴──────────────┴──────────────────────┘  │
│  ┌──────────────────────────── CORE ─────────────────────────────┐   │
│  │ entity svc │ schema svc │ relation svc │ view svc │ dashboard  │   │
│  │ memory svc │ progress engine │ workflow engine │ event bus     │   │
│  │ permission + allowance engine │ audit │ config versioning      │   │
│  └───────────────────────────────────────────────────────────────┘   │
│  ┌───────────── CLAUDE BRIDGE ──────────┐  ┌──── JOB RUNNER ─────┐   │
│  │ orchestrator → agent runtime         │  │ cron, retries,      │   │
│  │ Agent SDK subprocess per execution   │  │ durable queue       │   │
│  │ canUseTool → allowance engine        │  └─────────────────────┘   │
│  │ aryesh-os MCP server (tools back in) │                            │
│  └──────────────────────────────────────┘                            │
└──────────┬────────────────────────────────────────┬──────────────────┘
           │ Drizzle                                │ spawn
┌──────────▼──────────────┐            ┌────────────▼──────────────────┐
│ aryesh.db (libSQL file) │            │ Claude Code / Agent SDK       │
│ + vectors + audit + WAL │            │ working dir = project path    │
└─────────────────────────┘            └───────────────────────────────┘
┌─────────────────────────┐
│ secrets store (DPAPI or │  ← never touched by entity, memory, or graph code
│ age-encrypted keyfile)  │
└─────────────────────────┘
```

One API process. One database file. The complexity lives in the domain layer,
which is where it earns its keep.

## 5. The core loop as data flow

```
SEE        graph.project(viewId) → subgraph → Sigma
UNDERSTAND memory retrieval + progress engine → insight records
DECIDE     Planner agent → ExecutionRequest{objective, plan[], contextPack}
ALLOW      allowance engine evaluates every planned action
           ├ auto-allowed  → proceed
           └ needs consent → approval queue → web/mobile/CLI → decision
EXECUTE    bridge spawns the Agent SDK; every tool call is re-checked at runtime
           through canUseTool — plan-time approval is not a blank cheque
MEASURE    execution result → entity writeback → progress recompute → events
ADAPT      memory writeback as proposals, never as silent facts (R4)
```

## 6. Cross-cutting concerns

**Errors.** One `AppError` hierarchy carrying a stable `code`, a user-facing
message, and machine-readable `details`. The tRPC error formatter maps these to
typed client errors. Never throw strings; never swallow.

**Validation.** Zod at every boundary — API input, workflow definitions, widget
configs, agent definitions — and dynamically compiled validators for
user-defined fields (`04` §3).

**Events.** One in-process typed event bus (`entity.created`, `entity.updated`,
`relation.created`, `execution.completed`, `config.changed`, …). The progress
engine, workflow engine, memory writeback, insight generation, and SSE
invalidation are all subscribers. This is what stops those subsystems from
calling each other directly and fusing into a ball of mud.

**Config versioning.** Every write to a configuration table (entity types,
fields, views, dashboards, workflows, agents, permissions, graph views, theme)
emits a revision holding the JSON patch and the actor. Undo applies the inverse.

**Testing.** Domain services run against a real in-memory libSQL instance.
Contract tests for the field-type registry and the widget registry. Playwright
covers three journeys end-to-end: define a custom entity type, build a
dashboard, run an execution that requires an approval.

**Logging.** Structured Pino with a correlation id per request and per
execution. Execution logs are user-visible records, not just files (R6).

## 7. Performance budgets (targets, asserted in tests)

| Operation | Budget |
|---|---|
| Cold load → interactive shell | < 1.5 s |
| Dashboard, 12 widgets, warm | < 400 ms |
| Graph projection, 2 000 nodes, server side | < 150 ms |
| Graph first paint after projection | < 500 ms |
| Layout stabilisation, 2 000 nodes, in worker | < 3 s, never blocking |
| Entity list, 50 k rows, filtered + paged | < 100 ms |
| Command palette keystroke → results | < 30 ms |

## 8. Security and privacy posture

- **Secrets** live in a dedicated encrypted store (Windows DPAPI through a small
  shim, or an `age`-encrypted keyfile unlocked at startup). They are referenced
  by handle — `secret://anthropic-key` — never by value, and resolved at the last
  possible moment. Handles are opaque in the UI.
- **Redaction at the model boundary.** Every context pack passes through a
  redactor: secret handles, entities and fields tagged sensitive, plus a
  configurable regex + entropy scan. The redactor is a pure function with its own
  test suite, and the UI can show the exact payload that left the machine.
- **Field-level sensitivity.** Any field definition may set
  `sensitivity: none | private | secret`. `private` is stored plainly but excluded
  from AI context by default. `secret` is rejected at definition time — use the
  secret store.
- **Local by default.** The only outbound traffic is to the Anthropic API through
  the bridge. Nothing else phones home.
- **Transport.** Loopback HTTP on the desktop. Mobile access requires a Tailscale
  or Cloudflare tunnel plus a passkey — never a naked port on the LAN.

## 9. Deliberately excluded

Multi-user, roles and sharing, real-time collaboration, a plugin marketplace,
offline CRDT sync, self-hosted model serving, generic OAuth integrations, and
email/calendar sync. Each is a plausible future; none serves the core loop in
v1. They are not amputated — the primitives leave room for every one of them
(`02` §7) — they are simply not now.
