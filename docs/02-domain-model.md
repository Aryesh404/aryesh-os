# 02 — Domain Model

Fixed objects, fixed relations. Behaviour lives directly on the type, because the
types are known. This is the single largest simplification from v1: with no
user-authored types, there is no trait registry, no role mapping, no dynamic
schema compilation, and no generic entity bag — the engine can just know what a
Goal is.

Extension happens through custom **fields**, **categories**, and **areas**
(`08`), not through inventing new kinds of thing.

## 1. The objects

### Structural

**Area** — a domain of life. The user's own top-level structure: Personal,
Career, Business, Finance, Health, Learning — whatever they choose. Areas are
user-defined (name, colour, icon, order), and everything else hangs off one.
This is where "personal structure" customization lives, and it is bounded enough
to stay comprehensible.

```ts
interface Area { id; name; color; icon; order; targetShare?: number /* intended
  attention share, 0..1 — used by attention analysis in 04 */ }
```

**Theme** — a named strand of intent that is *not* calendar-bound. "Ship Samarth
V2", "Get consistent", "Become employable as a backend engineer". Themes are the
organising layer between an area and its goals, and they replace the fixed
horizon ladder (life → year → quarter → month → week) that a calendar-shaped
planner would impose.

```ts
interface Theme {
  id; areaId; name; description?
  why?: string
  status: 'active' | 'paused' | 'achieved' | 'retired'
  targetDate?: string             // optional — many themes never have one
  importance: 1|2|3|4|5
  progress: number                // rolled up from its goals
  order: number
}
```

The design consequence is real and runs through `03`–`05`: **a goal or theme
without a target date cannot have a required pace**, so it gets a different
trajectory vocabulary (`04` §3). Dated things are judged against a deadline;
undated things are judged on momentum. Conflating the two would mean either
inventing fake deadlines or reporting "on track" for something with no track.

### The progress objects

**Goal** — what the user is trying to achieve. The center of the model.

```ts
interface Goal {
  id; areaId
  themeId?: string                         // usually belongs to a theme
  parentGoalId?: string                    // free nesting, any depth
  name; description?
  startDate?; targetDate?                  // BOTH optional — see Theme above
  status: 'active' | 'achieved' | 'missed' | 'abandoned' | 'paused'
  progressModel: ProgressModel             // 03 §4 — how progress is computed
  progress: number                         // cached, computed
  confidence: number                       // cached, from 03 §6
  why?: string                             // the reason it exists — fed to AI context
  customFields: Record<string, unknown>
}
```

`why` earns its place: it is what lets the system distinguish a goal worth
protecting from one worth abandoning, and it is the first thing that should be
surfaced when a goal is stalling.

**Metric** — a measurable quantity. The unit of observation.

```ts
interface Metric {
  id; areaId?; name; key
  unit: MetricUnit                  // currency | count | percent | duration | score | ratio | weight | custom
  direction: 'increase' | 'decrease' | 'maintain'
  baseline?: number; target?: number; targetDate?: string
  cadence: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'adhoc'
  source: MetricSource              // manual | derived | computed | external
  expression?: string               // derived metrics only — 03 §3
  collectorKey?: string             // computed metrics only — 03 §2
  aggregation: 'last' | 'sum' | 'mean' | 'max' | 'min'   // how readings roll up per period
  private: boolean                  // excluded from AI context
}
```

**Reading** — one observation of a metric at a time. Append-only time series.

**Milestone** — a discrete, dated checkpoint under a goal. Binary or partial.

**Project** — a container of work with a start, an end, and an owner.
Status, dates, area, optional business/client, optional `localPath` and `repoUrl`
(the hook for Claude execution and repo analysis), health.

**Task** — a unit of work inside a project or standing alone. Status, dates,
estimate, actual.

**Habit** — a recurring behaviour with a cadence and a streak. Habits contribute
to goals via consistency rate, not via count.

### The decision objects

**Decision** — first-class, because decision quality is a thing this system
measures.

```ts
interface Decision {
  id; areaId; title; date
  context: string                   // what was true when this was decided
  choice: string                    // what was chosen
  rationale: string                 // why
  alternatives?: string[]           // what was rejected, and briefly why
  expectedOutcome?: string
  confidence: number                // 0..1 at time of deciding
  reversibility: 'easy' | 'costly' | 'irreversible'
  reviewDate?: string               // when to check whether this was right
  outcome?: { assessedAt; verdict: 'good' | 'mixed' | 'bad' | 'too_early'; notes: string }
  linkedEntityIds: EntityRef[]      // informed_by evidence
}
```

