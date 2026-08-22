# 09 — Dashboard, Widgets, Views & Command Center

## 1. Model

```ts
interface Dashboard {
  id: string; name: string; slug: string; icon?: string
  purpose?: string                       // 'Personal' | 'Business' | free text
  layouts: Record<Breakpoint, GridItem[]>  // lg | md | sm — react-grid-layout shape
  isDefault: boolean                     // the home screen
  sortOrder: number
  filters?: FilterGroup                  // dashboard-level scope, e.g. one business
  timeRange?: TimeRangeSpec              // inherited by widgets that opt in
}

interface GridItem { i: string /* widgetId */; x: number; y: number; w: number; h: number
                     minW?: number; minH?: number; static?: boolean }

interface Widget {
  id: string; dashboardId: string
  kind: WidgetKind                       // registry key
  title?: string                         // null = widget's own default
  config: JsonObject                     // validated by the kind's configSchema
  dataSource: DataSourceDescriptor       // §4
  refresh?: { mode: 'live' | 'interval' | 'manual'; intervalMs?: number }
  visibility?: FilterGroup               // conditional widgets: hide when empty
}
```

The home screen is simply the dashboard with `isDefault`. Brief §6's tiles —
Neural Graph, Today, This Week, Goals, Business, Finance, AI Insight — ship as
seed rows in that dashboard and can each be deleted. There is no code path that
assumes any of them exists.

## 2. Widget registry

```ts
interface WidgetDefinition<TConfig> {
  kind: string
  name: string; description: string; icon: string
  category: 'graph' | 'progress' | 'finance' | 'time' | 'data' | 'ai' | 'system'
  configSchema: ZodType<TConfig>
  defaultConfig: TConfig
  defaultSize: { w: number; h: number }; minSize: { w: number; h: number }
  /** Which data shapes this widget can render — drives the picker's suggestions */
  accepts: DataShape[]                  // 'scalar' | 'series' | 'rows' | 'graph' | 'events'
  requiresTraits?: string[]             // e.g. ['monetary'] — hides when nothing qualifies
  Component: FC<WidgetProps<TConfig>>
  ConfigEditor: FC<WidgetConfigProps<TConfig>>
  /** Optional: server-side data resolution for expensive widgets */
  resolve?(ds: DataSourceDescriptor, cfg: TConfig, ctx: Ctx): Promise<WidgetData>
}
```

Adding a widget kind means adding one directory and one registry entry. Nothing
else in the app changes — the picker, the config editor, the resize behaviour,
and persistence are all generic.

### v1 widget kinds

| Category | Kinds |
|---|---|
| graph | `neural-graph`, `relation-summary` |
| progress | `goal-progress`, `progress-bars`, `trajectory`, `milestone-track` |
| finance | `finance-summary`, `cashflow`, `net-worth`, `budget-variance`, `runway` |
| time | `timeline`, `calendar`, `today`, `this-week`, `upcoming`, `streak` |
| data | `entity-table`, `entity-list`, `board`, `kpi`, `chart`, `counter`, `activity-feed` |
| ai | `ai-insight`, `execution-monitor`, `approval-queue`, `ask-claude`, `agent-status` |
| system | `note`, `quick-capture`, `shortcut-grid`, `spend-monitor`, `system-health` |

`chart` and `kpi` are deliberately generic — bound to any data source with any
aggregation — so most "I want a widget that shows X" requests are configuration,
not a feature request. That is the test of whether the registry is pulling its
weight.

## 3. Editing experience

Edit mode toggles a grid overlay. Drag to move, handle to resize, and a widget
menu offering configure / duplicate / change kind / remove. Adding opens a picker
grouped by category, filtered to what the current data can actually feed
(`accepts` + `requiresTraits`), with a live preview using real data before it is
placed. Layout writes are debounced and versioned like any other config change
(`04` §6), so an accidental drag is undoable.

Dashboards can be duplicated, exported in a pack, and set as default. A dashboard
may declare a filter scope — "everything on this dashboard is about Samarth
Strategies" — which every widget inherits unless it opts out. That one feature
removes most of the reason to configure the same filter twelve times.

## 4. The data-source descriptor (one query DSL, five consumers)

Widgets never query tables. They declare intent:

