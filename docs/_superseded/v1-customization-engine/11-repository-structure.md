# 11 — Repository Structure

```
aryesh-os/
├─ apps/
│  ├─ api/                  # Fastify + tRPC — the only door (R7)
│  │  ├─ src/
│  │  │  ├─ routers/        # one file per domain: entities, schema, graph, memory…
│  │  │  ├─ rest/           # OpenAPI facade for external automation
│  │  │  ├─ sse/            # execution + invalidation streams
│  │  │  ├─ auth/           # sessions, passkeys, device tokens
│  │  │  ├─ jobs/           # durable queue + cron registrations
│  │  │  └─ server.ts
│  ├─ web/                  # Vite + React 19 SPA
│  │  ├─ src/
│  │  │  ├─ routes/         # TanStack Router file routes
│  │  │  ├─ features/       # graph/ dashboard/ entities/ memory/ executions/ schema/
│  │  │  ├─ components/     # generic, feature-agnostic
│  │  │  ├─ palette/        # command center
│  │  │  └─ lib/
│  ├─ cli/                  # `aryesh` — same API, no private logic
│  └─ mobile/               # Expo — Phase 6, deliberately thin
│
├─ packages/
│  ├─ domain/               # PURE. Types, traits, progress, formula eval, permissions.
│  │  ├─ entities/ fields/ relations/ traits/ progress/ formula/
│  │  ├─ permissions/ memory/ workflow/ query/     # the shared filter DSL lives here
│  │  └─ (no imports from db, api, or web — enforced by lint)
│  ├─ db/                   # Drizzle schema, migrations, repositories, seed packs
│  ├─ core/                 # Services composing domain + db + events
│  │  ├─ services/ events/ audit/ config-versioning/ redaction/
│  ├─ agent/                # Claude bridge, orchestrator, MCP server, context packs
│  ├─ contracts/            # tRPC router types, Zod DTOs, shared error codes
│  ├─ fields/               # Field-type registry: one directory per kind (UI + logic)
│  ├─ widgets/              # Widget registry: one directory per kind
│  ├─ graph/                # Projection, layout worker, Sigma programs, style engine
│  ├─ ui/                   # Design system: tokens, primitives, dark theme
│  └─ config/               # tsconfig, eslint, vitest presets
│
├─ seed/aryesh-default/     # The default pack (02 §6) — data, not code
├─ docs/                    # These documents + ADRs
├─ data/                    # gitignored: aryesh.db, files/, snapshots/, backups/, logs/
└─ turbo.json  package.json  .env.example
```

## Dependency rule

```
domain  ←  db  ←  core  ←  agent
   ↑                ↑        ↑
contracts ──────────┴────────┴──→ api → { web, cli, mobile }
                    fields, widgets, graph, ui → web
```

`packages/domain` imports nothing from the rest of the repo. It is pure
TypeScript with Zod, fully unit-testable without a database, and it is where the
trait registry, progress engine, formula evaluator, permission evaluator, and
filter DSL live. If those five are pure and well-tested, the system's hardest
logic is also its most verifiable.

The rule is enforced mechanically (`eslint-plugin-boundaries`), not socially. It
is the only thing standing between this design and a `core` package that
gradually absorbs everything.

## Conventions

- **File size**: soft limit 300 lines, hard 500. A registry entry that outgrows
  it splits into `logic.ts` / `components.tsx` / `schema.ts`.
- **Naming**: `kebab-case` files, `PascalCase` components and types,
  `camelCase` values. One primary export per file.
- **Barrels** only at package roots — never inside, to keep circular imports and
  bundle bloat out.
- **Tests** live beside the code as `*.test.ts`; e2e lives in `apps/web/e2e`.
- **No default exports** except route modules and React pages.
- **Errors**: every thrown error is an `AppError` subclass with a stable code.
- **Dates**: stored as UTC epoch ms integers; formatted at the edge only.
- **Money**: integer minor units plus a currency code. Never a float, anywhere.

## Tooling

| Tool | Use |
|---|---|
| Turborepo | Task graph, caching (`build`, `test`, `lint`, `typecheck`) |
| Vitest | Unit + integration; libSQL `:memory:` for real DB tests |
| Playwright | e2e against a seeded database |
| ESLint + `eslint-plugin-boundaries` | Dependency rules and the §9 anti-patterns in `04` |
| Prettier | Formatting, non-negotiable |
| `tsx` | Dev runner for the API |
| Drizzle Kit | Migration generation |
| changesets | Version + changelog once there is anything to release |

## Repo `CLAUDE.md`

The repository will carry its own `CLAUDE.md` (written at the start of Phase 1)
so that every future Claude Code session on this codebase inherits: the
architectural rules R1–R7, the dependency rule, the anti-pattern list from
`04` §9, and the commands for build/test/typecheck. The system that orchestrates
Claude should be the best-documented repo Claude ever works in.
