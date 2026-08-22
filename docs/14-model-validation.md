# 14 — Model Validation Against Real Goals

Four real goals, modelled against the engine specified in `03` and `04`. Treated
as **test cases, not seed data** — nothing here is hardcoded into the product.

**Result: the model holds for 2 of 4 as written, and needs 7 changes.** Three of
those are substantive. The two cases that broke it (Finance, Career) broke it in
useful ways — they exposed assumptions that would have produced confidently wrong
numbers rather than obvious failures, which is the worse kind of bug.

Changes are listed in §6 and have been applied to `03` and `04`.

---

## Case 1 — Business: ₹5L MRR by March 2027

```
Area: Business
└─ Theme "Build Samarth into a stronger recurring business"   [undated, momentum]
   └─ Goal "₹5L MRR by March 2027"                            [dated, completion]
      progressModel: { mode: 'metric', metricId: monthly_revenue }

      contributes_to:
        metric monthly_revenue    increase, baseline ₹1.4L, target ₹5L, monthly

      measures (diagnostic — NOT scored):
        metric active_clients     increase, monthly
        metric new_clients_month  increase, monthly     ← leading indicator
        metric monthly_profit     increase, monthly     ← health check
        metric leads_month        increase, weekly      ← leading indicator
```

**Holds.** The `mode: 'metric'` shorthand fits exactly, and the case validates a
distinction the model already had but had not been forced to use: **supporting
metrics attach with `measures`, not `contributes_to`.**

This matters more than it looks. Had `leads_month` been given a 10% contribution
weight, generating leads would have *raised progress toward ₹5L MRR* — turning
pipeline activity into revenue advancement on paper. Leads are evidence about
future revenue, not a fraction of it.

Two findings:

- **C1a — `measures` needs `goal` as a valid endpoint.** `02` §2 lists it as
  metric→project / business / habit. Diagnostic metrics on a *goal* is the
  common case. → **Change 1.**
- **C1b — leading indicators are a real concept here.** `leads_month` and
  `new_clients_month` predict `monthly_revenue` at roughly a 30–90 day lag. If
  leads collapse, revenue follows a quarter later — and the trajectory chart,
  which only sees revenue, would report `on_track` right up until it wasn't.
  Worth capturing. → **Change 2** (Phase 3, optional annotation).

`monthly_profit` earns its place as a health check: ₹5L MRR at negative profit
should not read as success, and a diagnostic metric moving the wrong way is
exactly what the blocker detectors should catch.

---

## Case 2 — Finance: ₹1 Cr invested corpus

This is the case that broke the engine hardest, in two independent ways.

```
Area: Finance
└─ Theme "Build long-term financial independence"        [undated]
   └─ Goal "₹1 Cr invested corpus"                       [dated or undated]
      progressModel: { mode: 'metric', metricId: invested_corpus }

      metric invested_corpus   increase, target ₹1,00,00,000
        components:
          cumulative_contributions   ← controllable
          cumulative_returns         ← not controllable
      measures:
        monthly_investment, savings_rate, portfolio_value
```

### Break 1 — one number, two very different causes

The brief asks to distinguish contributions from returns, and the engine as
specified cannot: a metric is a scalar, and progress is `(current − baseline) /
(target − baseline)`. Corpus at ₹40L reads identically whether it came from
disciplined saving or a bull market.

That difference is the whole point. Progress driven by contributions is
*durable and repeatable*; progress driven by returns is *borrowed and
reversible*. A system that cannot tell them apart will report a great trajectory
in a rising market and then report a crisis in a correction — when the user's
actual behaviour never changed.

**Resolution:** the goal's progress still uses total corpus — ₹1 Cr is ₹1 Cr
regardless of source, and pretending otherwise would be its own distortion. But
**velocity is attributed across components**, and the UI and insights report
both:

```
₹1 Cr corpus — 41% (₹41L)
velocity₃₀: ₹1.34L/month
  ├─ contributions  ₹0.85L/month   (63%)   ← durable
  └─ returns        ₹0.49L/month   (37%)   ← market-dependent
```

→ **Change 3: metric components + velocity attribution.**

### Break 2 — linear projection is simply wrong here

