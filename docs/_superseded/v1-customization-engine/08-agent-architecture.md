# 08 — Agent Architecture

## 1. Why not one big agent

A single agent with every tool and every instruction degrades in three specific
ways: the system prompt becomes a compromise between unrelated jobs, the tool
surface becomes large enough to induce wrong-tool selection, and permissions
become impossible to scope (the finance agent inherits the ability to push code).

So: an **orchestrator** plus **narrow agents**, where narrowness buys precise
permission scopes as much as it buys prompt focus.

## 2. Agent definition (data, not code)

```ts
interface AgentDefinition {
  id: string
  key: string                      // 'planner', immutable
  name: string                     // mutable
  purpose: string                  // one line, used by the router
  instructions: string             // system prompt fragment
  model: string                    // 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5'
  thinking: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number }
  tools: {
    builtin: string[]              // 'Read','Write','Edit','Bash','Glob','Grep','WebSearch'
    mcp: string[]                  // 'aryesh-os.search_entities', ...
  }
  memoryScope: {
    classes: MemoryClass[]         // which memory classes it may read
    canPropose: boolean            // may it call propose_memory
    entityScope?: 'target' | 'graph-neighbourhood' | 'all'
  }
  permissionProfileId: string      // → rule set in 06
  budget: { maxUsd: number; maxTurns: number; maxWallClockMs: number }
  autonomyCeiling: 0|1|2|3|4|5     // cannot exceed the global level
  canDelegateTo: string[]          // agent keys it may spawn as subagents
  enabled: boolean
  isSystem: boolean                // seed-pack marker; still editable
}
```

Agents are rows. Creating a custom agent is a form, not a deploy. This satisfies
brief §19's "user should eventually be able to create custom agents" from day
one rather than as a retrofit — the built-ins are simply seeded rows.

Agent definitions map onto the SDK's `agents` option (`Record<string,
AgentDefinition>`), so our agents become real SDK subagents rather than a
prompt-level fiction.

## 3. The seeded agents

| Agent | Purpose | Model | Tools | Risk ceiling |
|---|---|---|---|---|
| **Orchestrator** | Classify the request, pick the agent(s), assemble context, sequence the work | `claude-opus-5` | `aryesh-os.*` read, delegation | SAFE |
| **Planner** | Turn an objective into an ordered, approvable plan with success criteria | `claude-opus-5` | `aryesh-os.*` read, Read, Glob, Grep | SAFE |
| **Analyst** | Analyse the graph, goals, and progress; answer "what matters now" | `claude-opus-5` | `aryesh-os.*` read, `record_insight` | SAFE |
| **Developer** | Implement changes in a registered project | `claude-opus-5` | Full built-in file/bash set, scoped to `workingRoot` | CONTROLLED |
| **Reviewer** | Review a diff for correctness, convention fit, and regressions | `claude-opus-5` | Read, Grep, Bash (tests only) | SAFE |
| **Finance Analyst** | Cash-flow, runway, budget variance, forecasting | `claude-sonnet-5` | `aryesh-os.*` read + aggregate | SAFE |
| **Business Analyst** | Pipeline, client health, revenue concentration | `claude-sonnet-5` | `aryesh-os.*` read | SAFE |
| **Memory Manager** | Deduplicate, merge, decay, and propose promotions | `claude-haiku-4-5` | memory read + `propose_memory` | SAFE |
| **Goal Analyst** | Progress attribution, blockers, trajectory vs. target | `claude-opus-5` | `aryesh-os.*` read, graph traversal | SAFE |

Model choice follows a simple rule: **Opus 5 by default; Sonnet 5 for
high-volume bounded analysis; Haiku 4.5 only for mechanical, high-frequency
work.** Never downgrade an agent to save money without the user choosing it — the
model is a visible, editable field on every agent, and `supportedModels()` from
the live SDK populates the picker.

## 4. Routing

The orchestrator is deliberately thin. Routing is:

1. **Explicit** — the user picked an agent, or a workflow named one. No inference.
2. **Command-derived** — `aryesh finance ...` implies the Finance Analyst.
3. **Classified** — a cheap classification call over the agent `purpose` lines
   returns one or more agents plus a confidence.
4. **Fallback** — ambiguity below threshold asks the user rather than guessing,
   because a mis-routed execution can hold real permissions.

The chosen route is shown before running and is overridable. Routing decisions
are logged so a consistently wrong route becomes a visible pattern.

## 5. Delegation

`canDelegateTo` maps to SDK subagents. A parent may only delegate to agents whose
permission profile is a **subset** of its own — enforced at spawn time, not by
convention. Delegation depth is capped (default 2) and the whole tree shares one
budget, so a runaway fan-out hits a wall rather than a bill.

Typical shape for "ship the auth refactor":

```
Orchestrator
├─ Planner        → plan (SAFE, needs approval)
├─ Developer      → implementation (CONTROLLED, scoped to one repo)
│   └─ Reviewer   → diff review (SAFE)
└─ Memory Manager → propose decision memory (SAFE, proposals only)
```

## 6. Context isolation

Each agent gets only the context layers its job needs. The Finance Analyst does
not receive Engineering DNA; the Developer does not receive transaction history.
This is a privacy control, a cost control, and an accuracy control at once —
irrelevant context measurably degrades output.

Context composition per agent is declared in the agent record as a list of layer
keys with budgets, which makes it inspectable and tunable without code.

## 7. Insights: the UNDERSTAND step

Insights are generated, not hardcoded. An insight generator runs on a schedule
and on significant events, gives the Analyst a bounded slice of the graph, and
records findings:

```ts
interface Insight {
  id: string
  title: string; body: string
  severity: 'info' | 'notable' | 'urgent'
  entityIds: string[]              // what it is about — clickable in the UI
  evidence: EvidenceRef[]          // which entities/memories/metrics produced it
  generatedBy: { agentId: string; executionId: string }
  state: 'new' | 'seen' | 'acted' | 'dismissed' | 'stale'
  expiresAt?: Date
}
```

Rules that keep this from becoming noise: insights must cite evidence; duplicates
are merged rather than repeated; dismissing one suppresses its pattern for a
configurable window; and an insight that has not been acted on within its window
goes stale rather than accumulating. A feed that cries wolf gets ignored, and an
ignored feed is worse than no feed.

## 8. Evaluation

Because agents are configuration, they need a way to be judged as configuration
changes. A lightweight eval harness stores scenario fixtures (a seeded database
snapshot plus an objective plus expected properties of the answer) and can replay
them against a modified agent. Not a research benchmark — a regression net, so
"I edited the Planner's instructions" does not silently make planning worse.

Phase 7. Listed here so the agent record carries a `version` from day one and
executions record which version produced them.
