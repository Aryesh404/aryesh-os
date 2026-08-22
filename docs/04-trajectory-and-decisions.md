# 04 — Trajectory & Decision Intelligence

**Understand → Decide.** `03` produces honest numbers. This layer turns them
into the four answers the product exists to give: *am I on track, what is
slowing me down, where is my attention actually going, and what should I do
next?*

Architectural stance: **deterministic analysis first, AI second.** Every finding
here is computed by ordinary code from snapshots and graph structure. The AI's
job is to explain and prioritise findings that already exist — never to discover
them. That keeps the system cheap, reproducible, testable, and unable to
hallucinate a blocker that isn't there.

## 1. Velocity

From the snapshot series (`03` §7):

```
velocity(w) = (progress(t) − progress(t−w)) / w          // progress per day
required    = (1 − progress) / daysRemaining
paceRatio   = velocity / required
```

Velocity is computed over 7-, 30-, and 90-day windows. The 7-day figure is
reactive and noisy; the 30-day is the one shown by default. Both are available,
because a goal where 7d ≫ 30d is accelerating and that is worth seeing.

## 2. Projection

Projection is **pluggable**, because not everything grows in a straight line.

```ts
type ProjectionModel =
  | { kind: 'linear' }                                    // default
  | { kind: 'compounding'; annualRate: number;            // user-stated assumption
      contribution: { amount: number; per: 'month' } }
  | { kind: 'none' }                                      // honest refusal
```

**Linear** (the default):

```
projectedProgressAtTarget = progress + velocity₃₀ · daysRemaining   // dated only
projectedCompletionDate   = today + (1 − progress) / velocity₃₀     // always available
```

**Compounding** — required for anything fed by returns on a growing base. A
corpus with a monthly contribution and compounding returns grows on a convex
curve, and projecting it linearly **systematically under-predicts**, potentially
by years over a long horizon, while looking entirely reasonable:

```
FV = P·(1+r)ⁿ + C·[((1+r)ⁿ − 1) / r]
     └ current            └ contribution per period at rate r
```

The honesty cost is unavoidable and therefore made explicit: **a compounding
projection requires an assumed return rate, which is a guess.** So:

- the rate is a **visible, user-set field**, never a hidden default;
- the chart draws a **scenario fan** (conservative / expected / optimistic —
  e.g. 8% / 10% / 12%), not a single line;
- only the **controllable component** (`03` §11) is extrapolated from observed
  behaviour. The return component comes from the stated assumption — never from
  extrapolating recent performance, because six good months are not a trend.

A single confident curve resting on an invented return rate is exactly the
astrology this section exists to prevent (`14` Case 2).

`requiredPace` and `paceRatio` exist **only when a target date exists**. For
undated goals and themes the engine returns `paceRatio: null`, and every
downstream consumer — status, ranking, charts — branches on that rather than
substituting a default. A null here is meaningful, not missing.

Wrapped in an uncertainty band derived from the dispersion of the windowed
velocities, widened by `(1 − confidence)` from `03` §6. The chart draws the band,
never a bare line (`05` §5).

**Honesty gates, enforced in the engine and not left to the UI:**

| Condition | Behaviour |
|---|---|
| Fewer than 5 snapshots | No projection. "Not enough history yet — 5 days of data needed." |
| Velocity ≤ 0 over 21 days | No completion date. Status is `stalled`. |
| Confidence < 0.4 | Projection shown greyed, band doubled, labelled "low confidence" |
| Target date passed | Projection replaced with an overdue assessment |

A projection from three data points is astrology. The system refuses to draw it,
which is the single most important trust decision in this document.

## 3. Trajectory status — two vocabularies

Because themes and many goals are **not calendar-bound** (`02` §1), there is no
universal "required pace". A goal without a target date has no deadline to be
behind. Forcing one vocabulary onto both would mean either inventing fake
deadlines or reporting "on track" for something with no track.

