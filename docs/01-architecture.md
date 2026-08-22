# 01 — System Architecture

## 1. Machine constraints (verified 2026-08-20)

| Fact | Consequence |
|---|---|
| Windows 11, Node v24.18, npm 11.6 | Node-native toolchain, no POSIX assumptions |
| **No Docker, no Postgres** | Embedded database is the correct default, not a compromise |
| Claude Code 2.1.216 installed | Execution layer is real and local |
| `ANTHROPIC_API_KEY` unset | Bridge auth deferred with Phase 3 (`13` D4) |
| `C:/Projects` holds ~12 real projects (React, Spring Boot, portfolio, "Samarth Strategies", "Client Project", FY Sem 5/6) | Project tracking must handle mixed stacks and paths with spaces |
| Single user, single machine | No tenancy, no sharing, no RLS. Do not build them |

## 2. Stack

| Layer | Choice | Note |
|---|---|---|
| Language | TypeScript 5.x, `strict`, `noUncheckedIndexedAccess` | |
| Monorepo | npm workspaces + Turborepo | pnpm not installed |
| Database | **libSQL embedded** (`@libsql/client`), file `data/aryesh.db` | Decided `13` D1; whole OS is one copyable file |
| ORM | Drizzle | SQL-shaped, real CTEs, migrations as code |
| API | tRPC v11 on Fastify | End-to-end types, every client is TS |
| Web | Vite + React 19 SPA, TanStack Router | Stateful visual workspace, no SSR benefit |
| App shell | Browser Phase 1 → **Tauri v2 Phase 2** (`13` D2) | Global hotkey, OS notifications, native secret store. `ShellAdapter` interface from M1 so the wrapper is additive |
| Server state | TanStack Query | |
| Charts | **visx** | Custom trajectory/progress visuals need composition, not presets (`05`) |
| Graph | **graphology + Sigma.js v3** (WebGL), layout in a Worker | Scales past SVG limits |
| Motion | Motion (Framer Motion successor) + spring physics | `05` §4 |
| Grid | `react-grid-layout` | Dashboard layout is data |
| Validation | Zod v4 | |
| Jobs | libSQL-backed queue + `node-cron` | Snapshots, metric collection, insight passes |
| Realtime | SSE for execution streams, WS for invalidation | |
| Execution | `@anthropic-ai/claude-agent-sdk` (Phase 3) | `10` |
| Auth | Argon2id + WebAuthn passkey, session cookie; device tokens for CLI | |
| Testing | Vitest (real in-memory libSQL), Playwright | |

## 3. Topology

```
┌──────────────────────────────────────────────────────────────┐
│ apps/web (Vite SPA)        apps/cli        apps/mobile (P5)  │
└───────────┬──────────────────┬──────────────────┬────────────┘
            │ tRPC + SSE       │                  │
┌───────────▼──────────────────▼──────────────────▼────────────┐
│ apps/api (Fastify, one process)                              │
│  ┌────────────────── INTELLIGENCE CORE ──────────────────┐   │
│  │ measurement engine   progress engine   snapshotter    │   │
│  │ trajectory engine    blocker analysis  insight engine │   │
│  │ decision log         attention ranker                 │   │
│  └───────────────────────────────────────────────────────┘   │
│  ┌── domain services ──┐ ┌── event bus ──┐ ┌── jobs ─────┐   │
│  │ goals projects tasks│ │ (workflow seam)│ │ cron+queue  │   │
│  │ habits finance …    │ └───────────────┘ └─────────────┘   │
│  └─────────────────────┘                                     │
│  ┌── graph projection ──┐  ┌── claude bridge (Phase 3) ──┐   │
│  └──────────────────────┘  └─────────────────────────────┘   │
└───────────┬──────────────────────────────────┬──────────────┘
            │ Drizzle                          │ spawn
┌───────────▼──────────┐         ┌─────────────▼──────────────┐
│ aryesh.db (libSQL)   │         │ Claude Code / Agent SDK    │
│ entities + readings  │         │ cwd = project path         │
│ + snapshots + audit  │         └────────────────────────────┘
└──────────────────────┘
```

The **intelligence core** is the part that matters and the part worth testing
hardest. It is pure logic over data: given readings, goals, and relations,
produce progress, trajectory, blockers, and ranked attention. It has no
dependency on the database, the API, or Claude — it takes inputs and returns
values, which makes it exhaustively unit-testable without fixtures or mocks.

## 4. Where the loop runs

| Step | Trigger | Component |
|---|---|---|
| Observe | User entry, scheduled collector, execution outcome | `measurement` |
| Measure | On write (event) + nightly snapshot | `progress`, `snapshotter` |
| Understand | Nightly + on significant change | `trajectory`, `blockers`, `insights` |
| Visualize | On read | `web` |
| Decide | User action | `decisions`, `attention` |
| Act | User, or Claude via bridge | `agent` |

**Event-triggered, not clock-triggered**, wherever the cost is non-trivial. A
scheduled hourly AI pass costs real money to discover that nothing changed
(`13` D4). Cheap deterministic work (progress recompute) runs on events; the
expensive AI pass runs when deterministic analysis finds something worth
explaining.

## 5. Cross-cutting

**Events.** One typed in-process bus: `reading.recorded`, `goal.changed`,
`project.changed`, `snapshot.written`, `insight.raised`, `decision.made`. The
progress engine, insight engine, and cache invalidation subscribe. This is also
the **workflow seam** — when automations arrive in Phase 4, they subscribe to
the same bus and need no changes to anything upstream.

**Explainability is a return type, not a log.** Engine functions return values
*with* their derivation:

```ts
interface Explained<T> {
  value: T
  inputs: { ref: EntityRef; label: string; value: number; weight: number }[]
  method: string          // 'weighted-mean' | 'ewma-projection' | ...
  confidence: number      // 0..1
  caveats: string[]       // 'metric stale 14d', 'only 3 data points'
}
```

Every computed number in the UI can be clicked to show exactly this. Design rule
3 is enforced by the type system rather than by discipline.

**Errors.** One `AppError` hierarchy with stable codes. Never throw strings.

**Testing.** The intelligence core gets property-based tests (progress is
monotonic in contributor progress; normalisation always sums to 1; projection is
stable under reordering). Integration tests run against real in-memory libSQL.

## 6. Performance budgets

| Operation | Budget |
|---|---|
| Cold load → interactive | < 1.5 s |
| Home dashboard, warm | < 400 ms |
| Progress recompute, one goal tree | < 20 ms |
| Full nightly snapshot, 200 goals + 300 metrics | < 5 s |
| Graph projection, 2 000 nodes | < 150 ms |
| Trajectory chart, 2 years daily | < 100 ms |
| Command palette keystroke → results | < 30 ms |
| Sustained graph interaction | 60 fps |

The 60 fps line is a product requirement, not an engineering nicety — a graph
that stutters reads as broken regardless of how correct its data is.

## 7. Privacy

Local-first. Only outbound traffic is the Anthropic API via the bridge. Secrets
live in an encrypted store (DPAPI via Tauri in Phase 2; `age`-encrypted keyfile
before that), referenced by handle, never stored as data. Any field or metric
may be marked `private`, which excludes it from AI context. Redaction at the
model boundary is a pure, separately-tested function, and the exact payload sent
is inspectable in the UI.

## 8. Not building

Multi-user, sharing, collaboration, plugin marketplace, offline sync, generic
integrations, email/calendar sync, a no-code platform. Automations are deferred
to Phase 4 behind the event-bus seam.
