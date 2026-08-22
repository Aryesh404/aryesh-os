# Aryesh OS — Architecture (v2)

Status: **Draft for approval.** No implementation code has been written.

> v2 supersedes the v1 document set, archived at
> `docs/_superseded/v1-customization-engine/`. v1 made the customization engine
> the product. That was the wrong center. See §"What changed" below.

## What Aryesh OS is

A personal progress intelligence system. It answers four questions about one
person's life, across personal, career, business, finance, projects, and
long-term goals:

1. **How am I actually progressing?** — not activity, advancement.
2. **Am I on trajectory to hit what I said I'd hit?**
3. **What is slowing me down?**
4. **What should I do next, and why?**

Everything in this architecture exists to answer one of those four. A feature
that answers none of them does not ship.

## The loop

```
OBSERVE ──→ MEASURE ──→ UNDERSTAND ──→ VISUALIZE ──→ DECIDE ──→ ACT ──┐
   ▲                                                                   │
   └───────────────────────────────────────────────────────────────────┘
                              measure again
```

| Step | What the system does | Where it lives |
|---|---|---|
| **Observe** | Capture state: metric readings, task/project state, transactions, habits | `03` |
| **Measure** | Turn observations into progress and trend — weighted, honest, explainable | `03` |
| **Understand** | Velocity, projection, blockers, attention allocation, insights | `04` |
| **Visualize** | Graph, trajectory charts, progress, insight presentation — first-class | `05`, `06`, `07` |
| **Decide** | Ranked attention, decision log with rationale, outcome review | `04` |
| **Act** | Execute — Claude Code for code work, the user for everything else | `10` |
| **Measure again** | Snapshots close the loop; outcomes are scored against decisions | `03`, `04` |

The loop closes. That is the property that makes this a system rather than a
dashboard: a decision made in step 5 is measured in step 7, and the quality of
past decisions becomes data.

## Design rules

1. **Progress intelligence is the product.** Customization serves it. Claude
   serves it. The graph serves it.
2. **Measure advancement, not activity.** A closed task is not progress. A metric
   moving toward a target is.
3. **Every number is explainable.** Any figure the system shows can be drilled
   into: what produced it, from what inputs, at what confidence.
4. **Visual quality is a requirement, not a finish.** The graph, trajectory
   charts, progress visualization, and insight presentation are the product
   surface, not decoration on top of it.
5. **Honest over impressive.** Stale data says stale. A projection with three
   data points shows its uncertainty. Confident nonsense is the failure mode
   that destroys trust in the whole system.
6. **Simplicity beats elegance.** Do not build a general mechanism where a
   specific one is clearer. Generality is earned by a second real use case.
7. **Automations are deferrable by design.** Nothing in the core may depend on
   the workflow engine that does not yet exist.

## Documents

| # | Document | Answers |
|---|---|---|
| 01 | [Architecture](01-architecture.md) | Stack, topology, what runs where |
| 02 | [Domain Model](02-domain-model.md) | The fixed objects and how they connect |
| 03 | [Measurement & Progress](03-measurement-engine.md) | **Observe + Measure — the spine** |
| 04 | [Trajectory & Decision Intelligence](04-trajectory-and-decisions.md) | **Understand + Decide** |
| 05 | [Visual System](05-visual-system.md) | **Visualize — design language, motion, charts** |
| 06 | [Neural Graph](06-graph.md) | Graph model, rendering, interaction |
| 07 | [Dashboards & Views](07-dashboards-and-views.md) | Layout, widgets, command palette |
| 08 | [Customization Scope](08-customization-scope.md) | What is customizable — and what deliberately is not |
| 09 | [Database Schema](09-database-schema.md) | Storage, tables, time series |
| 10 | [Claude Execution Layer](10-claude-execution-layer.md) | **Act** — bridge, permissions, agents |
| 11 | [Repository Structure](11-repository-structure.md) | Monorepo layout |
| 12 | [Phase Plan](12-phase-plan.md) | Milestones and sequencing |
| 13 | [Open Decisions](13-open-decisions.md) | Unresolved, with recommendations |
| 14 | [Model Validation](14-model-validation.md) | **Four real goals stress-tested against the engine** |

Read `02`, `03`, and `04` first. They are the product. `05` is what makes it
worth looking at. Then read `14` — it is the evidence that `03` and `04` survive
contact with real goals, and it is where three of the engine's sharper ideas came
from.

## What changed from v1, and why

| v1 | v2 | Reason |
|---|---|---|
| User-authored entity types, dynamic schema, trait registry | **Fixed domain model** (`02`) | The universal no-code platform was complexity that didn't improve progress intelligence. Fixed types let behavior live directly in code — no trait indirection, no role mapping, no dynamic Zod compilation |
| User-authored relation types | **6 fixed relations with meaning** | The progress engine needs to know what an edge *means*. Six well-defined kinds beat arbitrary edges plus a semantics field |
| Generic JSON entity bag + generated columns | **Real typed tables + a narrow custom-field layer** | Simpler queries, real constraints, better performance, far less machinery |
| Workflow engine in scope | **Deferred to Phase 4**, event-bus seam only | Not a Phase 1 priority per correction |
| Custom agents, agent studio | **Fixed agent set**, small | Claude is the execution layer, not the center |
| Pack install/merge/uninstall | **Export/backup only** | Data ownership without the distribution machinery |
| General formula fields, 18 field kinds | **Metric expressions + ~9 custom field kinds** | Narrow expressions where measurement needs them |
| Trajectory in Phase 7 | **Trajectory in Phase 1–2** | It is the point |
| Visual design as a §9 subsection | **Its own first-class document** (`05`) | Stated requirement |

Net effect: roughly 40% less machinery, and the machinery that remains is aimed
at one question instead of every possible question.