The engine selects a vocabulary from the goal's `measurementMode` (`03` §4.0),
falling back to the presence of a target date:

```
measurementMode === 'momentum'  → momentum vocabulary, no percentage
measurementMode === 'completion' && targetDate  → dated vocabulary
measurementMode === 'completion' && !targetDate → momentum vocabulary,
                                                  percentage still reported
```

That middle-ground case is real: "₹1 Cr corpus" is a genuine completion goal that
may carry no deadline. It has a meaningful percentage but no pace to be behind
on, so it shows progress *and* momentum, and never a verdict about lateness.

### Dated — judged against a deadline

| Status | Condition | Meaning |
|---|---|---|
| `ahead` | paceRatio ≥ 1.15 | Faster than needed |
| `on_track` | 0.90 ≤ paceRatio < 1.15 | Will land close to target |
| `at_risk` | 0.60 ≤ paceRatio < 0.90 | Recoverable with a change |
| `behind` | paceRatio < 0.60 | Will miss without intervention |
| `stalled` | velocity ≈ 0 for 21+ days | Nothing is happening |
| `unknown` | insufficient data | Say so plainly |

### Undated — judged on momentum

| Status | Condition | Meaning |
|---|---|---|
| `advancing` | velocity₃₀ > 0 and ≥ velocity₉₀ | Moving, and not slowing |
| `steady` | velocity₃₀ > 0, within ±20% of velocity₉₀ | Consistent progress |
| `slowing` | velocity₃₀ < 0.8 × velocity₉₀ | Decelerating |
| `stalled` | velocity ≈ 0 for 21+ days | Nothing is happening |
| `unknown` | insufficient data | Say so plainly |

For undated items the projection reads as an **estimate, not a judgement**: *"at
your current pace, ~70% by mid-March"* — offered as information, never as
"behind". Nothing is late that was never due.

`stalled` and `unknown` are shared, which matters: those two are the states the
user most needs to see, and they mean the same thing either way.

### Roll-up across the mix

A theme containing both dated and undated goals reports the **undated
vocabulary** for itself, with dated children keeping their own status. A theme
is a strand of intent, not a deadline, and averaging a `behind` with an
`advancing` into a single number would destroy the information in both.

Status drives colour everywhere (`05` §1) — one palette, two vocabularies mapped
onto it, so a colour means the same thing on a chart, a graph node, and a list
row.

## 4. Attention allocation

The analysis that answers *am I working on what I said matters?* — and, in my
judgement, the most valuable thing this product can tell its user.

Each Area carries an optional `targetShare` (intended share of attention).
Actual share is computed over a trailing window from observable activity:

```
activity(area) = w₁·tasksCompleted + w₂·projectActivity + w₃·readingsRecorded
               + w₄·executions + w₅·timeLogged (Phase 4, optional — 13 D6)
actualShare(area) = activity(area) / Σ activity
gap(area) = actualShare − targetShare
```

Surfaced as an allocation chart (`05` §5) plus plain findings: *"Business is 46%
of your activity against a 25% target. Learning is 3% against 15% — and the
Career goal depending on it has been stalled 34 days."*

Two honest caveats, stated in the UI rather than buried: activity is a proxy for
attention, and unmeasured work is invisible. The weights are user-adjustable, and
an area with no observable activity type is excluded rather than shown as zero.

## 5. Blocker analysis

Deterministic detectors over the graph and snapshots. Each returns typed findings
with evidence:

| Detector | Finds |
|---|---|
| **Dependency chain** | Incomplete `depends_on` chains ahead of active work; reports the longest chain and its root |
| **Starved goal** | A goal whose every contributor has been inactive for N days |
| **Stalled contributor** | The specific contributor dragging a goal's velocity, ranked by weight × shortfall |
| **Overcommitment** | Active projects in an area exceeding capacity, or the sum of required velocities being infeasible given historical throughput |
| **Stale measurement** | Metrics past `2 × cadence` — the goal cannot be assessed |
| **Low-confidence goal** | Confidence < 0.5, with the specific cause |
| **Silent drift** | Progress positive but decelerating for 3 consecutive windows |
| **Orphaned work** | Active projects/tasks contributing to no goal — real work with no stated purpose |