```ts
type DataSourceDescriptor =
  | { kind: 'entities'; typeIds?: string[]; filter?: FilterGroup; sort?: Sort[]
      limit?: number; groupBy?: FieldRef }
  | { kind: 'aggregate'; typeIds: string[]; filter?: FilterGroup
      metric: { fn: 'sum'|'avg'|'count'|'min'|'max'; field?: FieldRef }
      bucket?: { field: FieldRef; granularity: 'day'|'week'|'month'|'quarter'|'year' }
      compare?: { to: 'previous_period' | 'target' } }
  | { kind: 'graph'; graphViewId: string }
  | { kind: 'progress'; entityId: string; breakdown?: boolean }
  | { kind: 'insights'; severity?: Severity[]; limit?: number }
  | { kind: 'executions'; state?: ExecutionState[]; limit?: number }
  | { kind: 'view'; viewId: string }            // reuse a saved view
  | { kind: 'formula'; expression: string }     // same evaluator as formula fields
```

```ts
interface FilterGroup { op: 'and' | 'or'; conditions: (Condition | FilterGroup)[] }
interface Condition { field: FieldRef; operator: FilterOperator; value: JsonValue
                      dynamic?: 'today' | 'this_week' | 'this_month' | 'current_quarter' }
```

The same DSL drives views, graph filters, widget bindings, workflow conditions,
permission-rule conditions, and style rules. One parser, one validator, one
filter-builder UI component, one place to fix a bug. Dynamic values are stored
symbolically (`this_week`), never resolved at save time — otherwise every saved
filter silently rots.

## 5. Views

```ts
interface View {
  id: string; name: string; entityTypeId: string
  mode: 'table' | 'board' | 'list' | 'timeline' | 'calendar' | 'gallery' | 'graph' | 'tree'
  query: { filter?: FilterGroup; sort?: Sort[]; groupBy?: FieldRef; limit?: number }
  columns?: { fieldKey: string; width?: number; visible: boolean; order: number }[]
  boardConfig?: { columnField: FieldRef; swimlaneField?: FieldRef; cardFields: string[] }
  isDefault?: boolean; sortOrder: number
}
```

Available modes are gated by traits: `board` needs `status`, `calendar` and
`timeline` need `temporal`, `tree` needs `hierarchical`. A type without those
traits simply does not offer those modes — the mechanism from `02` §4 doing
ordinary work.

## 6. Command palette (Cmd/Ctrl+K)

The palette is not a search box with shortcuts bolted on; it is the universal
entry point, and everything registers into it.

```ts
interface Command {
  id: string; title: string; subtitle?: string; icon?: string
  group: 'create'|'navigate'|'entity'|'ai'|'config'|'action'|'recent'
  keywords: string[]
  shortcut?: string
  when?: (ctx: AppContext) => boolean      // contextual availability
  args?: CommandArgSpec[]                  // multi-step prompts inside the palette
  run(args, ctx): Promise<void>
}
```

Sources feeding the palette: static commands, one `create` command per entity
type (generated — a new type is instantly creatable from the palette), entity
search results (FTS + recency + semantic), navigation targets, saved views and
dashboards, graph views, agents ("Ask the Finance Analyst…"), workflows, and
settings pages. All of it derives from configuration, so the palette grows as the
system is customised without anyone maintaining a list.

Ranking is frecency-weighted with exact-prefix boosting, and typing a bare
sentence with no command match offers "Ask Claude: <text>" as the last resort —
the natural-language door, matching the CLI's behaviour.

## 7. Visual system

Dark, near-black (`#0a0b0d`), a single accent, fine 1px lines, `JetBrains Mono`
for data and identifiers, `Inter` for prose. Information density is high where it
is useful (tables, transcripts) and generous where it is not (graph, focus mode).

The constraints that keep it from becoming cheesy:

- Motion communicates state — running, changing, arriving, settling — and nothing
  else. No ambient drift, no decorative glow, no parallax.
- Colour carries meaning: type identity, status semantics, risk tier. Never
  decoration.
- One accent colour. Gradients only as low-contrast surface separation.
- Everything readable at 100% zoom without squinting; `prefers-reduced-motion`
  honoured throughout, including the graph layout animation.

Theme tokens live in `settings` and are injected as CSS custom properties, so the
palette is user-editable without a rebuild — including a light theme, should the
user ever want one.
