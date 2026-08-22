# 03 — Measurement & Progress Engine

**Observe → Measure.** This is the spine of the product. Everything in `04`
reads from it, everything in `05`–`07` displays it, and if it is wrong, the
entire system is confidently wrong.

Design stance: **measure advancement, not activity.** Closing tasks is activity.
A metric moving toward a target is advancement. The engine is built so that
activity cannot masquerade as progress.

## 1. Observation sources

| Source | How a reading arrives | Example |
|---|---|---|
| **Manual** | User enters a value | Weight, mood score, hours studied |
| **Computed** | A registered collector derives it from domain data | Monthly revenue from transactions; tasks completed per week |
| **Derived** | An expression over other metrics | `savings_rate = (income - expenses) / income` |
| **External** | Imported (CSV now, integrations later) | Bank statement, analytics export |

All four produce rows in the same append-only `readings` table. Downstream code
never cares which kind produced a number — only its value, time, and confidence.

## 2. Collectors (computed metrics)

A collector is a small registered function that turns domain state into a
reading. This is the *only* code-level extension point in the measurement layer,
and it is intentionally narrow.

```ts
interface Collector {
  key: string                       // 'finance.revenue.monthly'
  name: string
  unit: MetricUnit
  cadence: Cadence
  compute(period: Period, ctx: Ctx): Promise<number | null>   // null = no data
}
```

v1 collectors:

| Key | Produces |
|---|---|
| `finance.revenue` / `finance.expenses` / `finance.net` | Sums over transactions in period, optionally per business |
| `finance.savings_rate` | Derived from the above |
| `finance.net_worth` | Accounts + investments − liabilities |
| `finance.runway_months` | Liquid balance ÷ trailing 3-month burn |
| `work.tasks_completed` | Count in period |
| `work.projects_active` / `work.projects_shipped` | Status counts |
| `work.cycle_time` | Mean task open→done duration |
| `habit.consistency` | Completed ÷ expected occurrences per habit |
| `attention.share_by_area` | Share of activity per area (`04` §4) |

Collectors run on schedule per cadence and on relevant events. They are pure
functions of `(period, data)`, so they are unit-testable and backfillable — the
same code that computes today can rebuild the last two years from history, which
is what makes trajectory useful on day one rather than in six months.

## 3. Derived-metric expressions

A deliberately small language — not general formula fields.

- Operands: metric references `{metric_key}`, numeric literals
- Operators: `+ - * / ( )`, comparison, `? :`
- Functions: `sum`, `mean`, `min`, `max`, `abs`, `round`, `clamp`,
  `delta(m, period)`, `pct_change(m, period)`, `rolling(m, fn, n)`
- No loops, no user-defined functions, no I/O

Parsed to an AST, evaluated by an interpreter with a step budget. The dependency
graph is maintained at save time and cycles are rejected with the path shown.
Errors are values (`#ERR: metric 'x' has no readings`), never exceptions — one
bad expression must not break a dashboard.

## 4. The progress model

Progress for a goal is a weighted combination of contributors, where every
contributor normalises to 0–1.

### 4.0 Two measurement modes

Not everything worth tracking can be a percentage. Forcing "become a stronger
engineer" onto a 0–100% scale invents a denominator that does not exist, and an
invented number teaches the user that all the system's numbers are decorative.

```ts
measurementMode: 'completion' | 'momentum'
```

| Mode | Reports | Fits |
|---|---|---|
| `completion` | 0–100% toward a definable end | ₹5L MRR, ₹1 Cr corpus, Ship v1 |
| `momentum` | Rate vs. expected rate — **no percentage** | Capability, consistency, health, adoption |

Momentum goals report a status (`04` §3), an activity summary, and any bounded
**level indicators shown separately — never averaged into a composite.** Blending
a self-rated confidence score with a shipping rate produces a number that means
nothing; two honest signals beat one dishonest one (`14` Case 3).

### 4.1 The model

```ts
type ProgressModel =
  | { mode: 'manual' }                                  // the user just says
  | { mode: 'weighted'; contributors: Contributor[] }   // the default
  | { mode: 'metric'; metricId: string }                // single-metric shorthand
  | { mode: 'rollup' }                                  // purely from sub-goals

interface Contributor {
  kind: 'goal' | 'project' | 'metric' | 'milestone' | 'habit' | 'manual'
  refId: string
  weight: number                    // relative; normalised at evaluation
  /** completion mode: normalise to 0..1 against a target (§4.2)
   *  momentum mode:   score the RATE against an expected rate (§4.3) */
  evaluation: 'level' | 'rate'
  expectedRate?: { value: number; per: 'week' | 'month' | 'quarter' }
  label?: string
}
```

