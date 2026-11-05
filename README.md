# Aryesh OS

A personal progress intelligence system. Not a productivity app — a system that
measures whether a life is actually advancing, and says so honestly.

```
OBSERVE ──→ MEASURE ──→ UNDERSTAND ──→ VISUALIZE ──→ DECIDE ──→ ACT ──┐
   ▲                                                                   │
   └───────────────────────── measure again ───────────────────────────┘
```

It answers four questions, across personal, career, business, finance, projects,
and long-term goals:

1. **How am I actually progressing?** — advancement, not activity
2. **Am I on trajectory to hit what I said I'd hit?**
3. **What is slowing me down?**
4. **What should I do next, and why?**

## Status

The measurement backend, domain storage, authentication, finance, search, and
data-management workflows are implemented. The first UI redesign slice now adds
a calmer dark workspace, responsive navigation, daily priorities and habit
check-ins, Quick Add, and an overview-first goal detail.

**Approved design (2026-11-05):** the previewed workspace is integrated into the
normal application, including the AS logo and live IST clock. It uses your
configured database and existing authentication; no preview flag is required.
The wider screen rollout and browser visual acceptance remain pending. See
[the delivery guide](docs/17-workspace-review.md) for scope and verification.

## Quick start

```bash
npm install
npm run db:migrate
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4317

For an isolated redesign preview, run `npm.cmd run review` and open
http://localhost:5174. The banner switches between populated and empty examples.
It uses fictional in-memory data; your personal database is never opened.

```bash
npm run ci          # lint + typecheck + test + build
npm run auth:reset  # forgot the password — local only, prompts for a new one
```

## Design commitments

**Advancement, not activity.** Closing tasks is motion. A metric moving toward a
target is distance. Task completion never becomes goal progress without an
explicit weighted edge.

**Honest over impressive.** The engine refuses to project from fewer than five
data points, never draws a point estimate without its uncertainty band, and
degrades confidence rather than presenting stale data as current. One confident
wrong number destroys trust in every other number in the system.

**Not everything is a percentage.** "Become a stronger engineer" has no
denominator. Goals are measured in `completion` mode or `momentum` mode, and
momentum goals report rate and activity — never an invented percent.

**Every number is explainable.** Computations return their derivation alongside
their value, so any figure can be drilled into: what produced it, from what
inputs, at what confidence.

## Architecture

| | |
|---|---|
| Language | TypeScript, `strict` + `exactOptionalPropertyTypes` |
| Monorepo | npm workspaces + Turborepo |
| Storage | libSQL (embedded SQLite) + Drizzle — the whole OS is one copyable file |
| API | Fastify + tRPC v11 — the only door; web, CLI, mobile are peer clients |
| Web | Vite + React 19; Tauri shell from Phase 2 |
| Graph | Deferred; proposed graphology + Sigma.js |
| Charts | Responsive SVG trajectory chart |

`packages/intelligence` — the progress, trajectory, blocker, and ranking engine
— is **pure**: no I/O, no network, not even a clock it doesn't receive as a
parameter. It is the part that must be correct, so it is the part that can be
tested exhaustively without mocks. Lint enforces this.

## Documentation

The [`docs/`](docs/00-index.md) directory is the specification, not a
description written afterwards.

| | |
|---|---|
| [02](docs/02-domain-model.md) · [03](docs/03-measurement-engine.md) · [04](docs/04-trajectory-and-decisions.md) | The product: domain, measurement, trajectory & decisions |
| [05](docs/05-visual-system.md) | Visual system — colour, motion, chart specs |
| [14](docs/14-model-validation.md) | The engine stress-tested against four real goals |
| [12](docs/12-phase-plan.md) · [13](docs/13-open-decisions.md) | Plan and open decisions |
