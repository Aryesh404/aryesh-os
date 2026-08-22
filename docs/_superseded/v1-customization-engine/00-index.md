# Aryesh OS — Phase 0 Architecture Deliverable

Status: **Draft for approval.** No implementation code has been written.

## The one-sentence thesis

Aryesh OS is not an application with a customization feature; it is a customization
engine that ships with a default configuration. Everything a normal product would
hardcode — entity types, fields, statuses, dashboards, views, workflows, agents,
permissions — is data in this system, editable from the UI, versioned, and restorable.

## The core loop everything must serve

```
SEE → UNDERSTAND → DECIDE → ALLOW → EXECUTE → MEASURE → ADAPT
 │        │            │        │        │         │        │
graph  memory +     goal      allowance  Claude   progress  memory
       insight     analysis    engine     bridge   engine    writeback
```

A feature that does not strengthen one of these seven verbs does not belong in
v1. This test is applied explicitly in `12-phase-1-plan.md`.

## Documents

| # | Document | Answers |
|---|---|---|
| 01 | [System Architecture](01-architecture.md) | Stack, topology, processes, cross-cutting concerns |
| 02 | [Domain Model](02-domain-model.md) | Primitives, traits, what is code vs. what is config |
| 03 | [Database Schema](03-database-schema.md) | Storage engine, tables, indexing, migrations |
| 04 | [Customization Engine](04-customization-engine.md) | Field system, dynamic validation, versioning, safety |
| 05 | [Graph Model](05-graph-model.md) | Neural graph data + render + scale + style rules |
| 06 | [Permission Model](06-permission-model.md) | Risk tiers, allowance rules, scopes, audit |
| 07 | [Claude Code Bridge](07-claude-bridge.md) | Execution lifecycle, context packs, SDK wiring, MCP |
| 08 | [Agent Architecture](08-agent-architecture.md) | Orchestrator, agent definitions, routing, budgets |
| 09 | [Dashboard & Widgets](09-dashboard-widgets.md) | Layout persistence, widget contract, data binding |
| 10 | [Memory Architecture](10-memory-architecture.md) | Memory classes, retrieval, decay, provenance |
| 11 | [Repository Structure](11-repository-structure.md) | Monorepo layout, package boundaries, tooling |
| 12 | [Phase 1 Plan](12-phase-1-plan.md) | Milestones, acceptance criteria, sequencing |
| 13 | [Open Decisions](13-open-decisions.md) | **Unresolved — needs your input before Phase 1** |

## How to review this

Read 02 and 04 first. They contain the ideas the whole system stands on
(primitives + traits). If those two are right, the rest follows. If they are
wrong, the rest is wasted.

Then read 13. There are 9 decisions I deliberately did not make for you.