`04` §2 projects `progress + velocity₃₀ × daysRemaining`. A corpus fed by a
monthly SIP plus compounding returns does not grow linearly — it grows on a
convex curve. Linear projection would **systematically under-predict** a corpus
goal, possibly by years over a long horizon, and it would do so while looking
perfectly reasonable.

This is the most dangerous class of error in the product: not a visible failure,
but a plausible wrong number.

**Resolution:** projection becomes pluggable, with `compounding` available for
metrics that declare a growth component:

```
FV = P·(1+r)^n + C·[((1+r)^n − 1) / r]
     └ current corpus          └ monthly contribution at rate r
```

The honesty cost is explicit and unavoidable: **compounding projection requires
an assumed return rate, which is a guess.** So the assumption is a visible,
user-set field, never a hidden default, and the chart shows a **scenario fan**
(conservative / expected / optimistic — e.g. 8% / 10% / 12%) rather than one
line. A single confident curve built on an invented return rate is exactly the
astrology `04` §2 exists to prevent.

→ **Change 4: pluggable projection models + scenario fan.**

Note the interaction with Break 1: only the *contribution* component should be
projected from the user's behaviour. The *return* component must come from the
stated rate assumption, not from extrapolating recent market performance — six
good months are not a trend.

---

## Case 3 — Career: momentum, no deadline

```
Area: Career
└─ Theme "Become a stronger engineer and builder"                 [undated]
   └─ Goal "Improve software architecture + AI-assisted dev"      [MOMENTUM]

      rate contributors (unbounded counts, no target):
        projects_shipped, major_features_shipped,
        architecture_decisions, ai_projects_built
      cadence contributor:
        learning_time            target 5 h/week
      level indicator (bounded, NOT merged):
        engineering_confidence   manual 1–10, current 6
```

### Break 3 — unbounded metrics cannot normalise

`(current − baseline) / (target − baseline)` is undefined when there is no
target. "Projects shipped" has no target for a capability goal — you do not
*finish* being a better engineer. Four of the six metrics here are unbounded
counts, so under the spec as written this goal has no computable progress at all.

### The deeper problem: this goal should not have a percentage

Forcing 0–100% onto "become a stronger engineer" would be the exact failure the
honesty rules exist to prevent. There is no denominator. Any percentage would be
invented, and inventing it would quietly teach the user that the system's numbers
are decorative.

**Resolution:** goals gain a `measurementMode`:

| Mode | Reports | For |
|---|---|---|
| `completion` | 0–100% toward a definable end | ₹5L MRR, ₹1 Cr, Ship v1 |
| `momentum` | Rate vs. expected rate — **no percentage** | Capability, health, consistency |

Momentum goals report a momentum status (`advancing` / `steady` / `slowing` /
`stalled`, per `04` §3), an activity summary, and any bounded level metrics
**shown as levels, not averaged in**:

```
Become a stronger engineer                              ADVANCING
last 90 days:  3 projects shipped · 11 features · 7 architecture decisions
               2 AI projects · 4.2 h/wk learning (target 5)
engineering confidence  6/10  ▲ from 5 in March
```

Crucially, `engineering_confidence` is *not* blended into a composite score. It
is bounded and could be normalised — but averaging a self-rated confidence with a
shipping rate produces a number that means nothing. Two honest signals beat one
dishonest one.

→ **Change 5: `measurementMode`, rate contributors, level indicators.**

This is also why the momentum vocabulary from the theme decision (`13` D7) turned
out to be load-bearing rather than cosmetic — it was the first half of a change
this case completes.

---

## Case 4 — Aryesh OS: ship, then adopt

```
Area: Personal / Building
└─ Theme "Build Aryesh OS into a system I actually use"    [undated]
   ├─ Goal "Ship v1"                            [dated, COMPLETION]
   │    milestones (weighted):
   │      measurement engine 0.25 · visualization/dashboard 0.20
   │      goal tracking 0.15 · finance integration 0.15
   │      Claude Code integration 0.15 · mobile companion 0.10
   │    measures: integrations_connected
   └─ Goal "Adopt as my daily progress system"  [undated, MOMENTUM]
        rate:  weekly_active_usage (target 5 days/wk)
        level: goals_tracked, metrics_tracked
```

### Finding: this is two goals, not one

