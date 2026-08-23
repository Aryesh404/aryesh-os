# 15 — Phase 2 Proposal

Status: **For approval. No Phase 2 code written.**

Written after auditing the repository at `de99e13` (Phase 1 complete, M1–M8,
264 tests green) against the four real goals in `docs/14`.

---

## 0. Three corrections before anything else

The brief listed Phase 1 as providing capabilities that are not actually there.
Planning on top of them would produce a wrong plan.

| Claimed | Reality |
|---|---|
| **Decisions** | **Do not exist at any layer.** No table, no repository, no router, no UI. `docs/09` specifies the table; M2 scoped it to Phase 3 and it was never built. The `decision` references in code are endpoint comments and test fixtures. |
| **Collectors** | The engine exists and is tested, but a metric's `collectorKey` **cannot be set from the UI**. Every computed metric and the entire backfill path is unreachable without hand-editing the database. |
| **Themes** | Creatable, but **a goal cannot be attached to one** — `themeId` is never set anywhere in the web app. Themes are currently decorative. |

Two more of the same kind:

- **Metric components** (contributions vs returns, `docs/03 §11`) are supported
  by the engine and storage but absent from the metric creation form.
- **`expectedRate`** on a contributor — the thing that makes a momentum goal
  score against a *stated* cadence rather than its own trailing average — has no
  UI at all.
- **Finance has zero screens.** `accounts` and `transactions` have working
  routers; no page consumes them.

This is the single most important finding of the audit, and it shapes
everything below:

> **The engine is roughly a milestone ahead of the interface.** Phase 1 built
> more capability than Phase 1 exposed. The cheapest, highest-value Phase 2 work
> is not new machinery — it is making what already exists reachable.

---

## 1. Phase 1 Audit

### What is genuinely useful today

**The explain drill-down.** Clicking a number and seeing `140000 of 500000,
baseline 0` next to a weight and a method is the thing this product does that
nothing else does. It is the reason to trust the number above it.

**The refusals.** "Not enough history yet — 5 days of data needed, 3 so far"
rendered where a chart would be. "No deadline" where a pace ratio would be. This
is a genuine competitive difference and it survives all the way to the wire
(422, not 500). Do not weaken it.

**The progress-model editor.** Dragging a weight and watching the number
renormalise live, with the figure always coming back from the engine, works and
feels correct. Better than I expected.

**Quick capture.** `monthly_revenue 152000` → recorded → goal recomputed, in one
keystroke sequence. This is the only interaction in the product that is faster
than not using the product.

### What still feels unfinished

**Home is a list, not a briefing.** It shows three rings and their current
state. It answers "what are my goals" — which I already know — and not "what
happened". There is no reason to open it twice in a week.

**Nothing shows change.** Every surface shows a *level*. Not one shows a
*delta*. The system stores a daily snapshot series and never once says "this
moved". That is the largest single gap between what the data supports and what
the product says.

**Work is disconnected.** Projects, tasks and habits exist on their own page with
no visible relationship to goals unless you go to a goal and add them as
contributors. The page answers "what work exists", which is the least
interesting question about work.

**Themes lead nowhere.** You can make one. Nothing uses it.

### Technically correct but poor UX

**Adding a contributor is a two-dropdown archaeology exercise.** You pick a kind,
then pick from every metric/project/habit in the system by name. With 30 metrics
this becomes unusable, and it offers no hint about which contributor would be
sensible.

**Weights are relative integers on a 0–10 slider, displayed as normalised
percentages.** Both numbers are on screen. It works, but "set this to 7" has no
meaning to the user — only the resulting share does. The slider should probably
*be* the share.

**Metric creation asks for `baseline` and `target` with no sense of what they
do.** The hint text explains the "never zero" rule well, but the form cannot
show you what your progress *would be* — even though `metrics.preview` exists in
the API precisely for that and is unused.

**The momentum vocabulary is right but unexplained.** A goal reading `slowing`
gives no way to ask "slowing compared to what?" The answer exists (30-day vs
90-day velocity) and is not shown.

### What creates unnecessary friction

1. **Entering readings requires navigating to Metrics.** Quick capture solves
   this only if you remember the metric key exactly. There is no fuzzy match.
