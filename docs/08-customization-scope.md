# 08 — Customization Scope

Customization exists to make the system *yours*, not to make it *anything*. The
test for every candidate: **does this let the user express their own life and
priorities more accurately, or does it just add surface area?**

## 1. In scope

| What | Extent |
|---|---|
| **Areas** | Create, rename, colour, reorder, delete. Set target attention share. This is the user's top-level life structure |
| **Themes & Goals** | Themes as named strands of intent; goals nested freely beneath them; optional target dates; and the **progress model** — which contributors, at what weights (`03` §4) |
| **Metrics** | Create any metric: unit, direction, baseline, target, cadence, aggregation. Derived metrics via expressions |
| **Custom fields** | Add fields to any core object (9 kinds, §3) |
| **Categories & statuses** | Transaction categories, project statuses, task statuses, tags — user-defined sets with colours and semantics |
| **Dashboards** | Create, duplicate, scope to an area, arrange, resize, set default |
| **Widgets** | Add, remove, configure, resize, duplicate; bind to any metric/goal/query |
| **Views** | Filter, sort, group, columns, mode; save and set default |
| **Graph configuration** | Depth, filters, layout, density, label rules, node-size basis, animation speed, saved views |
| **Attention weights** | How activity types weigh into attention share (`04` §4) |
| **Theme** | Density mode, accent, area palette, motion level |
| **Navigation** | Reorder, rename, hide modules |

That covers everything the correction named: dashboards, widgets, goals, metrics,
fields, categories, views, graph configurations, personal structure.

## 2. Out of scope (deliberately)

| Not offered | Why |
|---|---|
| **Custom entity types** | The intelligence layer must know what a Goal is to reason about it. A user-invented type is a thing the engine cannot measure, project, or rank — it would be inert data wearing a costume |
| **Custom relation types** | Progress roll-up depends on knowing an edge *means* contribution. Six fixed relations with meaning beat arbitrary edges plus a `semantics` dropdown |
| **General formula fields** | Expressions belong where measurement needs them — derived metrics (`03` §3). A general formula engine on every field is a spreadsheet, and spreadsheets do not produce trajectory intelligence |
| **Custom traits / behaviour authoring** | Behaviour is code. A scripting box in settings is a plugin system with worse ergonomics and no sandbox |
| **Custom agents** | Claude is the execution layer, not the product. A fixed, well-tuned agent set beats a builder nobody tunes |
| **Workflow builder in Phase 1** | Deferred to Phase 4 behind the event bus (§4) |
| **Config packs / marketplace** | Single user. Export and backup deliver data ownership without the distribution machinery |

Each of these was in the v1 design. Removing them is roughly 40% less machinery,
and none of it was making progress intelligence better.

## 3. Custom fields

Nine kinds — enough for real annotation, few enough to stay simple:

`text`, `long_text`, `number`, `currency`, `percent`, `date`, `select`,
`multi_select`, `url`

Each has: key (immutable), label (mutable), config, required flag, default,
`private` flag (excludes from AI context), and display order. Stored in a JSON
`customFields` column on the object, validated against a Zod schema compiled from
the field definitions and cached.

**Immutable keys, mutable labels.** Renaming "Budget" to "Contract Value" is a
metadata change; data, filters, and widget bindings keep working. This detail is
cheap now and impossible to retrofit.

**Deleting a field does not delete its data** — values move to
`customFields.__archived[key]` and are restored if the field returns. Safe
experimentation is what makes customization actually get used.

Custom fields are for annotation and filtering. **They do not participate in
progress computation** — that is what metrics are for, and keeping the boundary
sharp is what stops the field system from re-growing into a formula platform.

## 4. Automation: designed for later, not built now

Automations are deferred to **Phase 4**. The requirement is that nothing in the
core depends on them, and that adding them later needs no upstream change.

The seam is the **event bus** (`01` §5). Every meaningful state change already
emits a typed event, because the progress engine, insight engine, and cache
invalidation are already subscribers. A workflow engine is simply one more
subscriber:

```
events (exists now) ──┬─→ progress engine
                      ├─→ insight engine
                      ├─→ cache invalidation
                      └─→ workflow engine  ← Phase 4, additive
```

The shape it will take when it arrives: trigger (an event + a `FilterGroup`
condition, reusing the existing DSL) → actions (from a registry of the same
operations the API already exposes). No new primitives, no schema migration for
existing objects. Recording this now is what makes the deferral safe rather than
a promise.

## 5. Safety

- Config changes are versioned with an inverse patch; undo is a lookup.
- Soft delete with a 30-day Trash for areas, dashboards, views, metrics, fields.
- **Impact analysis before destructive changes**: deleting a metric shows which
  goals depend on it and what their progress becomes without it. Deleting an area
  shows what it contains. Nothing proceeds until the user has seen it.
- Deleting a metric never deletes its readings (`02` §4).
