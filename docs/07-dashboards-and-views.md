# 07 — Dashboards, Views & Command Palette

## 1. Dashboards

```ts
interface Dashboard {
  id; name; slug; icon?
  layouts: Record<'lg'|'md'|'sm', GridItem[]>   // react-grid-layout
  isDefault: boolean
  areaScope?: string          // scope every widget to one area
  timeRange?: TimeRangeSpec   // inherited by widgets that opt in
  order: number
}

interface Widget {
  id; dashboardId; kind: WidgetKind
  title?; config: JsonObject          // validated by the kind's Zod schema
  dataSource: DataSourceDescriptor
  refresh?: 'live' | 'interval' | 'manual'
}
```

The home screen is the dashboard flagged `isDefault`. Dashboards can be created,
duplicated, reordered, scoped to an area, and set as default. Layout is data;
layout writes are debounced and undoable.

**Area scoping** is the feature that prevents configuring the same filter twelve
times: "everything on this dashboard is about Business" is set once and inherited.

### Default home

| Widget | Answers |
|---|---|
| Trajectory overview | Am I on track, across top goals |
| Attention allocation | Is my effort where I said it should be |
| Neural graph (contribution) | How is it all connected |
| What matters now | What should I do next (`04` §7) |
| Insights | What did the system notice |
| Metrics needing data | What have I stopped measuring |
| Finance summary | Where do I stand |

Every one is removable and replaceable. But the default is opinionated, because
a blank dashboard on first run teaches nothing about what the product is for.

## 2. Widget registry

```ts
interface WidgetDefinition<TConfig> {
  kind: string; name; description; icon
  category: 'trajectory'|'progress'|'graph'|'finance'|'time'|'data'|'ai'|'system'
  configSchema: ZodType<TConfig>; defaultConfig: TConfig
  defaultSize; minSize
  Component: FC<WidgetProps<TConfig>>
  ConfigEditor: FC<WidgetConfigProps<TConfig>>
  resolve?(ds, cfg, ctx): Promise<WidgetData>   // server-side for expensive ones
}
```

Adding a widget kind is one directory plus one registry entry; picker, config
editor, resizing, and persistence are all generic.

### v1 kinds

| Category | Kinds |
|---|---|
| trajectory | `trajectory-chart`, `pace-gauge`, `projection-summary`, `velocity-trend` |
| progress | `progress-ring`, `goal-tree`, `contribution-breakdown`, `milestone-track` |
| graph | `neural-graph` |
| finance | `finance-summary`, `cashflow`, `net-worth`, `runway`, `budget-variance` |
| time | `today`, `this-week`, `upcoming`, `calendar`, `streak-grid` |
| data | `metric-tile`, `metric-history`, `entity-table`, `kpi`, `chart`, `activity-feed`, `needs-data` |
| ai | `insights`, `what-matters-now`, `ask-claude`, `execution-monitor`, `approval-queue` |
| system | `note`, `quick-capture`, `decision-review`, `spend-monitor` |

`metric-tile` and `chart` are generic over any metric and aggregation, so most
"I want a widget showing X" requests are configuration rather than a feature
request. That is how the registry earns its keep without becoming a platform.

## 3. Data-source descriptor

Widgets declare intent; they never query tables.

```ts
type DataSourceDescriptor =
  | { kind: 'metric'; metricId: string; window?: TimeRangeSpec; aggregation?: Agg }
  | { kind: 'goal'; goalId: string; include?: ('progress'|'trajectory'|'breakdown')[] }
  | { kind: 'goals'; areaId?: string; themeId?: string; status?: GoalStatus[]; dated?: boolean }
  | { kind: 'trajectory'; goalIds: string[]; window: TimeRangeSpec }
  | { kind: 'attention'; window: TimeRangeSpec }
  | { kind: 'entities'; type: EntityKind; filter?: FilterGroup; sort?; limit? }
  | { kind: 'aggregate'; type: EntityKind; metric: AggSpec; bucket?: BucketSpec }
  | { kind: 'graph'; graphViewId: string }
  | { kind: 'insights'; severity?: Severity[]; limit? }
  | { kind: 'attention-ranking'; limit? }
```

One `FilterGroup` DSL is shared by views, graph filters, widget bindings, and
(later) automation conditions. Dynamic values (`this_week`, `current_quarter`)
are stored symbolically and resolved at read time — otherwise every saved filter
silently rots.

## 4. Views

Saved ways of looking at one object kind: `table`, `board`, `list`, `timeline`,
`calendar`, `tree`, `graph`. Configurable filter, sort, grouping, and visible
columns; savable and set-as-default.

Modes are gated by what the object supports — `board` needs a status field,
`calendar`/`timeline` need dates, `tree` needs nesting. With a fixed domain this
is a static capability table rather than a runtime trait system.

## 5. Command palette (`Cmd/Ctrl+K`)

The universal entry point, and — once Tauri lands (`13` D2) — reachable by a
global hotkey from anywhere in the OS, which is what makes "command center"
literal rather than aspirational.

Sources: static commands, create-actions per object kind, entity search (FTS +
recency), navigation targets, saved views, dashboards, graph views, metrics
("Record reading: weight"), goals, and settings. Ranking is frecency-weighted
with exact-prefix boosting.

Two behaviours worth specifying:

- **Quick capture** — typing a bare sentence offers to capture it as a note,
  task, reading, or decision, parsed for an obvious target
  (`revenue 142000` → a reading on `monthly_revenue`). Capture friction is what
  kills measurement habits, and measurement is the whole spine.
- **Ask Claude** — the last-resort option for anything unmatched, matching the
  CLI's natural-language behaviour.

## 6. CLI (Phase 5)

`aryesh` against the same API. `status`, `today`, `goals`, `trajectory`,
`metrics`, `record <metric> <value>`, `graph`, `decide`, `ask "<question>"`.
Terminal-native output: sparklines, status glyphs, colour matching `05` §1. No
private logic — the CLI is a client.
