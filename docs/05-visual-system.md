# 05 — Visual System

**Visualize.** Visual quality is a first-class product requirement here, not a
finishing pass. The graph, trajectory charts, progress visualization, and insight
presentation *are* the product surface.

The current direction is a calm personal workspace: charcoal canvas, distinct
slate surfaces, restrained violet actions, and generous space around a few daily
priorities. Motion and colour communicate state. The graph and dashboard-builder
specifications below are deferred; see [the current review slice](17-workspace-review.md).

## 1. Colour

Near-black base, one UI accent, and a separate semantic palette for trajectory
status. Keeping the accent out of the status range is deliberate: status colour
must never be confused with "this is interactive".

```css
/* Canvas */
--bg-canvas:    #0E1015;   /* app background */
--bg-surface:   #151920;   /* cards, panels */
--bg-raised:    #1E232E;   /* popovers, modals, hover */
--bg-inset:     #10131A;   /* wells, code, terminal */
--border:       #2B303D;
--border-strong:#454E60;

/* Text */
--text-primary:   #F0F2F7;
--text-secondary: #B2BAC9;
--text-tertiary:  #929CAF;

/* UI accent — interaction only, never status */
--accent:       #B1A1FF;
--accent-dim:   #C1B5FF;
--accent-glow:  rgba(177,161,255,0.09);

/* Trajectory status — the product's core vocabulary */
--st-ahead:     #38BDF8;
--st-on-track:  #34D399;
--st-at-risk:   #FBBF24;
--st-behind:    #F87171;
--st-stalled:   #A3ADBF;
--st-unknown:   #929CAF;   /* always labelled; never colour alone */
```

Two status vocabularies map onto this one palette (`04` §3), so the colours stay
learnable while the words stay accurate:

| Colour | Dated (has a target date) | Undated (theme / open-ended goal) |
|---|---|---|
| `--st-ahead` | `ahead` | `advancing` |
| `--st-on-track` | `on_track` | `steady` |
| `--st-at-risk` | `at_risk` | `slowing` |
| `--st-behind` | `behind` | *(not used — nothing is late that was never due)* |
| `--st-stalled` | `stalled` | `stalled` |
| `--st-unknown` | `unknown` | `unknown` |

The label always shows the correct word for the kind of thing being described.
Colour carries urgency; the word carries the claim.

**Status colour means exactly one thing** and means it everywhere: on a graph
node, a chart line, a list row, a progress ring, a dashboard tile. Learned once.

**Area colours** come from a curated 12-swatch palette, all contrast-checked on
`--bg-canvas`, assigned by the user per Area. Areas colour *identity*; status
colours *state*. A node shows its area as a thin outer ring and its status as
fill — two encodings that never fight because they live in different geometry.

Low confidence is encoded structurally, not chromatically: hollow fills, dashed
strokes, widened bands. Colour stays free to mean status.

## 2. Typography

| Role | Face | Notes |
|---|---|---|
| UI, prose | **Inter** | `-0.011em` tracking at body sizes |
| Numbers, metrics, identifiers, terminal | **JetBrains Mono** | Always `font-variant-numeric: tabular-nums` |

Inter Variable is self-hosted from the font package. Body is 15px, form inputs
16px, page headings 28–36px, and summary figures 30–48px. Secondary labels may
use 12–14px. Everyday task and habit text should remain comfortably readable.

**Every number is monospaced with tabular figures.** In a product whose entire
purpose is numbers changing over time, digits that shift position as they animate
read as instability. This one detail does more for perceived quality than any
effect.

## 3. Space, structure, density

4px base grid. Radii: 8 (controls), 12 (cards), 14–16 (panels). Hairline `1px`
borders in `--border` are the primary structural device — not shadows, not
gradients. Elevation is conveyed by surface lightness plus a single soft shadow
on genuinely floating layers only.

Density is a user setting (`compact` / `default` / `relaxed`) applied through
spacing tokens. Data-heavy surfaces (tables, transcripts, breakdowns) run dense;
visual surfaces (graph, trajectory, focus mode) run generous.

## 4. Motion

### Principles

1. Motion communicates **state change, arrival, relationship, or magnitude**.
2. Nothing moves on its own. No ambient drift, no breathing glow, no parallax, no
   particles.
3. Change is animated **from the previous value**, never from zero — the point is
   to show the delta.
4. Simultaneous animations are staggered (30ms) so the eye can follow sequence.
5. `prefers-reduced-motion` replaces every transition with an instant cut **but
   keeps delta indicators**, so no information is lost.

### Durations and easing

| Purpose | Duration | Easing |
|---|---|---|
| Micro (hover, focus, toggle) | 120 ms | `cubic-bezier(0.2, 0, 0, 1)` |
| Standard (panel, tab, expand) | 220 ms | same |
| Entrance (dashboard, modal) | 320 ms | same, 30 ms stagger |
| Number transitions | 400 ms | `easeOutExpo` |
| Progress ring fill | 600 ms | spring `{ stiffness: 120, damping: 18 }` |
| Trajectory line draw | 700 ms | `easeOutCubic`, left→right |
| Graph settle | 800–2000 ms | physics; eased position interpolation |
| Focus / camera fly | 500 ms | `easeInOutCubic` |

### What animates, and what it means

