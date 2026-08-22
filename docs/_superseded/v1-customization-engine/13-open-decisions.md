# 13 — Open Decisions

The brief says not to pretend the architecture is complete while important
decisions are unresolved. These are the ones I did not make for you, each with a
recommendation and the cost of getting it wrong.

Ten decisions. **D1–D4 block Phase 1.** D5–D10 can be answered later without
rework, because the design leaves an interface where the choice goes.

## Resolutions (2026-08-20)

| # | Decision | Resolved | Consequence |
|---|---|---|---|
| **D1** | Storage | **libSQL now, revisit with real usage data** | Proceed on libSQL. The repository layer in `packages/db` is the thing that keeps this reversible, so it is a hard review item at M2, not a formality — see the M2 benchmark gate in `12` |
| **D2** | App shell | **Web app now, Tauri v2 wrapper at Phase 2** | Phase 1 builds a browser app, but the shell abstraction (hotkeys, notifications, secret storage) is defined behind interfaces from M1 so the wrapper is additive |
| **D4** | Claude billing | **Deferred — cost model to be discussed** | Phase 3 design is on hold. Phases 1 and 2 are unaffected and proceed. See §D4 below for the worked numbers |
| D3, D5–D10 | — | Open | None block Phase 1 |

---

### D1 — Storage engine: libSQL (embedded) vs. Postgres — *resolved: libSQL, revisit at M2*

I recommend **libSQL**. No Docker on this machine, one user, and the whole OS
becomes a single copyable file, which solves the data-ownership requirement
outright. Native vector columns avoid the `sqlite-vec`-on-Windows problem.

Choose Postgres instead if you expect to host this on a server soon, want
multiple concurrent writers, or want `pgvector` and mature JSONB tooling.

*Cost of being wrong:* low-to-moderate. All SQL sits behind repositories in
`packages/db`, so a port is a driver + dialect + vector-store swap. Recursive
CTEs and generated columns exist in both.

---

### D2 — Shipping surface: browser app vs. desktop app (Tauri) — **blocks M1**

The brief calls this an operating system and a command center, and it will read
your local repositories under `C:/Projects`. A browser tab is a slightly odd
home for that.

I recommend **starting as a local web app and wrapping in Tauri v2 at Phase 2**.
The React code is unchanged; the wrapper adds a real app window, global hotkeys
(`Ctrl+Space` from anywhere — a genuine command-center feature a browser cannot
give you), OS notifications for approvals, tray presence, native secret storage
via DPAPI, and no "which tab was that?" problem.

*Cost of being wrong:* low if decided now, moderate later — a few Tauri-specific
APIs and a packaging pipeline. But deciding *now* keeps the shell abstraction
clean from day one.

---

### D3 — Mobile access path — **blocks Phase 6, decide now for auth design**

Approvals are the killer mobile feature: Claude asks, you tap Allow from
anywhere. That requires the API reachable from your phone.

I recommend **Tailscale** — a private mesh, zero exposed ports, no certificate
management, free at this scale. Alternatives: a Cloudflare tunnel with access
policies (public hostname, more moving parts), or LAN-only (approvals only work
at your desk, which mostly defeats the point).

*Why it matters now:* it decides whether auth must be internet-grade in Phase 1
(passkeys, strict session handling) or can be minimal.

---

### D4 — Claude authentication and billing — *deferred by decision; Phase 3 on hold*

`ANTHROPIC_API_KEY` is not set on this machine, and Claude Code 2.1.216 is
installed — so you are presumably on a Claude subscription today.

The Agent SDK documentation states that Anthropic does not allow third-party
developers to offer claude.ai login or subscription rate limits for products
built on the SDK, absent prior approval. Aryesh OS is personal software you run
for yourself, not a product offered to others, so that restriction is not aimed
at this — but the supported, documented path for SDK usage is **API key auth**,
and that is what I would build against.

Practical consequence: executions cost money per run, which is exactly why `07`
§10 makes cost a first-class, budgeted, visible metric.

#### The worked cost model

Rates as of 2026-08-20: Opus 5 $5 / $25 per MTok (in/out), Sonnet 5 $3 / $15,
Haiku 4.5 $1 / $5.

| Execution type | Agent / model | Rough tokens | Cost per run |
|---|---|---|---|
| "What matters right now?" | Analyst, Opus 5 | ~12k in, 1.5k out | **~$0.10** |
| Planning pass | Planner, Opus 5 | ~20k in, 3k out | **~$0.18** |
| Finance/business analysis | Sonnet 5 | ~15k in, 2k out | **~$0.08** |
| Memory maintenance sweep | Haiku 4.5 | ~30k in, 3k out | **~$0.05** |
| **Real coding execution** | Developer, Opus 5, 20–30 turns | 600k–900k in (accumulating), ~40k out | **$1.50–$5.00** |

The coding number dominates everything else, and its spread is wide because
agentic runs resend a growing history each turn. Prompt caching is the main
lever — which is exactly why `07` §4 fixes a stable prefix ordering rather than
assembling context in whatever order is convenient.

**Monthly, by usage pattern:**

