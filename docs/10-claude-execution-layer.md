# 10 — Claude Execution Layer

**Act.** Claude Code is how work gets done in code, not what the product is
about. This layer is deliberately smaller than its v1 equivalent: no agent
studio, no custom agent authoring, no workflow orchestration. A fixed set of
agents, a solid permission gate, and an honest audit trail.

> SDK details verified against `code.claude.com/docs/en/agent-sdk/typescript`
> on 2026-08-20. Re-verify at Phase 3 kickoff — this is the fastest-moving
> dependency in the system.

## 1. Two roles

**Analysis** (no execution) — explaining findings the deterministic engine
already produced (`04` §6), answering questions about the graph, drafting a
decision's context. This is most of what Claude does day to day, it is cheap, and
it needs no permissions.

**Execution** (Claude Code) — real work in a registered project: implement,
refactor, test, review, analyse a repository. This is where permissions matter.

Analysis runs through the Messages API. Execution runs through the Agent SDK.

## 2. The agents (fixed)

| Agent | Job | Model | Risk ceiling |
|---|---|---|---|
| **Analyst** | Explain insights, answer questions about goals/graph/finance | `claude-opus-5` | read-only |
| **Planner** | Turn an objective into an approvable plan | `claude-opus-5` | read-only |
| **Developer** | Implement changes in a registered project | `claude-opus-5` | controlled |
| **Reviewer** | Review a diff for correctness and convention fit | `claude-opus-5` | read-only |

Four agents, editable in settings (instructions, model, enabled) but not
user-creatable. Model choice is visible and editable; `supportedModels()`
populates the picker live rather than from a hardcoded list.

## 3. Execution lifecycle

```
draft → planning → awaiting_plan_approval → running
                                              ├→ awaiting_approval ⇄ running
                                              ├→ suspended (budget)
                                              └→ interrupted (user)
                                              ↓
                            completed | failed | denied | cancelled → recorded
```

Every transition is persisted, so an execution survives a restart and resumes via
the SDK's `resume: sessionId`. `execution_events` holds the ordered stream and
powers both the live view and later replay.

Planning uses the SDK's own `permissionMode: 'plan'` — it produces a plan without
mutations, the plan is stored and rendered for approval, and on approval the same
session resumes in `'default'` mode. The model that made the plan carries it out
with its reasoning intact.

## 4. Context

Assembled deterministically, inspectable before sending, redacted at the boundary:

| Layer | Contents |
|---|---|
| Identity | Who the user is, active areas, top goals with trajectory status |
| Target | The project or goal in question, with its full state |
| Progress evidence | The `Explained<T>` structure from `03` §8 — the same one the UI renders |
| Graph slice | Compact contribution/dependency neighbourhood |
| Project profile | Detected stack, entry points, test/build commands |
| History | Last N executions on this target with outcomes |
| Objective | The ask plus explicit success criteria |

Stable layers first, volatile last, so the prefix stays cacheable across
executions on the same target. Every fragment carries provenance, so the UI can
show exactly what Claude was given.

Fields and metrics marked `private` are excluded. Secrets never appear — they are
injected into the child process environment at spawn, after an explicit grant.

## 5. Permissions

Three tiers, matched to intrinsic risk and modulated by parameters:

| Tier | Default | Examples |
|---|---|---|
| **SAFE** | Auto-allow | read, search, analyse, run tests, git status/diff |
| **CONTROLLED** | Ask once, grantable per project | write, edit, create, commit, branch, install |
| **DANGEROUS** | Always ask; some never delegable | delete, push, deploy, migrate production, send communications, spend money |

`fs.write` inside a registered project root is CONTROLLED; the same call to
`.env`, `.git/**`, or outside the root escalates to DANGEROUS. `Bash` is
classified by matching an allow-list, a deny-list, and defaulting to DANGEROUS.

### Enforcement

