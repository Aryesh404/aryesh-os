# 04 — Customization Engine

> "The application is not the final product. The customization engine is the
> product." — brief §33. This document specifies that engine.

## 1. What must be customizable, and where it lives

| Customizable thing | Storage | Editor surface |
|---|---|---|
| Modules / navigation (add, delete, rename, reorder, hide) | `nav_items` | Settings → Navigation, drag to reorder |
| Entity types (create, rename, delete, icon, colour, traits) | `entity_types` | Schema Studio |
| Fields (add, remove, rename, reorder, retype, defaults) | `fields` | Schema Studio → type detail |
| Statuses, categories, tags | `fields.config.options` on select fields | Inline option editor |
| Relationships (custom edge kinds) | `relation_types` | Schema Studio → Relations |
| Views (filter/sort/group/mode) | `views` | View bar on any list |
| Dashboards + widgets (add, move, resize, duplicate, configure) | `dashboards`, `widgets` | Dashboard edit mode |
| Home screen contents | `dashboards` where `is_default` | Same |
| Graph behaviour (layout, density, colour rules, filters) | `graph_views` | Graph settings panel |
| Goal structure and progress weighting | `entities.data` + contribution relation weights | Goal detail → Progress model |
| AI instructions, permissions, custom agents | `agents`, `permission_rules` | Agent Studio, Allowance |
| Workflows and automation on/off | `workflows` | Workflow builder |
| Theme tokens | `settings` | Appearance |

Nothing in that table is a code change. That is the acceptance test for R1.

## 2. The field-type registry

18 kinds. Each is one module implementing a single interface, registered in a
map. Adding a field type later touches exactly one directory.

```ts
interface FieldTypeDefinition<TConfig, TValue> {
  kind: FieldKind
  label: string
  icon: string
  configSchema: ZodType<TConfig>            // validates the field's own settings
  valueSchema(config: TConfig): ZodType<TValue>   // validates instance values
  storage: 'json' | 'json+index' | 'relation' | 'file'
  /** SQL fragment for sorting/filtering when promoted to a generated column */
  sqlProjection?(key: string): string
  serialize(v: TValue, c: TConfig): JsonValue
  deserialize(j: JsonValue, c: TConfig): TValue
  coerceFrom(other: FieldKind, v: JsonValue, c: TConfig): CoerceResult<TValue>
  format(v: TValue, c: TConfig, locale: Locale): string    // display + AI context
  components: { Input: FC; Display: FC; FilterInput: FC; ConfigEditor: FC }
  filterOperators: FilterOperator[]
  aggregations?: AggregationKind[]          // sum, avg, min, max, count-by
  searchable: boolean
}
```

| Kind | Config highlights | Filter ops | Notes |
|---|---|---|---|
| `text` | maxLength, pattern, prefix/suffix | eq, contains, starts, empty | |
| `long_text` | markdown?, richtext? | contains, empty | Markdown by default; feeds FTS |
| `number` | min, max, precision, unit, display (plain/bar) | eq, gt, lt, between | |
| `currency` | currency code, precision, per-value currency? | numeric ops | Stored as integer minor units to avoid float drift |
| `percent` | 0–1 vs 0–100, display style | numeric ops | |
| `rating` | max, icon | numeric ops | |
| `boolean` | display (checkbox/toggle) | is | |
| `date` | granularity, timezone policy | before, after, between, relative | Relative filters (`this week`) are stored, not resolved |
| `datetime` | timezone, format | same as date | |
| `select` | options[{key,label,colour,order,semantics}] | is, in, empty | `semantics: open/active/done/blocked` lets the engine reason about status without knowing labels |
| `multi_select` | options, max | has any, has all, empty | |
| `relation` | targetTypes[], relationTypeId, cardinality, inverse display | linked to, count | **Writes a real row in `relations`**, not a JSON id list |
| `url` | preview? | contains, empty | |
| `email` | | contains, empty | |
| `phone` | region | contains | |
| `file` | accept, maxSize, multiple | has file | Disk-backed, handle in JSON |
| `image` | accept, dimensions | has image | Thumbnails generated on write |
| `formula` | expression, resultKind, dependencies[] | on result kind | §4 |

**`relation` fields are projections, not storage.** A relation field on an entity
type is a *view* onto the `relations` table filtered by relation type and
direction. This is what keeps "add a Client field to Project" and "draw an edge
in the graph" as the same fact rather than two facts that drift apart.

## 3. Dynamic validation

Field definitions compile to Zod at runtime, cached per entity-type version:

```ts
function compileEntitySchema(type: EntityType, fields: Field[]): ZodObject {
  const shape: ZodRawShape = {}
  for (const f of fields.filter(f => !f.deletedAt)) {
    const def = fieldTypes.get(f.kind)
    let s = def.valueSchema(def.configSchema.parse(f.config))
    if (!f.required) s = s.nullish()
    shape[f.key] = s
  }
  return z.object(shape).passthrough()   // passthrough preserves __archived data
}
```

