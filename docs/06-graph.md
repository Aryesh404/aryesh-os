# 06 — The Neural Graph

The graph is a signature surface, and it earns that only if it answers questions
a list cannot. Its job here is **structural**: showing how things connect,
where contribution flows, and where it is blocked. Trajectory answers "am I on
track"; the graph answers "why, and what is attached to it".

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Graph model | **graphology** | Real traversal, metrics, community detection |
| Renderer | **Sigma.js v3** (WebGL) | 60 fps at 10k+ nodes; SVG renderers stall near 1–2k |
| Layout | ForceAtlas2 in a **Web Worker** | Never blocks the UI thread; positions stream and ease in |
| Custom visuals | Sigma node/edge programs (GLSL) | Progress rings, area rings, halos in the shader, not DOM |
| Overlays | React portals from the camera transform | Only the few nodes needing HTML |

## 2. Visual encoding

Every channel carries information (`05` §1):

| Channel | Encodes |
|---|---|
| Node fill | Trajectory status (`ahead` … `stalled`) |
| Node outer ring | Area colour — identity |
| Node inner arc | Progress 0–1 |
| Node size | Importance: weight in the contribution graph × stated importance |
| Node shape | Object kind (goal ○, project ▢, metric ◇, milestone △, habit ⬡, decision ⬠) |
| Dashed outline | Low confidence or stale data |
| Edge thickness | Contribution weight |
| Edge colour | Relation kind, muted by default |
| Edge dash | `depends_on` (dashed) vs `contributes_to` (solid) |
| Halo pulse | **Only** a live running execution |
| Dimming to 15% | Everything outside the hovered node's neighbourhood |

Six shapes and one colour vocabulary is a learnable language. Any further
encoding would be decoration.

## 3. Graph views

Fixed, purposeful views rather than an open-ended builder — each answers a
specific question:

| View | Seeds | Shows |
|---|---|---|
| **Contribution** | Top-level goals | What advances what, weighted. The default |
| **Blockers** | Blocked/at-risk items | `depends_on` chains and their roots |
| **Area** | One area | Everything in that slice of life |
| **Project** | One project | Tasks, goal links, business, client |
| **Finance** | Accounts, financial goals | Money flow into financial goals |
| **Decision** | One decision | The evidence that informed it |
| **Focus** | Any entity | Its neighbourhood at depth N |

Each view is configurable and savable — depth, relation filters, status filters,
layout, label density, animation speed, node-size basis (`08` §2). What is *not*
offered is inventing new node semantics; those come from the fixed domain.

## 4. Scale

The failure mode is the hairball: technically rendered, practically useless.

1. **Bounded server-side traversal** — recursive CTE, depth ≤ 6, `maxNodes`
   default 1500. Never an unbounded fetch.
2. **Importance ranking** when over budget — contribution weight, recency,
   pinned, distance decay.
3. **Meta-nodes** — overflow collapses to "37 more tasks", expandable. The graph
   is explicit about what it hides.
4. **Level of detail** — labels appear by zoom and importance; low-weight edges
   drop when zoomed out; extreme zoom-out renders clusters.
5. **Incremental expansion** — clicking a node merges its neighbourhood into the
   existing instance and resumes layout rather than restarting, so the user's
   mental map survives.
6. **Cached positions per view** — reopening is instant and familiar, not
   re-scrambled. This matters more for perceived quality than raw frame rate.

## 5. Interaction

| Action | Behaviour |
|---|---|
| Hover | Neighbourhood highlight, rest dims, hover card after 400 ms |
| Click | Select; inspector panel opens |
| Double-click | Focus — re-seed on this node |
| Drag node | Manual position, pinned and persisted |
| Drag node → node | Create a relation; picker filtered to valid kinds |
| `E` / `C` | Expand / collapse one level |
| `/` | Search within graph; camera flies to best match |
| Arrow keys | Keyboard traversal along relations (accessibility) |
| Right-click | Inspect, focus, expand, relate, hide |

**Contribution path highlight** is the graph's best trick: selecting a goal
illuminates every path feeding it, with edge-flow animation along the live
contribution routes and grey for the stalled ones. "Why is this goal stuck?"
becomes visible rather than deduced.

The **inspector** is a side panel, not a modal: fields, progress breakdown
(`03` §8), trajectory sparkline, relations by kind, linked decisions and
insights, and recent activity.

## 6. Server contract

```
graph.project(viewId, overrides?) → { nodes, edges, meta }
graph.expand(nodeId, {depth, relations, limit}) → delta
graph.paths(fromId, toId) → contribution paths
```

`meta.truncated` and `meta.hiddenCount` are surfaced in the UI. The graph never
quietly lies about completeness.