**Unbounded metrics** — counts with no meaningful target (`projects_shipped`,
`architecture_decisions`) — are only valid as `rate` contributors. The engine
rejects them as `level` contributors at configuration time rather than dividing
by an undefined target.

### 4.2 Level evaluation (completion mode)

A mix like 40% projects / 30% finance / 20% milestones / 10% habits is four
contributors. Any other mix is equally expressible, per goal.

| Kind | 0–1 value |
|---|---|
| `goal` | The sub-goal's own computed progress (recursive) |
| `project` | Project progress — see §4.4; **basis is explicit**, not assumed |
| `milestone` | Achieved ÷ total across the goal's milestones |
| `habit` | Consistency rate over the goal's trailing window |
| `manual` | The user's stated value |
| `metric` | See below |

**Metric normalisation** — the one place a sign error would quietly corrupt
everything, so it is stated explicitly:

```
increase:  (current − baseline) / (target − baseline)
decrease:  (baseline − current) / (baseline − target)
maintain:  1 − min(1, |current − target| / tolerance)
```

All clamped to `[0, 1]`. Missing baseline defaults to the first recorded reading
— not zero, because "revenue grew from ₹80k to ₹90k against a ₹100k target" is
50% progress, not 90%. That default is the difference between a number that
motivates and a number that flatters.

### 4.3 Rate evaluation (momentum mode)

A rate contributor scores recent activity against an expected cadence:

```
observed = count or sum over the trailing window, normalised to `per`
score    = clamp(observed / expectedRate, 0, 1.5)     // >1 means exceeding
```

Where no `expectedRate` is stated, the reference is the contributor's own
trailing 90-day average — so the question becomes *"is this holding up
against how I have actually been operating?"* rather than against a number
invented at setup time.

Momentum scores are **not** summed into a percentage. They roll up into the
momentum status vocabulary in `04` §3.

### 4.4 Project progress basis (activity vs. advancement)

Task completion is *activity*. Treating it as advancement is the single easiest
way for this product to lie to its owner, so the basis is always explicit:

```ts
projectProgress:
  | { mode: 'outcome';   metricId }   // preferred — a real outcome measure
  | { mode: 'milestone' }             // deliverable-based
  | { mode: 'manual';    value }      // judgement
  | { mode: 'task_based' }            // DEFAULT — activity proxy
```

`task_based` stays the default because it is the only mode requiring zero
configuration, but it carries consequences: **confidence is capped at 0.6**, the
UI labels it an activity proxy, and when such a project carries significant
weight toward a goal, that goal is marked `degraded` with the reason. Tasks never
reach a goal except through an explicit weighted `contributes_to` edge — there is
no direct task→goal path anywhere in the model (`14` §5).

### Aggregation

```
weights normalised over *satisfied* contributors only:
  wᵢ' = wᵢ / Σ(satisfied w)
progress = Σ wᵢ' · valueᵢ
```

An unsatisfied contributor (deleted metric, no readings, archived project) drops
out and renormalises — but the goal is flagged `degraded` with the reason. It
never silently reports a different number computed a different way.

## 5. Rules that keep the number honest

1. **Only `contributes_to` edges count.** The contribution subgraph *is* the
   progress computation. Nothing enters through another path.
2. **Acyclic and depth-bounded**, memoised per traversal.
3. **Edge weight lives on the edge**, so one project can matter more to a goal
   than another without duplicating config.
4. **Progress never decreases silently.** If a recompute drops a goal's progress,
   the drop is recorded with its cause and surfaced — a falling number is
   information, not an error to hide.
5. **Contributor overlap is detected at configuration time.** Two contributors
   derived from the same underlying events — a `modules_completed` metric
   alongside the milestone set it counts — would count the same advancement
   twice and report roughly double the truth while looking entirely legitimate.
   The engine flags overlapping sources when a model is saved. Cheap to check
   now; expensive to discover months later inside a number you trusted
   (`14` Case 4).
6. **Time is not a contributor.** Elapsed time measures the clock, not the work.
   It belongs on the trajectory chart (`04` §2), answering the different and more
   useful question: *am I ahead or behind?*

## 6. Confidence and staleness

Every progress figure carries a confidence, because a number computed from
three-week-old data deserves to look different from a fresh one.