- Light (3 coding runs/week, a few analyses daily): **~$50–70/mo**
- Moderate (1–2 coding runs/day): **~$120–200/mo**
- Heavy (continuous delegation): **$300+/mo**

#### The cost trap worth designing against now

Scheduled background work is where this quietly goes wrong. An insight-generation
pass on Opus 5 every hour is ~$0.15 × 24 = **$3.60/day, ~$108/month, spent on
work you never asked for** — and most of those passes will find nothing new,
because your data did not change much in an hour.

Three mitigations, all in the design already:

1. **Event-triggered, not clock-triggered.** Insight generation runs when
   something meaningful changed (goal progress moved, an execution completed, a
   transaction landed), with a floor on frequency — not on a cron tick.
2. **Model tiering by job.** Detection and triage on Haiku 4.5; only escalate to
   Opus 5 when there is something worth reasoning about. A cheap classifier
   deciding whether to spend on an expensive analysis pays for itself immediately.
3. **Budgets are enforced, not advisory** (`07` §10) — per execution, per agent,
   per day, and globally, with spend as a visible widget.

#### Recommendation

Build the bridge against **API key auth** — it is the documented, supported path
for programmatic SDK use, and it is what makes per-execution cost attribution
possible at all. Keep using your Claude subscription for interactive Claude Code
work as you do today; the two coexist and are billed separately.

Set the initial global ceiling at **$50/month** with a hard stop, then raise it
once you have two weeks of real spend data from your own usage. A ceiling that
is too low is a mild annoyance; one that is too high is discovered on a bill.

**Still needed from you:** confirmation of API key billing and the opening
monthly ceiling. Nothing before Phase 3 depends on it.

---

### D5 — Embedding provider for memory — *deferrable*

Options: a hosted embedding API (best quality, another key, sends memory text
off-machine), a local model via `transformers.js` (fully private, ~100 MB,
slower, adequate), or **ship FTS + graph retrieval first and add vectors in
Phase 7**.

I recommend the third: retrieval is behind an interface, memory volume in the
first months is small enough that keyword + graph proximity performs well, and
this avoids a privacy decision you do not need to make yet.

---

### D6 — Chart library — *deferrable to Phase 2*

**visx** (composable, full control, more code) vs. **Recharts** (fast, less
control, awkward for the denser custom visuals like trajectory and cash-flow).
I lean visx given the density this UI wants, but it is a widget-registry-local
choice — one directory per widget kind means both can coexist.

---

### D7 — Currency, locale, and financial conventions — *affects the finance seed*

I have assumed **INR primary** with multi-currency support present from the start
(money stored as integer minor units + currency code — a decision that is
painless now and painful to retrofit).

Open: does business finance need GST tracking and Indian FY boundaries
(April–March) rather than calendar years? If yes, that shapes the finance seed
pack, the forecast buckets, and every date-grouped finance widget. It is a seed
concern, not an engine concern, but I would rather seed it right.

---

### D8 — Custom traits: ever? — *architectural, decide by Phase 7*

Traits are code contracts. Letting users author them means letting users author
code. My recommendation is **no custom traits**: ship a rich built-in set, and
let formula fields plus custom relation semantics cover the long tail. If a real
need appears, the honest version is a plugin system, not a scripting box in a
settings page.

Flagged because it is the one place where "everything is customizable" has a
deliberate floor, and you should agree with where that floor sits.

---

### D9 — Phase 1 seed-pack breadth — *scope*

The seed pack could ship all 17 entity types now, or only what Phase 1 can
actually exercise (goal, milestone, project, task, note, decision) with business
and finance types arriving with their phases.

I recommend **the full set of type definitions, with only the Phase 1 types
wired into navigation**. It gives you something real to explore immediately
without pretending finance features exist. Cheap either way, since a pack is
data.

---

### D10 — Mobile: Expo vs. PWA — *deferrable to Phase 6*

A PWA is far less work and shares the web codebase, but push notifications on
iOS are limited and unreliable — and push is the entire point of the mobile
companion (approvals). **Expo** gives real push and a native feel for a small,
deliberately thin app.

I lean Expo, but this is genuinely re-decidable at Phase 6 with no cost incurred
before then.

---

## Also unresolved, and honestly so

- **Project Intelligence depth** (brief §13). Detecting the stack for a React app
  is easy; detecting it for a Spring Boot project, an arbitrary folder that is
  not a git repo, or "Website Templates part 1" is not. I have specified the
  project profile as an *editable* record populated by analysis rather than
  promising accurate auto-detection. How much detection effort Phase 4 spends is
  an open question I would answer with real results from your actual folders.
- **Workflow engine expressiveness** (brief §20). Trigger → conditions → actions
  covers your stated example. Whether it needs branching, loops, and human-task
  steps — i.e. whether it becomes a real workflow language — should be decided by
  looking at the first ten workflows you actually want, not designed up front.
- **Predictive analysis** (brief §7 of the Intelligence phase). "Forecast cash
  flow" from a few months of transactions is a statistics problem where naive
  approaches produce confident nonsense. I would rather define this properly at
  Phase 5 with your real data than specify it now.