The cache key is `entityTypeId:version`, invalidated by the `config.changed`
event. The same compiled schema drives API validation, form generation, CSV
import, and the arguments of the MCP tools exposed to Claude — one definition,
five consumers, no drift.

## 4. Formula fields

Formulas are the pressure valve that keeps the trait set small. They are also
the largest injection surface in the product, so:

- **No `eval`, no `new Function`, no JS runtime.** A small parsed expression
  language over a whitelisted function table, walked by an interpreter with a
  step budget and a depth limit.
- Grammar: literals, field refs (`{field_key}`), relation aggregates
  (`sum(tasks.hours)`, `count(tasks where status.semantics = 'done')`),
  arithmetic, comparison, `if/and/or/not`, date functions (`daysUntil`,
  `monthsBetween`, `today`), string functions, and `progressOf(relation)`.
- **Dependency graph maintained at definition time.** Cycles are rejected with
  the exact path displayed. Evaluation is topological.
- **Evaluation strategy: materialised on write, lazily on read-miss.** A formula
  value is recomputed when a dependency changes (via the event bus) and stored
  in `data` so lists and sorts stay index-fast. A `formula_dirty` marker handles
  cases where a dependency change is discovered late.
- Errors are values (`#ERR: divide by zero`), never exceptions — one bad formula
  must not break a list view.

## 5. Traits in the editor

When the user adds the `monetary` trait to a type, the UI asks them to map the
required roles to fields, and offers to create matching fields if none fit:

```
Trait: Monetary
  amount      → [ Value (currency) ▾ ]   ✓
  direction   → [ — none — ▾ ]           ⚠ required, [Create field]
  occurred_at → [ Date (date) ▾ ]        ✓
Unsatisfied: this type will not appear in finance widgets until `direction` is mapped.
```

Unsatisfied traits degrade — the type still works, the trait's features are just
inactive and clearly labelled as such. Never a crash, never a silent no-op.

## 6. Versioning, undo, and restore

Every configuration write goes through one path:

```ts
await config.mutate({
  subject: { kind: 'field', id },
  patch,                     // RFC-6902-style
  actor,
  label: 'Rename Budget → Contract Value',
})
// → validates → applies in txn → writes revisions{patch, inverse} → emits config.changed
```

- **History**: every config object has a timeline with diffs and actors.
- **Undo**: apply the stored inverse. Available for any revision, not just the
  last, with a conflict check against subsequent revisions.
- **Named checkpoints**: "before I restructured goals" — a labelled revision
  marker across all config tables that can be restored as a set.
- **Soft delete + restore**: deleted types, fields, views, dashboards go to a
  Trash with a 30-day window (configurable) and a one-click restore that also
  reinstates dependent bindings where possible.
- **Deleting a field does not delete its data.** Values move to
  `data.__archived[key]` and are restored if the field comes back. This is what
  makes experimentation safe, and it is cheap to implement now and impossible to
  retrofit later.

## 7. Impact analysis (the safety feature that makes the rest usable)

Before any destructive or narrowing config change, a dependency query runs across
formulas, views, widget bindings, workflow conditions, graph style rules, agent
tool scopes, and progress models. Results are shown as a checklist with links.
Nothing proceeds until the user sees it.

This is the difference between a system you are willing to reshape and one you
are afraid to touch — which decides whether the customization engine is actually
used.

## 8. Packs: export, import, reset

A **pack** is a portable bundle of configuration (no user data):

```json
{ "manifest": { "key": "aryesh-default", "version": "1.0.0", "schemaVersion": 1 },
  "entityTypes": [...], "fields": [...], "relationTypes": [...],
  "views": [...], "dashboards": [...], "widgets": [...],
  "graphViews": [...], "agents": [...], "permissionRules": [...], "theme": {...} }
```

Install, update (three-way merge with conflict prompts), uninstall (keeps data,
removes config), and export-my-config are the same mechanism. This is how "reset
to defaults" works, how the seed pack ships, and how a future community pack
could work without any new architecture.

## 9. Anti-patterns this design forbids

- A `switch` on entity type key anywhere outside the seed pack loader.
- A widget that queries a specific table instead of going through the data-source
  descriptor.
- A field rendered by a component chosen with an `if` chain instead of the
  registry.
- UI state that survives refresh but is not in the database.
- A hardcoded status string (`'done'`) in engine code — use
  `option.semantics === 'done'`.
- A migration file generated because the user added a field.

These are worth encoding as ESLint rules and a review checklist, because every
one of them is a small, reasonable-looking shortcut that quietly converts the
engine back into an app.