| Animation | Meaning |
|---|---|
| Number counts from old to new value | This changed, by this much |
| Progress ring fills from previous | Advancement since last view |
| Delta chip rises and fades in (`+2.4%`) | The size and sign of the change |
| Trajectory line draws on mount | The shape of the history |
| Projection band fades in after the line | Prediction is secondary to fact |
| Graph nodes ease to new positions | The layout resolved |
| Node halo pulses | **Only** for a live running execution |
| Edge flows toward its target | Only while showing a contribution path |
| Row highlight sweep | This row just updated from a background job |

That table is exhaustive on purpose. If a proposed animation is not on it, the
question is what information it carries — and the usual answer is none.

## 5. The chart system

The implemented trajectory chart uses responsive SVG primitives. Shared: 1px
hairline axes in `--border`, no gridlines unless
reading values precisely is the task, no chart junk, no 3D, no drop shadows.

### 5.1 Trajectory chart — the signature visual

The chart that answers "am I on track?" and the one to get right before any
other.

```
100% ┤                                                    ◇ target
     │                                          ╭──────────
     │                                   ╭──────╯  ← projection band
     │                            ╭──────╯▒▒▒▒▒▒▒▒▒▒▒
 50% ┤                  ╭─────────╯▒▒▒▒▒▒▒▒▒▒▒▒▒
     │        ╭─────────╯ ← actual (solid, status-coloured)
     │   ╭────╯
     │╭──╯          ┈┈┈┈┈┈┈┈┈┈┈ required pace (dashed, --text-tertiary)
  0% ┼────────────────────────────────────────────────────
     Jan          Apr          Jul          Oct        Mar '27
                                            ▲ today
```

Layers, in z-order: required-pace reference (dashed) → projection band (12%
opacity fill) → actual progress line (2px, status-coloured) → snapshot dots on
hover → target marker → today rule.

Rules: the band is never omitted; when `04` §2's honesty gates block a
projection, the projection layers are replaced by an inline explanation ("5 days
of history needed — 3 so far"), not by an empty chart. Hovering reads out actual,
required, and gap at that date.

### 5.2 Progress ring

Circular, 3px stroke, status-coloured, animating from its previous value. The
centre holds the percentage in mono. Confidence is encoded structurally: below
0.5 the ring renders as a dashed outline with an unfilled interior. An outer
1px arc in the area colour carries identity.

### 5.3 Contribution breakdown

A horizontal stacked bar where segment *width* is normalised weight and segment
*fill* is that contributor's value — so a wide, mostly-empty segment reads
instantly as "this matters a lot and isn't moving". Rendering `03` §8's structure
directly.

### 5.4 Attention allocation

Diverging horizontal bars per area: target share as a reference tick, actual as
the bar, the gap coloured by direction and magnitude. Sorted by absolute gap so
the largest mismatch is at the top.

### 5.5 Supporting

Sparklines (metric history in tiles, 24px, no axes), pace gauge (a single arc
against a 1.0 reference), metric history line (with target line and baseline),
cash-flow bars, streak grid.

## 6. Presenting insight

Insights are not toast notifications. Each renders as a card carrying: severity
stripe, a plain-language title, the evidence as inline clickable chips with their
values, a relevant micro-visualisation (sparkline or breakdown fragment), and one
primary action.

```
┌ ▎NOTABLE ─────────────────────────────────────────────────┐
│ Monthly revenue has been flat for 6 weeks                 │
│ ₹5L MRR by Mar 2027 needs 3.2×  your current pace         │
│                                                            │
│  ▁▂▂▃▃▃▃▃▃  ₹1.4L →  ₹1.42L                                │
│                                                            │
│ Evidence  [monthly_revenue 1.42L]  [retainer-platform 62%] │
│           [outreach habit 5/7]                             │
│                                                            │
│ [ Open goal ]              [ Record a decision ]  [Dismiss] │
└────────────────────────────────────────────────────────────┘
```

Every drill-down anywhere in the product opens the same explanation panel, backed
by `Explained<T>` (`01` §5). One component, one mental model: click a number, see
what made it.

## 7. States

**Empty states carry the honest message**, not a shrug: "No readings yet — this
goal can't be measured until `monthly_revenue` has data" plus the action to add
it. **Loading** uses skeletons shaped like the content, never spinners; charts
hold their axes and animate data in when it arrives. **Stale** surfaces retain
readable contrast and show a timestamp or reason. **Error** states say what failed and what still
works.

## 8. Accessibility

Contrast ≥ 4.5:1 for text, ≥ 3:1 for meaningful graphics. Status is never
conveyed by colour alone — every status pairs with a shape or label (`▲ ahead`,
`■ stalled`). Full keyboard navigation including the graph (arrow keys traverse
relations). `prefers-reduced-motion` fully honoured. Focus rings in `--accent` at
2px, always visible, never suppressed.

Below 1024px, use a single column and five labelled bottom-navigation items.
Phones use full-height native dialog sheets, scrollable forms, and visible save
actions. Interactive controls target at least 44px. Dialogs use `showModal()` for
focus containment, handle Escape, and return focus to the trigger. Chart points
support pointer interaction and Arrow/Home/End keys. Reduced motion disables
decorative transitions. Browser verification remains part of the review gate.
References: [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
and [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