2. **No mobile.** Readings happen away from the desk — after a client call, at
   the gym, when a payment lands. By the time you are at the laptop the moment
   has passed. This is the main threat to the measurement habit, which is the
   whole spine.
3. **Nothing prompts.** The system knows a metric is stale and only shows it if
   you happen to visit Metrics or Home.
4. **Finance must be entered as manual metric readings**, because there are no
   account or transaction screens — so the ₹1 Cr goal is tracked by typing a
   number you computed elsewhere. The collectors that would derive it exist and
   cannot be wired up.

### What would stop me opening it every day

Bluntly: **there is no answer waiting for me.** The product currently rewards
input and returns a number I could have estimated. Until opening it tells me
something I did not know — what moved, what stalled, what needs attention — the
honest prediction is that it gets used for a week and then not.

That is the Phase 2 problem, and it is a product problem, not a graphics one.

### What information is still hard to understand

- **Why did this change?** The breakdown shows contributor *values*, never their
  movement. A goal falling from 45% to 41% gives no clue which contributor did it.
- **Is this good?** `0.43%/day` is precise and meaningless without a reference.
- **What is my money actually doing?** No finance surface exists at all.
- **How am I spending attention vs how I said I would?** `Area.targetShare` is
  captured in the UI and consumed by nothing.

### Decisions the system cannot help with yet

- *"Should I take this client?"* — no capacity or commitment model, no decisions.
- *"Am I over-invested in Business at the expense of Career?"* — attention
  allocation is designed (`docs/04 §4`) and unbuilt.
- *"Is my corpus growing because I'm saving or because the market is up?"* — the
  engine supports the decomposition; the UI cannot create it.
- *"What should I do today?"* — attention ranking is designed and unbuilt.
- *"Was that a good decision?"* — decisions do not exist.

Three of the four north-star questions are unanswered. The product currently
answers **"how am I progressing"** and nothing else.

### What should now be left alone

| Leave alone | Why |
|---|---|
| `packages/intelligence` | Pure, property-tested, and correct. Extend it; do not restructure it. |
| The honesty gates | `docs/04 §2`. Every one of them earns its keep. Never route around them. |
| Storage schema and repositories | libSQL passed its benchmark by an order of magnitude. Audit, soft delete, and optimistic version work. |
| The event bus | It is the seam automations arrive through. It already works. |
| tRPC error mapping | 422-not-500 survives to the wire. Do not touch it. |
| Snapshot semantics | Never backfill. This rule was won the hard way in M7. |

---

## 2. The four real goals, tested against the product

| Goal | Can Phase 1 hold it? | What is missing |
|---|---|---|
| **₹5L MRR by March 2027** | **Yes, fully.** Metric + readings + trajectory + projection all work. | Automation: revenue should come from transactions via `finance.revenue`, which cannot be wired up. |
| **₹1 Cr corpus** | **Partially.** Progress works as a plain metric. | The whole point — separating contributions from returns — is unreachable. Compounding projection cannot be configured either. As entered today it would project *linearly*, which `docs/14` establishes under-predicts by years. |
| **Become a stronger engineer** | **Mostly.** Momentum mode, unbounded metrics and the momentum vocabulary work. | `expectedRate` cannot be set, so it silently scores against its own trailing average — which means it can never report "advancing", only "steady". |
| **Ship Aryesh OS and adopt it** | **Yes for shipping. No for adoption.** Milestones work. | `weekly_active_usage` must be entered by hand, which is exactly the metric you will forget to enter. It should be collected automatically. |

**At-a-glance test: fails.** Opening Home with all four entered gives four rings
and four status words. It does not say which one needs me today, what changed
this week, or where my money is.

---

## 3. Biggest product gaps, ranked

