# 02 — Domain Model

> This document and `04-customization-engine.md` carry the whole system. If the
> ideas here are right, everything else is implementation detail.

## 1. The central problem

The brief asks for two things that normally contradict each other:

- **A.** The user can create, rename, restructure and delete every entity type,
  field, status, view, and relationship — nothing important is hardcoded.
- **B.** The system must *understand* goals, finance, projects, and progress well
  enough to compute weighted goal progress, forecast cash flow, analyse a
  repository, and answer "what matters right now?".

A is generic storage. B is domain-specific behaviour. Most products resolve this
by faking one side: either a rigid app with a "custom fields" bolt-on, or a
Notion-style generic database that knows nothing and can therefore compute
nothing meaningful.

## 2. The resolution: primitives + traits

Two layers, and only two.

**Layer 1 — Primitives (code, small, stable).** Ten primitives, listed in §3.
They know nothing about goals or money. They will barely change after Phase 1.

**Layer 2 — Configuration (data, large, volatile).** Entity types, fields,
relation types, views, dashboards, workflows, agents, permissions. All rows in
the database. All editable from the UI. Ships as a **seed pack** (§6), which the
user may gut entirely.

The bridge between them is the **trait**.

A trait is a named capability that an entity type opts into, which unlocks
specific engine behaviour and imposes a contract that the type's fields must
satisfy. Code branches on traits — never on type names (R2).

```ts
// Not this — a hardcoded product:
if (entity.type === 'project') computeProjectProgress(entity)

// This — an engine:
for (const trait of entityType.traits) {
  traitRegistry.get(trait).onEvaluate(entity, ctx)
}
```

The user renames "Project" to "Engagement", deletes it, or invents "Research
Thread" with the `progress` and `temporal` traits — and the progress engine, the
timeline widget, and the goal roll-up all work on it immediately, with no code
change. That is the product.

## 3. The ten primitives

| # | Primitive | Responsibility | Roughly stable after |
|---|---|---|---|
| 1 | **EntityType** | A user-defined kind of thing: key, name, icon, colour, traits, lifecycle | Phase 1 |
| 2 | **Field** | A typed attribute on an entity type; 18 field types; validation, defaults, sensitivity | Phase 1 |
| 3 | **Entity** | An instance: typed, versioned, soft-deletable, with a JSON value bag | Phase 1 |
| 4 | **RelationType** | A user-defined edge kind: direction, cardinality, endpoint constraints, semantics | Phase 1 |
| 5 | **Relation** | An instance of an edge, optionally with its own fields and weight | Phase 1 |
| 6 | **View** | A saved way of looking at entities: filter, sort, group, mode, columns | Phase 2 |
| 7 | **Dashboard + Widget** | A persisted grid of configured widgets bound to data sources | Phase 2 |
| 8 | **Workflow** | Trigger → conditions → actions, as data | Phase 7 |
| 9 | **Agent** | A configured AI worker: purpose, instructions, tools, permissions, memory scope | Phase 3 |
| 10 | **Memory** | A durable, classified, attributable fact | Phase 1 (foundation) / 7 (full) |

Supporting records that are *not* primitives because they are never
user-composed: `Execution`, `AuditEvent`, `Revision`, `Proposal`, `Approval`,
`Insight`, `Secret`, `Session`, `Job`.

## 4. The trait registry

A trait declares: required capabilities (fields with certain roles), the engine
hooks it activates, and the UI affordances it unlocks.

```ts
interface TraitDefinition {
  key: string
  name: string
  description: string
  /** Field roles this trait needs. The user maps them to their own fields. */
  requiredRoles: TraitRole[]     // e.g. { key: 'amount', accepts: ['currency'] }
  optionalRoles: TraitRole[]
  hooks: {
    onEvaluate?(e: Entity, ctx: EvalCtx): Promise<TraitEvaluation>
    onEvent?(ev: DomainEvent, ctx: EvalCtx): Promise<void>
    contributesProgress?(e: Entity, ctx: EvalCtx): Promise<ProgressSignal>
    graphHints?(e: Entity): GraphHints        // size, weight, cluster
    contextPack?(e: Entity): ContextFragment  // what Claude sees
  }
  widgets?: string[]   // widget kinds this trait makes available
  views?: string[]     // view modes this trait makes available
}
```

**Role mapping is the key detail.** A trait never assumes a field is called
`amount`. It declares that it needs a role named `amount` that accepts
`currency`, and the entity type's config maps `role.amount → field.value_inr`.
Rename the field, the mapping holds. Delete the field, the trait reports itself
as unsatisfied and degrades gracefully instead of throwing.