"Ship v1 **and** establish it as my personal progress system" contains a
conjunction hiding two different measurement shapes. Shipping is completion —
six milestones, an end state. Adoption is momentum — a habit that either holds
or decays, with no finish line.

Merged, they would produce the product's most likely self-deception: **100% built
and never used, reporting as done.** Split, the failure is visible — `Ship v1:
achieved` alongside `Adopt: stalled` is an unmissable and accurate statement.

### Break 4 — double counting

The proposed metric `core_modules_completed` (target 6) and the six milestones
measure *the same underlying events*. Weighted together they would count each
completed module twice, and progress would run roughly double the truth while
looking entirely legitimate.

**Resolution:** milestones win — they are dated, individually weighted, and
visible. `core_modules_completed` becomes either a `measures` diagnostic derived
from milestone state, or is dropped.

More usefully, this generalises: the engine should **detect contributor overlap
at configuration time** and warn. Two contributors derived from the same source
events, or a metric whose collector reads the same table a milestone set tracks,
are cheap to flag and expensive to discover months later in a number you trusted.

→ **Change 6: double-count detection at configuration time.**

---

## 5. The activity-vs-advancement test

> *"Task completion should support project evidence, but should not
> automatically become goal progress unless explicitly configured."*

Traced through the model as specified:

| Step | Behaviour | Verdict |
|---|---|---|
| Task closed | Updates its project's task counts | ✅ evidence |
| Project progress | Computed from completed tasks weighted by estimate | ⚠️ **activity as progress** |
| Project → Goal | Only if a `contributes_to` edge exists, with an explicit weight | ✅ explicit |
| Task → Goal | **No direct path exists** | ✅ correct |

The requirement is satisfied at the goal boundary — nothing reaches a goal
without a deliberate weighted edge. But the **project layer quietly violates the
spirit of it**: "13 of 21 tasks closed = 62% done" is activity wearing
advancement's clothes, and if that project carries 30% of a goal's weight, task
churn does move goal progress.

→ **Change 7: project progress becomes explicit about its basis.**

```ts
projectProgress:
  | { mode: 'outcome';   metricId }     // preferred — a real outcome measure
  | { mode: 'milestone'; }              // deliverable-based
  | { mode: 'manual';    value }        // judgement
  | { mode: 'task_based' }              // DEFAULT — flagged as an activity proxy,
                                        // confidence capped at 0.6
```

`task_based` remains the default because it is the only mode that works with zero
configuration — but it is labelled in the UI as an activity proxy, its confidence
is capped, and when such a project is a heavy contributor to a goal, the goal is
marked `degraded` with that reason. The user is told, in the place where it
matters, that the number underneath is counting motion rather than distance.

---

## 6. Changes applied to the spec

| # | Change | Doc | Severity |
|---|---|---|---|
| 1 | `measures` accepts `goal` endpoints — diagnostic metrics that never score | `02` §2 | minor |
| 2 | Leading-indicator annotation (`leads`, lag days) on `measures` edges | `03` §10 | additive, Phase 3 |
| 3 | Metric components + velocity attribution (contributions vs returns) | `03` §11 | **substantive** |
| 4 | Pluggable projection models; `compounding` with an explicit rate assumption and scenario fan | `04` §2 | **substantive** |
| 5 | Goal `measurementMode: completion \| momentum`; rate contributors; level indicators shown separately | `03` §4, `04` §3 | **substantive** |
| 6 | Contributor overlap detection at configuration time | `03` §5 | minor |
| 7 | Explicit project-progress basis; `task_based` capped at 0.6 confidence and labelled a proxy | `03` §4 | moderate |

## 7. What this exercise says about the engine

The core held: weighted contributors, `contributes_to` as the only scoring path,
confidence, and explainability all survived contact with four genuinely different
goals. Nothing needed to be redesigned.

What it did *not* have was **a way to say "this cannot be measured as a
percentage"** — and three of the four cases needed that, in different forms:
diagnostic-only metrics (Case 1), attributed components (Case 2), and momentum
mode (Case 3). Every one was the same underlying mistake: assuming that anything
worth tracking is worth expressing as a fraction of a target.

That assumption is what turns progress systems into vanity dashboards. Catching
it against four real goals before writing code is worth considerably more than
the two hours it cost.
