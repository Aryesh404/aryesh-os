# 05 — Neural Graph Model

The graph is the signature surface. Its job is not decoration: it is the **SEE**
step of the core loop. If it cannot answer "what is connected to this, and what
is blocking it?" faster than a list view, it has failed regardless of how it
looks.

## 1. Stack

| Concern | Choice | Rationale |
|---|---|---|
| Graph data model (client) | **graphology** | A real graph library: typed attributes, traversal, metrics (degree, betweenness, communities), pluggable layouts |
| Renderer | **Sigma.js v3** (WebGL) | Holds 60 fps at 10k+ nodes. SVG renderers (React Flow, d3-selection) stall around 1–2k, which the brief explicitly rules out |
| Layout | ForceAtlas2 in a **Web Worker**, plus deterministic layouts | Layout never blocks the UI thread. Positions stream back and are interpolated |
| Custom visuals | Sigma node/edge programs (GLSL) | Halo for focus, ring for progress, dashed for dependency — all in the shader, not DOM overlays |
| Overlays | React portals positioned from the camera transform | Only for the few nodes that need HTML (inspector, hover card) |

Alternative considered and rejected: Cosmograph (GPU force layout, ~1M nodes).
Faster, but a heavier dependency with less control over interaction, and we do
not need that ceiling. Revisit only if node counts exceed ~50k.

## 2. Projection pipeline

The client never receives the whole database. It receives a **projection**.

```
GraphView definition
  → seed resolution      (which entities start the traversal)
  → bounded expansion    (recursive CTE, depth + budget limits, server side)
  → filtering            (type, status, time window, tag, custom predicate)
  → aggregation          (collapse groups into meta-nodes when over budget)
  → styling              (declarative rules → visual attributes)
  → serialisation        (compact typed arrays)
  → client graphology instance → worker layout → Sigma
```

```ts
interface GraphView {
  id: string; name: string; icon?: string
  seeds:
    | { kind: 'all' }
    | { kind: 'types'; typeIds: string[] }
    | { kind: 'entities'; ids: string[] }         // focus mode
    | { kind: 'view'; viewId: string }            // reuse a saved list view
    | { kind: 'query'; query: QueryDescriptor }
  expansion: {
    depth: number                                  // default 2, max 6
    direction: 'out' | 'in' | 'both'
    relationTypeIds: string[] | 'all'
    maxNodes: number                               // default 1500, hard cap 20000
    strategy: 'breadth' | 'weighted'               // weighted follows edge weight/importance
  }
  filters: FilterGroup                             // same DSL as views (09 §4)
  layout: {
    algorithm: 'forceatlas2' | 'radial' | 'hierarchical' | 'temporal' | 'grid' | 'manual'
    params: Record<string, number>                 // gravity, scaling, edgeWeightInfluence
    pinned: Record<EntityId, {x: number; y: number}>
    seed: number                                   // deterministic replay
  }
  style: { rules: StyleRule[]; defaults: StyleDefaults }
  display: {
    labels: 'none' | 'hover' | 'important' | 'all'
    labelThreshold: number                         // zoom level at which labels appear
    edgeLabels: boolean
    density: number                                // 0..1, drives repulsion + culling
    animationSpeed: number                         // 0 disables all motion
    showOrphans: boolean
    clusterBy?: string                             // field key or 'type' or 'community'
  }
}
```

Every knob the brief asks for — node size, labels, relationship visibility,
animation speed, density, layout, filters, colour rules, highlight rules — is a
row in `graph_views`, editable from a settings panel. Graph views are duplicable,
so "Goal View / Business View / Project View / Finance View / Life View" are seed
data, not code.

## 3. Style rules (declarative, not imperative)

```ts
interface StyleRule {
  id: string
  when: FilterGroup            // same predicate DSL as everywhere else
  then: {
    color?: string | { fromField: string; scale: ColorScale }
    size?: number | { fromField: string; range: [number, number] }
                              | { fromMetric: 'degree'|'betweenness'|'recency'|'importance' }
    shape?: NodeShape
    opacity?: number
    borderColor?: string
    ring?: { fromField: string }   // progress ring
    halo?: boolean
    hidden?: boolean
    pulse?: boolean                // reserved for genuine state: running execution
  }
  priority: number
}
```

Rules are evaluated in priority order and merged. Defaults come from the entity
type's colour and icon. Example seeded rules:

- *Overdue and not done* → `borderColor: warning`
- *Blocked by an unfinished dependency* → `color: muted, halo: true`
- *Touched in the last 24 h* → `size: +20%`
- *Currently executing* → `pulse: true` — the only animated state, because it is
  the only one that is genuinely live.

The brief's "futuristic but not cheesy" rule is enforced here: **motion is
reserved for state change**. Nodes do not drift, glow, or breathe for atmosphere.
They move when the layout settles, when you focus, and when something is
actually running.

## 4. Scaling strategy

The failure mode to avoid is the hairball that is technically rendered and
practically useless.

1. **Bounded traversal.** Recursive CTE with `depth <= N` and a visited set;
   `maxNodes` enforced server-side. Never `SELECT * FROM entities`.
2. **Importance ranking.** When expansion exceeds budget, keep the highest-scored
   nodes. Score = w1·degree + w2·recency + w3·pinned + w4·trait weight +
   w5·distance-from-seed decay. The weights are configurable.
3. **Meta-nodes.** Overflow collapses into an aggregate node — "37 more tasks" —
   which expands on click. The graph stays honest about what it is hiding.
4. **Level of detail.** Labels appear by zoom threshold and importance; edges
   below a weight threshold hide when zoomed out; at extreme zoom-out the
   renderer draws clusters, not nodes.
5. **Incremental expansion.** Clicking a node fetches only its neighbourhood and
   merges it into the existing graphology instance; layout resumes rather than
   restarting, so the user's mental map survives.
6. **Worker layout with position streaming.** FA2 runs off-thread; positions
   stream at ~20 fps and are eased on the main thread.
7. **Position caching.** Stable node positions are cached per graph view so
   reopening a view is instant and familiar rather than re-scrambled.

## 5. Interaction model

| Action | Behaviour |
|---|---|
| Pan / zoom | Camera, momentum, `Ctrl+scroll` to zoom, double-click to zoom to fit |
| Hover | Neighbour highlight, everything else dims to 15 %, HTML hover card after 400 ms |
| Click | Select; the inspector panel opens |
| Double-click | Focus mode — re-seed the projection on this entity |
| `Cmd/Ctrl+click` | Multi-select for bulk relate, bulk edit, or bulk tag |
| Drag node | Manual position, pinned and persisted |
| Drag node → node | Create relation; a picker appears filtered to valid relation types |
| Right-click | Context menu: inspect, edit, focus, expand, collapse, relate, hide, delete |
| `/` | Search within the graph; matches ripple-highlight, camera flies to the best hit |
| `E` on selection | Expand one level |
| `C` on selection | Collapse subtree |
| Drag-select | Lasso |
| Timeline scrubber | Replay graph state over time (Phase 7 — uses the audit log) |

The **inspector** is a side panel, not a modal: entity title, type, all fields
(inline-editable, rendered by the field registry), relations grouped by type with
add/remove, related memories, progress breakdown, recent executions, and an
"Ask Claude about this" action that pre-seeds an execution with this entity as
context.

## 6. Server contract

```
graph.project(viewId, overrides?) → {
  nodes: { id, type, title, x?, y?, size, color, shape, ring?, flags }[]
  edges: { id, from, to, type, weight, style }[]
  meta:  { truncated: boolean, hiddenCount: number, budgetUsed: number, ms: number }
}
graph.expand(nodeId, { depth, relationTypes, limit }) → delta patch
graph.neighbors(nodeId) → summary counts by relation type   // for cheap hover
```

Responses are deltas where possible. `meta.truncated` is surfaced in the UI
explicitly — the graph must never quietly lie about completeness.

## 7. Graph as an AI surface

The same projection powers Claude's spatial understanding. A context pack can
include a compact serialisation of the current view:

```
GRAPH (view: Business, 34 nodes, depth 2, truncated: no)
goal:g_01 "₹5L MRR by Mar 2027" [progress 34%]
  ← contributes_to (0.4) project:p_09 "Client retainer platform" [active, 62%]
      ← belongs_to  business:b_01 "Samarth Strategies"
      ← blocks      task:t_88 "Payment gateway integration" [blocked, 12d stale]
```

Claude sees the same structure the user sees, which makes "what is slowing me
down?" answerable from shared evidence rather than from a re-derived guess.
