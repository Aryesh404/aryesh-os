# 11 — Repository Structure

```
aryesh-os/
├─ apps/
│  ├─ api/                     # Fastify + tRPC — the only door
│  │  └─ src/{routers,sse,auth,jobs}/
│  ├─ web/                     # Vite + React 19 SPA
│  │  └─ src/{routes,features,components,palette,lib}/
│  │      features/ → trajectory/ goals/ metrics/ graph/ dashboard/
│  │                  decisions/ insights/ finance/ projects/ executions/
│  ├─ cli/                     # `aryesh` (Phase 5)
│  └─ mobile/                  # Expo (Phase 5)
│
├─ packages/
│  ├─ intelligence/            # ★ PURE. The product's brain. No I/O.
│  │  ├─ progress/             #   weighted contributors, normalisation (03 §4)
│  │  ├─ trajectory/           #   velocity, projection, honesty gates (04 §1–3)
│  │  ├─ attention/            #   allocation analysis (04 §4)
│  │  ├─ blockers/             #   detectors (04 §5)
│  │  ├─ ranking/              #   what-matters-now (04 §7)
│  │  ├─ expressions/          #   derived-metric language (03 §3)
│  │  └─ explain/              #   Explained<T> construction
│  ├─ domain/                  # Types, enums, relation rules, validation (pure)
│  ├─ db/                      # Drizzle schema, migrations, repositories
│  ├─ core/                    # Services: composes intelligence + db + events
│  │  └─ {services,events,collectors,snapshotter,insights,audit}/
│  ├─ agent/                   # Claude bridge, MCP server, permissions (Phase 3)
│  ├─ contracts/               # tRPC types, DTOs, error codes
│  ├─ viz/                     # ★ Chart primitives (visx): trajectory, rings,
│  │                           #   breakdown, allocation, sparkline (05 §5)
│  ├─ graph/                   # Projection, layout worker, Sigma programs (06)
│  └─ ui/                      # Design system: tokens, motion, primitives (05)
│
├─ docs/                       # These documents (+ _superseded/)
├─ data/                       # gitignored: aryesh.db, backups/, snapshots/, logs/
└─ turbo.json  package.json  CLAUDE.md  .env.example
```

## Dependency rule

```
domain ← intelligence
   ↑          ↑
   └── db ← core ← agent
              ↑      ↑
        contracts ───┴──→ api → { web, cli, mobile }
                    ui, viz, graph ──→ web
```

**`packages/intelligence` imports nothing but `domain`.** No database, no
network, no clock it doesn't receive as a parameter. Given readings, goals, and
relations, it returns progress, trajectory, blockers, and rankings — pure
functions all the way down.

This is the most important structural decision in the repo. It means the part of
the system that must be *correct* can be tested exhaustively with property-based
tests and fixtures, without a database, without mocks, and without time-travel
hacks. Everything else is plumbing around it.

Enforced in `eslint.config.js` with per-package `no-restricted-imports`
overrides rather than `eslint-plugin-boundaries`: one fewer dependency, no
module-resolution guesswork across workspace symlinks, and the rule reads as
the rule. A violation fails `npm run lint` with a message pointing back here.

Shared tsconfig/eslint/vitest presets live at the repo root rather than in a
`packages/config` package — in a single private monorepo that indirection buys
nothing (design rule 6).

## Conventions

- **File size**: soft 300 lines, hard 500.
- **Naming**: `kebab-case` files, `PascalCase` components/types, `camelCase`
  values. One primary export per file. No default exports outside routes.
- **Barrels** only at package roots.
- **Tests** beside code as `*.test.ts`; e2e in `apps/web/e2e`.
- **Money**: integer minor units + currency code. Never a float.
- **Dates**: UTC epoch ms in storage; formatted only at the edge.
- **Time is injected.** Any function whose result depends on "now" takes a
  `now: number` parameter. Non-negotiable — trajectory logic is untestable
  otherwise.
- **Errors**: `AppError` subclasses with stable codes.
- **Numbers in the UI** render through one `<Metric>` component that owns tabular
  figures, unit formatting, and delta animation (`05` §2).

## Tooling

Turborepo (task graph + caching), Vitest with `fast-check` for property tests,
Playwright for e2e, ESLint (flat config), Prettier, `tsx`,
Drizzle Kit.

## CLAUDE.md

Written at M1. Carries the design rules from `00`, the dependency rule above,
the honesty rules from `04` §9, and the build/test/typecheck commands — so every
future Claude Code session on this repo inherits them.