### Traits shipped in v1

| Trait | Requires (roles) | Unlocks |
|---|---|---|
| `progress` | `progress` (percent) *or* a progress formula | Progress engine participation, roll-up, progress widgets, trajectory |
| `temporal` | `start` and/or `end` (date) | Timeline & calendar views, overdue detection, "Today" / "This Week" |
| `status` | `status` (select) | Board view, status transitions, workflow triggers, stale detection |
| `hierarchical` | self-referencing relation type | Nested goals, WBS trees, tree view, roll-up paths |
| `monetary` | `amount` (currency), `direction` (in/out), `occurred_at` (date) | Finance aggregation, cash-flow, budgets, forecasting, net-worth |
| `account` | `balance` (currency), `kind` (select) | Balance tracking, reconciliation, net-worth roll-up |
| `assignable` | `owner` (relation → person-like) | Workload views, "my" filters |
| `codebase` | `local_path` (text), optional `repo_url` | Project Intelligence, repo analysis, Claude working directory |
| `executable` | — | Can be the target of an execution request |
| `measurable` | `metric_value` (number), `target` (number) | KPI widgets, metric contribution to goals |
| `recurring` | `schedule` (text/cron) | Habits, streaks, scheduled instantiation |
| `contactable` | `email`/`phone` | Contact affordances, communication log |

Traits are additive and composable. "Goal" is `progress + temporal + hierarchical
+ status`. "Task" is `status + temporal + assignable`. "Transaction" is
`monetary`. "Project" is `progress + temporal + status + codebase + assignable`.
None of those names appear in engine code.

**Custom traits are Phase 7+, and possibly never.** A trait is a code contract; a
user-authored one means user-authored code. The correct v1 answer is a rich
built-in trait set plus formula fields for arbitrary computation. Flagged as
D8 in `13-open-decisions.md`.

## 5. Entity anatomy

```ts
interface Entity {
  id: EntityId                 // ULID — sortable, no coordination
  typeId: EntityTypeId
  // Conventional surface every type has, because the graph and search need it:
  title: string                // derived via the type's titleTemplate
  subtitle?: string
  // Everything user-defined:
  data: Record<FieldKey, FieldValue>   // JSON, validated against field defs
  // System:
  status?: string              // denormalised from the status-role field
  archivedAt?: Date | null
  deletedAt?: Date | null      // soft delete (R3)
  createdAt: Date; updatedAt: Date
  createdBy: ActorRef          // user | agent:<id> | workflow:<id> | import
  version: number              // optimistic concurrency
  searchText: string           // maintained FTS projection
  embedding?: Float32Array     // optional semantic vector
}
```

`title` is computed from a per-type template (`"{{client.name}} — {{name}}"`) so
the graph, palette, and search always have a label without special-casing types.

**Field keys are immutable; display names are not.** Every field has a stable
`key` generated at creation and a mutable `name`. Renaming "Budget" to "Contract
Value" is a metadata update; existing data, formulas, views, and widget bindings
all keep working. This is the single most important detail in making rename-safe
customization work, and it is easy to get wrong once and painful forever.

## 6. The seed pack

Aryesh OS ships a **default configuration pack** — not hardcoded types, but a set
of rows installed on first run and thereafter fully editable or deletable.

```
seed/aryesh-default/
  entity-types/   goal, milestone, project, task, business, client, person,
                  account, transaction, investment, skill, decision, document,
                  idea, habit, event, note
  relation-types/ contributes_to, belongs_to, depends_on, blocks, owns,
                  references, derived_from, assigned_to, funds, informed_by
  views/          today, this-week, active-projects, pipeline, net-worth
  dashboards/     home (neural graph, today, week, goals, business, finance,
                  insight — matching brief §6, every tile removable)
  graph-views/    life, goals, business, projects, finance
  agents/         planner, analyst, developer, reviewer, memory-manager
  permissions/    the default risk-tier ruleset from 06
  theme/          near-black token set
```

Packs are exportable and importable. "Reset to defaults", "export my
configuration", and "try a different structure without losing data" are all the
same mechanism. `Execution`, `Insight`, and `Memory` are *not* entity types —
they are system records with their own tables, because their lifecycle and
access patterns are not user-shaped. They can still be *targets* of relations.

## 7. Extension seams left open