```ts
// PermissionResult = { allow: true } | { allow: false; reason?: string } | { prompt: true }
const canUseTool: CanUseTool = async ({ toolName, input }, { signal }) => {
  const action = classify(toolName, input)
  const decision = await allowance.evaluate(action, { agentId, executionId })
  await audit.record({ action, decision, executionId })
  if (decision.effect === 'allow') return { allow: true }
  if (decision.effect === 'deny')  return { allow: false, reason: decision.reason }
  const approval = await approvals.request(action, decision, { signal })
  return approval.granted ? { allow: true } : { allow: false, reason: approval.reason }
}
```

**The critical SDK detail:** `canUseTool` is *not* invoked for tools in
`allowedTools`, for statically allowed rules, or under auto-approving permission
modes. Anything routed around it is invisible to the gate and to the audit log.
So the bridge holds these invariants, asserted by tests:

- `permissionMode` is always `'default'`; `allowDangerouslySkipPermissions` is
  never set. High autonomy comes from *our rules returning allow fast*, never
  from disabling the gate.
- `allowedTools` lists only tools whose every invocation is SAFE and
  unparameterised. Anything path-, command-, or amount-dependent falls through.
- `settingSources: []`, so filesystem `.claude/settings.json` cannot widen
  permissions behind the engine's back.
- `disallowedTools` carries the non-delegable list as a static backstop
  (e.g. `Bash(rm -rf *)`), so a bug in rule evaluation still cannot reach it.
- The `AfterToolCall` hook mirrors completed calls into the audit log, so the
  record reflects what happened, not what was authorised.

### Allowance prompt

Shows action, target, why (which plan step), a diff preview where applicable, and
whether it is reversible. Options: **Allow once · Allow for this project · Allow
similar · Always ask · Deny**, each writing a rule of a different breadth, with a
default expiry. Rules are revocable, and revoking suspends any in-flight
execution depending on them.

**Never delegable, regardless of rules:** spending or transferring money, sending
external communications, force-pushing to a default branch, production database
operations, deleting backups, reading the secret store, and modifying the
permission rules themselves (Claude may *propose* a rule change; it appears in
the approval queue like anything else).

## 6. Writing back

Claude reaches Aryesh OS through an in-process SDK MCP server (`createSdkMcpServer`
+ `tool()`), calling the same services the API uses, so permissions and audit
apply identically.

Read tools: `search`, `get_goal`, `get_project`, `traverse_graph`,
`get_progress_breakdown`, `get_trajectory`, `list_insights`.

Write tools: `create_task`, `update_task`, `record_reading`, `link`.

**Proposal-only tools:** `propose_memory`, `propose_decision_context`,
`propose_insight`. Anything touching interpretation — memory, preferences,
configuration — is a proposal the user accepts or rejects. This is enforced by
the *absence* of a mutating tool, not by an instruction the model might disregard.

`memory_notes` is deliberately modest compared to v1's memory architecture: a
flat store of accepted notes (project context, preferences, decisions rationale)
with class, source, confidence, and provenance, retrieved by keyword plus entity
links. Vector retrieval is deferred (`13` D5) — with a fixed domain and a real
graph, structural retrieval covers most of what semantic search was doing.

## 7. Safety around the working directory

Pre-execution: record HEAD, refuse a dirty tree without confirmation, create
branch `aos/<slug>`. Path canonicalisation against the working root on every
call. Post-execution: a reviewable diff with accept/revert per file, backed by
the SDK's `rewindFiles()` — which makes "undo what Claude just did" a real
feature rather than git archaeology. One execution per working root at a time.

## 8. Cost

Every execution records tokens and cost against the model's rate (rates in
`settings`, so a price change is a config edit). Budgets are enforced per
execution, per agent, per day, and globally; exceeding one **suspends** rather
than kills, so work resumes. Spend is a first-class visible metric.

The structural cost control is `04` §6: deterministic detection runs constantly
and cheaply; AI enrichment runs only on findings that already cleared a relevance
bar. The failure mode to avoid is an hourly AI pass costing ~$100/month to
discover that nothing changed.
