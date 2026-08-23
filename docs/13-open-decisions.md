# 13 — Open Decisions

## Resolved

| # | Decision | Resolution | Consequence |
|---|---|---|---|
| **D1** | Storage | **libSQL — gate PASSED at M2 with real data** | Benchmarked at 500k readings / 2 000 goals / 10k edges (5–10× realistic scale): graph projection 31 ms, 2y trajectory series 14 ms, goal list 4 ms, contribution lookup 5 ms — all inside the docs/01 §7 budgets with large margins. 125 MB on disk. No reason to revisit before Phase 4 |
| **D2** | App shell | **Web now, Tauri v2 in Phase 2** | `ShellAdapter` interface from M1 so the wrapper is additive. Unlocks the global hotkey, which is what makes "command center" literal |
| **D4** | Claude billing | **Deferred; cost model worked in §D4** | Claude is now Phase 5, so this blocks nothing for months |
| **D6** | Charts | **Hand-rolled SVG, not visx** | The trajectory chart needs two linear scales, a path builder, and tick selection. Revisit if a later chart genuinely needs axes, brushing, or stacking |
| **D-scope** | Product scope | **Progress intelligence; customization scoped per `08`** | ~40% less machinery than v1 |
| **D6** | Attention signal | **Proxies now; optional time logging in Phase 4** | Phase 1 infers attention from tasks, project activity, readings, executions — labelled honestly as a proxy. `timeLogged` is a weighted input the analysis blends in if it later exists |
| **D7** | Goal structure | **Themes, not calendar horizons** | The `horizon` ladder is gone. New `Theme` object (`02` §1); goal dates are optional; **undated items get a momentum vocabulary instead of a pace vocabulary** (`04` §3) |

---

## Still open

### D3 — Mobile access path — *decide by Phase 5*

Quick capture from a phone is what keeps measurement habits alive, and capture
friction is the main threat to the whole spine. That needs the API reachable from
your phone.

**Tailscale** — private mesh, no exposed ports, no certificates, free at this
scale. Alternatives: a Cloudflare tunnel (public hostname, more moving parts) or
LAN-only (capture only works at your desk, which mostly defeats it).

Lower urgency than in v1, since approvals moved to Phase 5.

---

### D4 — Claude billing — *deferred by your decision; blocks nothing until Phase 5*

Rates as of 2026-08-20: Opus 5 $5/$25 per MTok, Sonnet 5 $3/$15, Haiku 4.5 $1/$5.

| Use | Cost |
|---|---|
| Insight enrichment (top 3 findings) | ~$0.05 per pass |
| Question over goals and graph | ~$0.10 |
| Planning pass | ~$0.18 |
| Coding execution, 20–30 turns | **$1.50–$5.00** |

Monthly: analysis-only use lands around **$10–20**; add regular coding
executions and it is **$60–200**.

**The trap:** an hourly AI insight pass costs ~$3.60/day — **~$108/month to
discover nothing changed**. The architecture already prevents this structurally:
deterministic detectors run constantly and free (`04` §5), and AI enrichment runs
only on findings that already cleared a relevance bar (`04` §6). This is the main
reason the intelligence layer is deterministic-first, and it is a better design
independently of cost.

**Recommendation:** API key auth for the bridge, opening ceiling **$50/month**
with a hard stop, raised once there is real spend data. Keep using your
subscription for interactive Claude Code as you do today; the two are separate.

---

### D5 — Semantic retrieval for memory — *probably not needed*

v1 planned vector embeddings over a large memory store. With a fixed domain and a
real relation graph, structural retrieval — "notes linked to this goal, this
project, this decision" — covers most of what semantic search was doing, at zero
cost and with perfect explainability.

**Recommendation: skip vectors entirely for now.** Revisit only if keyword +
graph retrieval demonstrably fails on real data. This is the clearest instance of
the simplicity rule paying off.

---

### D8 — Finance conventions — *affects Phase 4*

Assumed INR primary, multi-currency stored from day one (integer minor units +
currency code). Open: do you need **GST tracking** and **Indian FY boundaries
(April–March)** rather than calendar years? That changes the finance collectors,
forecast buckets, and every date-grouped finance view.

---

### D9 — What the first real goals are — *not a technical decision, but the most important one*

The architecture is designed against your actual life: Samarth Strategies, client
work, FY Sem 5/6, a portfolio, React and Spring Boot projects. Before M6 I would
want three or four of your **real** goals with their real metrics — because a
progress model that works for "₹5L MRR by Mar 2027" is a different shape from one
for "ship the FY project" or "get consistent at the gym", and I would rather
discover that in the design than in the rebuild.

This is the single highest-value input you can give me before Phase 1 UI work.

---

### D10 — Theme roll-up display — *minor, decide during M6*

A theme mixing dated and undated goals reports the undated (momentum) vocabulary
for itself while its dated children keep their own status (`04` §3). That is the
honest choice, but it means a theme can read `steady` while containing a goal
that is `behind`. The alternative — surfacing the worst child status — is louder
but conflates two different claims.

I lean toward showing the theme's own momentum status **plus a child-status
summary strip** (e.g. `2 on track · 1 behind`), which keeps both facts visible
without averaging them into a lie. Worth looking at on a real screen in M6.

---

### D11 — When passkeys land — *needs your call*

M5 deferred passkeys to M6, and M6 has not done them either. Rather than roll
that forward a third time silently, here is the actual position.

**What exists:** the `passkeys` and `auth_challenges` tables, and
`@simplewebauthn/server` installed. Nothing is wired.

**Why it keeps slipping:** WebAuthn is a browser ceremony plus server
verification plus a credential-management surface. It is a real feature, not a
finishing touch, and each milestone it was attached to had a different
acceptance criterion that it did not serve.

**My recommendation: move it to Phase 5, with mobile.** Password auth with
Argon2id, hashed sessions, lockout, and generation-bumping is complete and
secure for a local single-user app. Passkeys earn their keep when you are
signing in from a phone over a tunnel — which is exactly Phase 5 (docs/13 D3).
Doing it now means building the ceremony against a browser that is already
trusted, then rebuilding the interesting half when the phone arrives.

**If you would rather have it sooner**, the natural slot is the start of Phase 2,
before the graph work begins. Say so and it goes there.

---

## Honestly unresolved

- **Progress-model ergonomics.** Weighted contributors are correct and
  expressive. Whether they are *pleasant* to configure is unknown until M6. If
  they are not, the fallback is templates plus a simplified mode — the model
  stays, the interface changes.
- **Insight quality.** The detectors will produce true findings. Whether they
  produce *useful* ones depends on your data, and the anti-noise rules in `04` §6
  are a first guess that will need tuning against reality.
- **Predictive analysis beyond linear projection.** Anything fancier than
  velocity-plus-band needs more history than you'll have for months. I would
  rather ship an honest simple projection than an impressive unreliable one.