| # | Gap | Why it ranks here |
|---|---|---|
| **1** | **No sense of change.** Nothing anywhere shows a delta. | Kills the daily-open habit. The data already exists; only the surface is missing. Highest value per unit of work in the entire product. |
| **2** | **Engine capabilities unreachable.** Collectors, components, expectedRate, themes, finance. | Phase 1 is under-delivering itself. Cheap to fix, and two of your four real goals are degraded without it. |
| **3** | **No decision support.** No attention ranking, no decisions, no attention allocation. | Three of four north-star questions unanswered. Larger build than #1 and #2. |
| **4** | **No finance visibility.** | One of four real goals; currently a hand-typed number. |
| **5** | **Home is not a briefing.** | The fix mostly falls out of #1 and #3. |
| **6** | **No mobile capture.** | Directly threatens the measurement habit, but a responsive/installable web app captures most of the value cheaply. |
| **7** | **Contributor picking and weighting UX.** | Real friction, but only during setup, which is rare. |
| **8** | **No graph.** | Genuinely last. See §6. |

---

## 4. Phase 2 North Star

> **Opening Aryesh OS tells me something I did not already know.**

Phase 1 made the numbers true. Phase 2 makes them *say something*. Every
milestone below is judged against a single question: after this ships, is there
a new reason to open the app tomorrow?

---

## 5. Proposed Phase 2 milestones

Four milestones. Roughly three weeks. Deliberately fewer than Phase 1's eight,
because most of this is surface over an engine that already works.

Each is verified in the running application, not only by tests — the Phase 1
lesson held every single milestone.

---

### M9 — Close the reachability gap *(~4 days)*

**Objective.** Make everything Phase 1 already computes reachable from the
interface. No new engine capability.

**User-visible outcome.** All four real goals can be entered exactly as
`docs/14` models them, with no database editing.

**Scope**
- Finance screens: accounts, transactions, category assignment.
- Attach a collector to a metric, and run backfill from the UI.
- Decomposed metrics: define components, record a reading against one.
- Configure a goal's projection model, including compounding with its stated
  return rate and scenario fan.
- Set `expectedRate` when adding a rate contributor.
- Attach goals to themes; theme roll-up view.
- Live preview in the metric form using the existing `metrics.preview`.

**Acceptance criteria**
- The ₹1 Cr goal shows separated contribution vs return velocity.
- Its projection is compounding, with a visible, editable rate assumption.
- `monthly_revenue` is fed by `finance.revenue` from real transactions, and
  12 months of history backfill from them.
- The engineering goal scores against a stated cadence, and can read `advancing`.
- Every goal is attached to a theme, and themes roll up.

**Real-world test.** Enter the §7 dataset end to end without touching SQL.

**Risks.** Finance data entry is tedious; needs CSV import or it will not get
used. *Mitigation:* ship a minimal CSV importer for transactions in this
milestone, not later.

**Dependencies.** None. Everything it needs exists.

---

### M10 — What changed *(~5 days)*

**Objective.** The daily-open hook. Turn the snapshot series into a briefing.

**User-visible outcome.** Home leads with what moved since you last looked, not
with what your goals are.