**Insight** — a system-generated observation with evidence (`04` §5).

**Note** — free text, linkable to anything.

### Finance

**Account** (balance, kind), **Transaction** (amount, direction, date, category,
account, optional business), **Investment** (holding, value, cost basis).

Finance's role in this architecture is deliberate: it is a **metric source**, not
a separate product. Transactions feed computed metrics (monthly revenue, burn,
savings rate, net worth), and those metrics contribute to goals like anything
else. There is no parallel finance intelligence stack.

### Business

**Business** (multiple supported), **Client**, **Person**. Kept deliberately
thin — enough to attribute projects and revenue, not a CRM.

### System records

`Snapshot`, `Execution`, `AuditEvent`, `Job`, `MemoryNote` (`10` §6).

## 2. The six relations

Fixed, each with meaning the engine can act on.

| Relation | Meaning | Typical endpoints | Weighted |
|---|---|---|---|
| `contributes_to` | Source advances target; participates in progress roll-up | goal→goal, project→goal, metric→goal, milestone→goal, habit→goal | **Yes** |
| `belongs_to` | Structural containment — **derived from foreign keys, never stored as an edge** (see below) | goal→theme, theme→area, project→business, task→project, transaction→account | No |
| `depends_on` | Source is blocked until target completes | task→task, project→project, goal→goal, milestone→milestone | No |
| `measures` | Source quantifies target **without scoring it** — diagnostic and leading indicators | metric→goal, metric→project, metric→business, metric→habit | No |
| `informed_by` | Target was evidence for the source decision | decision→(metric, insight, project, note) | No |
| `relates_to` | Weak associative link; graph context only | anything→anything | No |

One implementation note that matters: **`belongs_to` is not a stored row.**
Every containment in the fixed domain is already a foreign key
(`goal.themeId`, `task.projectId`, `milestone.goalId`), and keeping a second
copy as an edge would give the same fact two sources of truth that can drift.
The graph derives those edges from the FKs at projection time. The relation
kind stays in the vocabulary because the graph and the AI context both speak
it; only the storage is different.

Two rules the engine relies on:

1. **Only `contributes_to` affects progress.** Everything else is context. This
   makes progress auditable — the contribution subgraph is exactly the set of
   weighted edges, and nothing can leak into a number through a side door.
   The `measures` edge exists precisely so a metric can be tracked, charted, and
   used for diagnosis **without** advancing anything: pipeline leads are evidence
   about future revenue, not a fraction of it (`14` Case 1).
2. **`contributes_to` and `depends_on` must both stay acyclic.** Cycles are
   rejected at creation with the offending path shown.

Six relation kinds cover every example in the brief. If a seventh is genuinely
needed later, adding one is a small, deliberate change — which is the right cost
for something that alters what the intelligence layer means.

## 3. How the objects serve the loop

```
OBSERVE     Reading, Transaction, Task/Project status, Habit check-in
MEASURE     Metric → Goal via contributes_to → progress + confidence
UNDERSTAND  Snapshot history → trajectory; depends_on → blockers;
            Area.targetShare vs actual → attention allocation
VISUALIZE   Graph (all relations), trajectory charts, progress
DECIDE      Attention ranking → Decision (with informed_by evidence)
ACT         Task, Project, or Claude execution
MEASURE     Snapshot; Decision.outcome reviewed at reviewDate
```

## 4. Lifecycle rules

- **Soft delete everywhere**, 30-day restore window. Readings are never deleted
  by cascade — a metric's history survives the metric being archived, because
  deleting history silently rewrites the past.
- **Archive ≠ delete.** Archived goals keep their snapshots and stay visible in
  historical trajectory views.
- **Every mutation records an actor** (`user` | `agent:<id>` | `system`), so any
  number can be traced to who or what moved it.
- **Goal completion is explicit.** Reaching 100% computed progress proposes
  completion; it does not silently mark a goal achieved. The gap between "the
  metrics say done" and "I consider this done" is real and worth preserving.

## 5. Deliberately excluded

Custom entity types, custom relation types, arbitrary schemas. If a new kind of
object is genuinely needed, it is a considered addition to this model — not a
form the user fills in at 1 a.m. that the intelligence layer then cannot reason
about.