| Future need | Seam already present |
|---|---|
| Multi-user | `ActorRef` is already polymorphic; entity ownership is a relation |
| Plugins | Trait registry, widget registry, field-type registry, tool registry are all lookup tables |
| Sync / mobile offline | ULIDs + `version` + append-only event log make CRDT-lite sync tractable |
| Alternate storage | Repository interfaces in `packages/db` |
| New AI providers | Agent definitions carry a `model` ref; the bridge is one adapter |
| Import from Notion/Linear | A pack is a schema + rows; importers target packs |

## 8. Invariants

1. An entity's `data` always validates against its type's current field set —
   or carries an explicit `__migrationPending` marker after a breaking schema
   change. Never a silent mismatch.
2. A relation's endpoints always satisfy its relation type's constraints, or the
   relation is flagged `invalid` rather than deleted.
3. Deleting an entity type soft-deletes it and its entities; a restore window
   exists; hard delete requires a typed confirmation and a pre-delete export.
4. Every mutation carries an `ActorRef`. There is no anonymous write.
5. Formula and progress evaluation is acyclic. Cycles are detected at definition
   time and rejected with the offending path shown.

## 9. The progress engine (trait: `progress`)

Brief §9 is explicit that progress must not mean "percentage of tasks ticked".
Counting checkboxes measures activity; the point is to measure advancement.

### The model

Progress on any entity with the `progress` trait is computed from a set of
**weighted contributors**, where a contributor is anything that can produce a
0–1 signal:

```ts
interface ProgressModel {
  mode: 'manual' | 'weighted' | 'formula' | 'inherit'
  contributors: Contributor[]     // weighted mode
  formula?: string                // formula mode — full expression language
  rollupPolicy: 'weighted-mean' | 'min' | 'critical-path'
}

type Contributor =
  | { kind: 'relation'; relationTypeKey: string; weight: number
      aggregate: 'mean' | 'min' | 'weighted-by-edge' }      // sub-goals, projects, milestones
  | { kind: 'metric'; fieldKey: string; target: number; baseline?: number; weight: number }
  | { kind: 'financial'; fieldKey: string; target: number; weight: number }
  | { kind: 'milestone'; relationTypeKey: string; weight: number }  // discrete, count-based
  | { kind: 'habit'; entityId: string; window: string; weight: number }
  | { kind: 'time'; weight: number }        // elapsed vs. planned — usually diagnostic, not progress
  | { kind: 'manual'; weight: number }      // the user's own judgement, always allowed
```

The brief's example — 40 % projects, 30 % finance, 20 % milestones, 10 % habits —
is four contributors with those weights. Any other mix is equally expressible,
per goal. Weights need not sum to 1; they are normalised, and the UI shows both
the raw and normalised values so a forgotten contributor is visible rather than
silently rescaling everything.

### Rules that keep the number honest

1. **Weights are normalised, never assumed.** An unsatisfied contributor (deleted
   field, missing relation) drops out and renormalises, and the entity is flagged
   as having a degraded model rather than quietly reporting a different number.
2. **Contribution weight can live on the edge.** A `contributes_to` relation
   carries an optional `weight`, so one project can matter more to a goal than
   another without duplicating configuration on the goal.
3. **Roll-up is bounded and acyclic.** Cycle detection at definition time
   (invariant 5), depth cap on evaluation, memoised per traversal.
4. **Caching with event-driven invalidation.** Computed progress is stored on
   `entities.progress`. A change to any contributor emits an event; the engine
   walks *up* the contribution graph invalidating ancestors, then recomputes
   lazily on next read. Never a full-graph recompute.
5. **Progress is explainable.** Every computation can return its breakdown —
   which contributor produced what, at what weight, and what it would take to
   move the number. This powers the progress widget's drill-down and the Goal
   Analyst's answers, and it is the difference between a number you trust and a
   number you ignore.
6. **`time` is a contributor you probably should not use.** It is offered because
   the brief lists it, but elapsed time measures the clock, not the work.
   The UI marks it as diagnostic and defaults it off — it belongs on the
   *trajectory* visualisation (progress vs. time-remaining), which is where it
   actually answers something: *am I ahead or behind?*

### Trajectory

Separate from progress and more useful for the north-star questions. A stored
time series of progress snapshots supports: current velocity, projected
completion at current pace, required velocity to hit the target date, and the gap
between them. "Will I make it?" is a comparison of two slopes, and it needs no
prediction model to be honest — only history, which is why snapshots start being
written in Phase 1 even though the visualisation lands in Phase 7.