**Scope**
- **Change detection** over the snapshot series: per-goal delta since last visit,
  7 days, and 30 days; contributor-level attribution ("this fell because
  `monthly_revenue` went stale, not because work stopped").
- **Deterministic detectors** from `docs/04 §5`, the cheap subset:
  stale measurement, stalled goal, silent drift, orphaned work, newly at-risk.
  No AI. Findings carry evidence, exactly as specified.
- **Attention ranking** (`docs/04 §7`): five to seven items, each with a reason
  and a direct action. Never an unbounded queue.
- **Home rebuilt as a brief**: what changed → what needs attention → what needs
  data → the goals themselves, in that order.
- Last-visit tracking, so "since you last looked" is real.

**Acceptance criteria**
- Home's first screen is deltas and findings, not rings.
- A goal that fell reports *which contributor* caused it.
- Every finding cites clickable evidence; a finding without evidence is not shown.
- Dismissing a finding suppresses that pattern for a window.
- With nothing changed, Home says so plainly rather than manufacturing a finding.

**Real-world test.** Use the app for a week with the §7 dataset. Every day,
Home should either tell you something true you did not know, or say clearly that
nothing moved. Track how often it is wrong or noisy — that number decides
whether the anti-noise rules need tuning.

**Risks.** **Noise is the failure mode.** A brief that cries wolf gets ignored,
and an ignored brief is worse than none. *Mitigation:* severity gating,
deduplication by `(kind, entities)`, dismissal windows, and a hard cap on items
shown. Prefer saying nothing.

**Dependencies.** M9 (a richer dataset makes findings meaningful).

---

### M11 — Visual intelligence and the always-there app *(~5 days)*

**Objective.** The `docs/05` visual system in full, applied to the surfaces that
now carry real information. Plus making the app instantly reachable.

**User-visible outcome.** It looks like the thing described in the brief, and it
is one keystroke away from anywhere.

**Scope**
- Full token pass: density modes, the complete motion layer, staggered entrances,
  number transitions from previous value, delta chips.
- **Sparklines everywhere** a number appears — a metric tile without its shape is
  a wasted opportunity.
- **Contribution breakdown** as specified in `docs/05 §5.3`: segment width is
  weight, fill is value, so "matters a lot and isn't moving" reads instantly.
- **Attention allocation chart** (`docs/04 §4`) — `Area.targetShare` finally
  consumed. Proxy-based, labelled honestly as a proxy.
- Trajectory chart polish: hover readout, band legend, the required-pace
  reference properly labelled.
- **Tauri v2 wrapper**: global hotkey to quick capture from anywhere, OS
  notifications for the daily brief, native secret storage.
- **Arrangeable home**: reorder and show/hide the widgets M10 proved were worth
  having. *Not* a generic dashboard builder — see §6.

**Acceptance criteria**
- Sustained 60 fps on the home screen with all widgets.
- `prefers-reduced-motion` removes every animation and keeps every delta.
- Global hotkey opens capture from another application, records a reading, and
  closes.
- Home layout survives a restart.
- Every animation on screen maps to a row in `docs/05 §4`'s table.

**Real-world test.** Use it for a week on the desktop app. Count how many
readings arrive via the global hotkey versus the browser — if the hotkey does not
dominate, capture friction is still too high.

**Risks.** Visual polish is unbounded work. *Mitigation:* the `docs/05` motion
table is exhaustive by design; anything not on it does not ship.

**Dependencies.** M10 (do not decorate widgets before knowing which matter).

---

### M12 — Decision support *(~5 days)*

**Objective.** The fourth north-star question. Make decisions first-class and
close the loop back onto your own judgement.

**User-visible outcome.** You can record why you decided something, and later
find out whether you were right.

**Scope**
- Decisions from the ground up: table, repository, router, UI (`docs/02 §1`).
- **Decision support before**: opening a decision attaches the current state of
  the goals and metrics it touches, so the rationale is written against real
  numbers.
- `informed_by` edges linking a decision to its evidence.
- **Decision review**: at `reviewDate`, resurface with what the linked metrics
  and goals actually did since — expected versus observed.
- **Calibration**, once enough reviews exist: stated confidence versus outcome.
- Decisions in search, in the palette, and on the goal detail page.

**Acceptance criteria**
- Recording a decision captures rationale, alternatives, confidence, and
  reversibility, with evidence attached.
- A decision due for review appears in the daily brief.
- Review shows the diff between what you expected and what happened.
- Calibration refuses to report until there are enough reviewed decisions —
  same honesty rule as projection.

**Real-world test.** Record three real decisions in the first fortnight (which
client to take, what to ship next, whether to raise your SIP). Set review dates.
The test is whether the review, when it arrives, is worth reading.

**Risks.** Decision logging is a habit that dies quickly if it feels like
paperwork. *Mitigation:* capture from the palette in one line; enrichment is
optional and can be added at review time.

**Dependencies.** M10 (the brief is where reviews surface).

---

## 6. What NOT to build yet

**The neural graph.** This is a change from the Phase 2 planned in `docs/12`,
and it is the most significant recommendation here.

`docs/06` says the graph "earns that only if it answers questions a list
cannot." With four goals, a dozen contributors and one level of nesting, a list
answers everything the graph would — and the graph would take a WebGL renderer,
a layout worker, and custom shaders to say it. Build it when the dataset makes a
list genuinely inadequate: multiple levels of goal nesting, dependency chains
worth tracing, and enough entities that structure is not memorable. Realistically
Phase 3, possibly later. The Sigma/graphology plan in `docs/06` stays valid; it
just is not next.

**A generic dashboard/widget builder.** `docs/07` specifies a full widget
registry with data-source descriptors. Building that before knowing which
widgets are worth having is designing a factory before knowing the product.
M11 ships arrangeable, hideable widgets over a fixed set. Generalise when a
second real need appears — the rule from `docs/00`.

**Custom fields UI.** The engine supports them; nothing has needed one yet.
Wait for a real want.

**A full mobile companion.** M11's Tauri wrapper plus a responsive, installable
web app covers quick capture and reading the brief at a fraction of the cost. A
native app is worth it only once the web version proves what mobile is used for.
`docs/13` D3 (Tailscale) still needs deciding before any of it.

**Integrations.** No adapter until the layer is designed, and no layer until
there is a second consumer to design against. See §9 — I would rather Phase 2
prove out finance-by-CSV first, then build the integration layer in Phase 3 with
Dhan and GitHub together, so the abstraction is derived from two real cases
rather than one imagined one.

**Claude Code execution and agents.** Unchanged from `docs/10`: Phase 5. Nothing
in this audit suggests moving it earlier. The analysis half (explaining findings
the detectors already produced) becomes attractive *after* M10 exists, not before.

**Automations.** Nothing in the audit argues for them. The event-bus seam is
already there when they are wanted.

---

## 7. What you should enter and use now

Enter this before M9 starts. It is what makes the audit above concrete, and
using it for two weeks will tell us more about Phase 2 than any further planning.

Some of it is not fully enterable until M9 — that is deliberate. **Note where you
hit a wall; those walls are M9's real acceptance criteria.**

### Areas
| Area | Colour | Target attention share |
|---|---|---|
| Business | `#38bdf8` | 40% |
| Finance | `#34d399` | 15% |
| Career | `#7c6bff` | 25% |
| Aryesh OS | `#fbbf24` | 20% |

### Theme 1 — Build Samarth into a stronger recurring business *(Business)*

**Goal: ₹5L MRR by March 2027** — completion, dated.

| Metric | Key | Unit | Direction | Cadence | Baseline → Target |
|---|---|---|---|---|---|
| Monthly revenue | `monthly_revenue` | currency | increase | monthly | your current → 500000 |
| Active clients | `active_clients` | count | increase | monthly | current → 8 |
| New clients / month | `new_clients_month` | count | increase | monthly | — (diagnostic) |
| Monthly profit | `monthly_profit` | currency | increase | monthly | — (diagnostic) |
| Leads / month | `leads_month` | count | increase | weekly | — (leading indicator) |

Progress model: **`monthly_revenue` only.** The rest attach as `measures`,
never as contributors — pipeline is evidence about future revenue, not a
fraction of it (`docs/14` Case 1).

Backfill 6–12 months of real revenue when you create the metric. **This is the
single highest-value thing you can enter**, because trajectory needs history and
you already have it.

Projects: your live client work. Milestones: first retainer signed, second
retainer, a repeatable delivery process.

### Theme 2 — Build long-term financial independence *(Finance)*

**Goal: ₹1 Cr invested corpus** — completion; date optional.

| Metric | Key | Notes |
|---|---|---|
| Invested corpus | `invested_corpus` | **Decomposed**: `contributions` (controllable) + `returns` (not) — needs M9 |
| Monthly investment | `monthly_investment` | your SIP |
| Savings rate | `savings_rate` | derived: `({income} - {expenses}) / {income} * 100` |

Projection: **compounding**, with your assumed return rate stated explicitly
(10% is a reasonable placeholder) and a fan at 8/10/12%. Needs M9.

Accounts: bank, SIP/investment, credit card as a liability.

### Theme 3 — Become a stronger engineer and builder *(Career)*

**Goal: Improve architecture and AI-assisted development** — **momentum, undated.**

| Metric | Key | Bounded? | Expected rate |
|---|---|---|---|
| Projects shipped | `projects_shipped` | no | 1 / month |
| Major features shipped | `major_features_shipped` | no | 3 / month |
| Architecture decisions | `architecture_decisions` | no | 2 / month |
| AI projects built | `ai_projects_built` | no | 1 / month |
| Learning hours | `learning_hours` | no | 5 / week |
| Engineering confidence | `engineering_confidence` | **yes**, 1–10 | — (level indicator) |

Expected rates need M9. Until then it scores against its own trailing average
and cannot report `advancing`.

### Theme 4 — Build Aryesh OS into a system I actually use *(Aryesh OS)*

Two goals, deliberately (`docs/14` Case 4) — shipping and adoption are different
shapes, and merging them hides the likeliest failure: built and never used.

**Goal A: Ship v1** — completion, dated. Milestones weighted:
measurement engine `0.25` · visualization `0.20` · goal tracking `0.15` ·
finance `0.15` · Claude integration `0.15` · mobile `0.10`.
*(The first three are already achieved — mark them.)*

**Goal B: Adopt as my daily system** — **momentum, undated.**
`weekly_active_usage` (5 days/week), `goals_tracked`, `metrics_tracked`.

### The point of this exercise

After two weeks, the question to answer is: **what did I keep wishing it
showed me?** Write those down as they occur. That list is worth more than this
entire document, and it should be allowed to reorder the milestones above.

---

## 8. Architecture that should remain stable

No new infrastructure is proposed. Phase 2 is surface over an engine that works.

```
existing measurement engine  →  existing core  →  existing API  →  better UX
        (extend)                  (extend)          (extend)        (build)
```

**Stays exactly as is:** libSQL and the schema, repositories with audit/soft
delete/versioning, the pure intelligence package, the event bus, tRPC and its
error mapping, snapshot semantics, auth.

**Extends without restructuring:** `packages/intelligence` gains `change/` and
`ranking/` modules alongside `progress/` and `trajectory/`; `packages/core`
gains services that compose them; the API gains routers.

### The one architectural question worth raising

**Snapshots only accrue while the API process is running**, because the
scheduler is in-process. Trajectory density therefore depends on how often you
open the app — and after M7 we correctly refuse to backfill missed days.

- *Problem:* a week of not opening it leaves a real hole in the series.
- *Why the current architecture cannot solve it:* nothing runs when the process
  does not.
- *Options:* (a) accept it — gaps are honest and the velocity maths already
  handles them; (b) Tauri autostart in M11, which makes the app effectively
  always-running on the machine you use; (c) a separate background service,
  which is real operational complexity for one user.

**Recommendation: (a) plus (b).** M11's Tauri wrapper mostly dissolves the
problem as a side effect, and no new infrastructure is justified. Worth naming
now so it is a decision rather than a surprise.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **The brief is noisy and gets ignored** | **High** | Anti-noise rules from `docs/04 §6` enforced from day one; prefer silence; measure wrongness during the two-week test |
| **Finance data entry never happens** | **High** | CSV import ships inside M9, not after |
| **Two weeks of use reveals a different priority** | Medium | That is the point of §7. The milestones are deliberately reorderable |
| **Visual polish expands without limit** | Medium | The `docs/05 §4` motion table is exhaustive; not on it, not shipped |
| **Decision logging dies as a habit** | Medium | One-line capture from the palette; enrich at review |
| **Deferring the graph disappoints the original vision** | Low | It is deferred, not cancelled; `docs/06` stays valid |
| **Honesty rules erode under pressure to look impressive** | **High** | They are engine-enforced and tested. Any Phase 2 change that weakens a gate must be argued explicitly in a doc |

---

## 10. Recommended next step

**Do not start M9 yet.**

1. **Enter the §7 dataset** — a couple of hours, mostly the revenue backfill.
2. **Use it for two weeks.** Record readings. Open it daily and notice when you
   have no reason to.
3. **Keep a list of "I wish it showed me…"**
4. **Then approve or reorder** the milestones above against that list.

The reason to insist on this: the strongest finding in this audit — that the
engine is ahead of the interface — came from reading the code, not from using
the product. Two weeks of real use will produce findings I cannot get any other
way, and the cost of building the wrong Phase 2 is far higher than the cost of
waiting a fortnight.

If you would rather not wait, **M9 is safe to start immediately** regardless of
what the two weeks reveal: everything it does is exposing capability that already
exists and is already tested, and every later milestone benefits from it.