"Orphaned work" deserves a note: it is often the most interesting finding,
because it surfaces either a goal the user forgot to write down or effort that
genuinely shouldn't be happening. Both are worth knowing.

## 6. Insights

```ts
interface Insight {
  id; kind: InsightKind              // the detector that produced it
  severity: 'info' | 'notable' | 'urgent'
  title: string                      // deterministic, templated
  body: string                       // templated; optionally AI-enriched
  evidence: { ref: EntityRef; label: string; value?: number }[]
  entityIds: string[]
  state: 'new' | 'seen' | 'acted' | 'dismissed' | 'stale'
  firstSeenAt; lastSeenAt; expiresAt?
  aiEnriched: boolean
}
```

**Pipeline:** detectors run on events and nightly → findings are deduplicated
against open insights (same kind + same entities = update `lastSeenAt`, not a new
row) → ranked by severity × goal importance × recency → **only the top few are
sent for AI enrichment**, which adds interpretation and a suggested next action.

This ordering is the cost-control decision from `13` D4 made structural: cheap
deterministic detection runs constantly; expensive AI reasoning runs only on
findings that already passed a relevance bar.

Anti-noise rules: dismissing an insight suppresses that pattern for a
configurable window; unacted insights go stale rather than accumulating; and
every insight must cite evidence — a claim without a clickable basis is not
shown. A feed that cries wolf gets ignored, and an ignored feed is worse than no
feed at all.

## 7. Attention ranking — "what matters right now"

A single ranked list, computed deterministically:

```
score(item) = importance
            × urgency(daysToTarget)        // dated: rises near the target
                                           // undated: constant 1.0
            × shortfall                    // dated:   1 - paceRatio
                                           // undated: 1 - normalisedMomentum
            × unblocked(0 if blocked by an incomplete dependency)
            × leverage(how many goals this item contributes to)
            × freshnessPenalty(recently surfaced and ignored)
```

Returns a short list — five to seven items — each with a one-line reason and a
direct action. **Never an unbounded queue**: a list of forty things is a to-do
app, and the product's job is to say which few things matter.

## 8. Decision intelligence

Decisions (`02` §1) are recorded with rationale, alternatives, confidence, and
reversibility, linked to the evidence that informed them via `informed_by`.

**Decision support** (before): when a decision is being recorded, the system
attaches the relevant current state — affected goals, their trajectories, the
metrics involved — so the rationale is written against real numbers rather than
a vibe. It does not make the decision.

**Decision review** (after): at `reviewDate`, the decision resurfaces alongside
what the linked metrics and goals *actually did since* — the diff between
expected and observed outcome. The user records a verdict.

**Decision quality** (over time), once there are enough reviewed decisions:

- **Calibration** — stated confidence vs. actual outcomes. Someone who says 80%
  and is right 50% of the time learns something genuinely useful.
- **Reversibility discipline** — are irreversible decisions taken with more
  evidence than reversible ones?
- **Review follow-through** — what fraction of decisions actually get reviewed.

This is the "measure again" that closes the loop back onto the user's own
judgement rather than only onto their goals — and it's the part of the system
that compounds.

## 9. Honesty rules (engine-enforced)

1. Never project from fewer than 5 snapshots.
2. Never show a point estimate without its band.
3. Never treat stale data as current — degrade confidence and say why.
4. Never assert causation. Detectors report co-occurrence; the wording is
   "coincides with", not "because of".
5. Never hide a decline. Falling progress is surfaced with its cause.
6. Every claim carries clickable evidence.

These are testable properties, and they are tested. They are also the entire
basis on which the user will or won't believe the system a year from now.