```
freshness(metric) = clamp(1 − (now − lastReading) / (2 × cadencePeriod), 0, 1)
density(metric)   = clamp(readingCount / expectedReadings, 0, 1)
confidence(contributor) = 0.6·freshness + 0.3·density + 0.1·(manual ? 1 : 0.8)

confidence(goal) = Σ wᵢ' · confidenceᵢ  ×  satisfiedRatio
```

Surfaced everywhere, and it drives real behaviour: below 0.5, the UI shows the
progress ring hollow rather than filled and labels it "low confidence"; the
trajectory projection widens its band; the insight engine will not raise a
confident claim from low-confidence inputs.

A metric past `2 × cadence` without a reading is **stale**, appears in a "needs
data" queue, and stops being treated as current evidence. The system's most
useful nag is not "you have tasks" — it is "you stopped measuring the thing you
said mattered."

## 7. Snapshots

Nightly (and on demand), the snapshotter writes one row per goal and per metric:

```ts
interface GoalSnapshot {
  goalId; date
  progress: number; confidence: number
  breakdown: { kind; refId; weight: number; value: number }[]   // compact JSON
  velocity7d?: number; velocity30d?: number
}
```

Snapshots are what make trajectory possible, and they cannot be reconstructed
after the fact — a goal whose model changed last month cannot have last month's
progress recomputed honestly. So snapshots start being written in **M2**, before
anything displays them. Cheap now, impossible to backfill later.

Volume: 200 goals + 300 metrics daily ≈ 180k rows/year. Irrelevant for SQLite.
Retention: daily for 1 year, then weekly.

## 8. Explainability

Every computation returns `Explained<T>` (`01` §5):

```
Goal "₹5L MRR by Mar 2027" — 34% (confidence 0.71)
├─ metric  monthly_revenue    weight 0.40 → 0.28  (₹1.4L of ₹5L, baseline ₹0)
├─ project retainer-platform  weight 0.30 → 0.62  (13 of 21 tasks by estimate)
├─ milestone 3 of 6 achieved  weight 0.20 → 0.50
└─ habit   weekly-outreach    weight 0.10 → 0.71  (5 of 7 weeks)
caveats: monthly_revenue last read 9 days ago (cadence: weekly)
```

This exact structure is what the drill-down renders (`05` §6) and what Claude
receives as context (`10` §4). One representation, three consumers.

## 9. Caching and invalidation

Computed progress is cached on the goal row. A reading or status change emits an
event; the engine walks *up* the contribution graph invalidating ancestors, then
recomputes lazily on next read. No full-graph recomputation, ever.

## 10. Diagnostic and leading indicators

Metrics attached to a goal with `measures` rather than `contributes_to` are
tracked, charted, and used for diagnosis, but **never scored** (`02` §2). This is
how a goal keeps its supporting instrumentation without inflating its own number:
`monthly_profit` guards against "₹5L MRR at a loss" reading as success, and
`leads_month` is evidence about future revenue rather than a fraction of it.

A `measures` edge may optionally declare a **lead relationship**:

```ts
{ kind: 'measures', leads?: { targetMetricId: string; lagDays: number } }
```

`leads_month → monthly_revenue, lagDays: 60` lets the blocker detectors warn on
the *input* before the outcome moves. Without it, a trajectory chart watching
only revenue reports `on_track` right up until the quarter the pipeline collapse
arrives (`14` Case 1).

Lag is user-stated, not inferred — correlating two short, noisy series would
produce a confident number from nothing. Phase 3; the `measures` edge carries the
field from M2 so the annotation is additive.

## 11. Metric components and velocity attribution

Some metrics are a sum of causes that mean very different things. An invested
corpus grows from **contributions** (controllable, durable, repeatable) and from
**returns** (not controllable, borrowed, reversible). A single scalar cannot tell
those apart, so a corpus at ₹40L reads identically whether it came from
disciplined saving or a rising market.

```ts
interface Metric {
  // ...
  components?: { key: string; label: string; controllable: boolean }[]
}
```

Readings against a decomposed metric carry a component key; the metric's value is
their sum. Progress still uses the **total** — ₹1 Cr is ₹1 Cr regardless of
source, and discounting returns would be its own distortion — but **velocity is
reported per component**:

```
₹1 Cr corpus — 41% (₹41L)
velocity₃₀ ₹1.34L/mo
  ├─ contributions ₹0.85L/mo (63%)   durable
  └─ returns       ₹0.49L/mo (37%)   market-dependent
```

This is what makes the difference between "I am saving well" and "the market was
kind" visible instead of averaged away. It also feeds projection: only the
controllable component may be extrapolated from behaviour; the rest requires a
stated assumption (`04` §2).
