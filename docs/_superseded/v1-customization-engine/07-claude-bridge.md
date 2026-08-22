# 07 — Claude Code Bridge

> Verified against the Claude Agent SDK TypeScript reference
> (`code.claude.com/docs/en/agent-sdk/typescript`) on 2026-08-20. Identifier
> names below are taken from that reference, not from memory. Re-verify at
> Phase 3 kickoff — this is the fastest-moving dependency in the system.

## 1. Division of labour

**Aryesh OS orchestrates. Claude Code executes.** The OS never runs `rm`, never
writes to a repo, never pushes. It assembles an objective, a context pack, and a
permission envelope, then hands them to the Agent SDK, which owns the agent
loop, the built-in tools, and context management.

```
Objective ─┐
Context   ─┼→ ExecutionRequest → Bridge → query({prompt, options}) → Agent loop
Envelope  ─┘                        ↑                                    │
                                    │ canUseTool ← allowance engine       │
                                    │ MCP tools  → Aryesh OS data         │
                                    └──────── events, result ────────────┘
                                                     ↓
                            transcript · audit · entity writeback · memory proposals
```

Two directions matter equally:

- **Outbound**: the OS drives Claude (execution requests).
- **Inbound**: Claude reads and writes the OS through a custom in-process MCP
  server (§6). Without the inbound half, Claude is a code tool. With it, Claude
  can answer "what matters right now?" from the actual graph.

## 2. Execution lifecycle

```
draft → planning → awaiting_plan_approval → approved → running
                                                 │        ├→ awaiting_approval ⇄ running
                                                 │        ├→ suspended (budget/revocation)
                                                 │        └→ interrupted (user)
                                                 ↓
                                        completed | failed | denied | cancelled
                                                 ↓
                                        recorded (writeback + memory proposals)
```

Every transition is persisted, so an execution survives an API restart and can be
resumed. `executions` holds the record; `execution_events` holds the ordered
stream (assistant text, thinking, tool calls, tool results, permission decisions,
errors, costs) and is the source for both the live view and later replay.

**Planning uses the SDK's own plan mode.** The planning pass runs with
`permissionMode: 'plan'`, which produces a plan without mutations. The plan is
stored, rendered for approval, and — once approved — the execution proceeds by
resuming that session (`resume: sessionId`) in `'default'` mode. The model that
made the plan is the model that carries it out, with its reasoning intact.

## 3. The execution request

```ts
interface ExecutionRequest {
  id: string
  agentId: string
  objective: string
  target?: { entityId: string; typeKey: string }   // usually a codebase-trait entity
  workingRoot?: string                             // project local_path; the fs jail
  context: ContextPack
  envelope: {
    autonomyLevel: 0|1|2|3|4|5
    maxTurns: number
    budgetUsd: number
    wallClockMs: number
    allowedDomains: string[]
  }
  model: string
  parentExecutionId?: string
}
```

## 4. Context pack assembly

The context pack is the single most important quality lever in the product, and
the single largest privacy risk. It is assembled deterministically, is
inspectable before it is sent (R6), and passes through the redactor (`01` §8).

| Layer | Contents | Budget |
|---|---|---|
| Identity | Who Aryesh is, current top-level goals, active businesses | ~500 tok |
| Engineering DNA | Preferred frameworks, conventions, architecture patterns — only entries marked active | ~800 tok |
| Target entity | Full field set of the target plus its immediate relations | ~1 000 tok |
| Graph slice | Compact serialisation of the relevant neighbourhood (`05` §7) | ~1 500 tok |
| Memory | Hybrid retrieval — vector + keyword + graph proximity — top-k, deduped (`10` §4) | ~2 000 tok |
| Project profile | Detected stack, entry points, test/build commands, deployment | ~800 tok |
| History | Summaries of the last N executions on this target, with outcomes | ~800 tok |
| Objective | The ask, plus explicit success criteria | ~300 tok |

Assembly rules:

- **Stable prefix ordering.** Identity → DNA → project profile → graph → memory →
  history → objective. The volatile parts sit last so the stable prefix stays
  cacheable across executions on the same target.
- **Budgeted, with graceful degradation.** Each layer has a token budget; when it
  overflows, the layer's own ranking function drops the lowest-value items.
  Nothing is truncated mid-record.
- **Provenance preserved.** Every fragment carries the id of the entity or memory
  it came from, so the UI can render "Claude used these 14 things", and so a
  wrong answer can be traced to the wrong input.
- **Project convention files are injected, not inherited.** `settingSources: []`
  means the SDK will not silently pick up `.claude/settings.json` from disk. The
  bridge instead composes what it wants Claude to know, so the context is exactly
  what the UI displayed. (Skills and commands the user *deliberately* wants
  loaded are an explicit per-agent opt-in.)

## 5. SDK wiring

```ts
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'

const q = query({
  prompt: renderPrompt(request),        // or an AsyncIterable for interactive mode
  options: {
    cwd: request.workingRoot,           // filesystem jail anchor
    model: request.model,               // e.g. 'claude-opus-5'
    fallbackModel: 'claude-sonnet-5',
    maxTurns: request.envelope.maxTurns,
    permissionMode: 'default',          // NEVER 'bypassPermissions' — see 06 §6
    settingSources: [],                 // no ambient filesystem config
    strictMcpConfig: true,              // only the servers we pass
    systemPrompt: { type: 'preset', preset: 'claude_code', append: agentInstructions },
    thinking: { type: 'adaptive' },
    canUseTool,                         // → allowance engine (06 §6)
    disallowedTools: NON_DELEGABLE,     // static backstop, e.g. 'Bash(rm -rf *)'
    mcpServers: { 'aryesh-os': aryeshServer },
    agents: subagentDefinitions,        // our Agent records → SDK subagents (08 §5)
    hooks: {
      SessionStart:   [/* record start, snapshot git state */],
      BeforeToolCall: [/* correlation ids, incident detection */],
      AfterToolCall:  [/* audit the actual result, stream to SSE */],
      SessionEnd:     [/* finalise, cost accounting */],
    },
    includeHookEvents: true,
  },
})

for await (const msg of q) { await recordAndStream(executionId, msg) }
```

The `Query` object gives the OS live control, which the UI exposes directly:

| Query method | Product surface |
|---|---|
| `interrupt()` | The Stop button on a running execution |
| `setPermissionMode(mode)` | Escalating or tightening autonomy mid-flight |
| `setModel(model)` | "This is harder than expected — switch to Opus" |
| `rewindFiles(userMessageId)` | **Undo Claude's file changes** — the honest answer to R3 for code |
| `mcpServerStatus()` | Bridge health panel |
| `supportedModels()` | Model picker populated live, not hardcoded |

`rewindFiles` is worth calling out: it makes "undo what Claude just did to my
repo" a first-class product feature rather than a git-archaeology exercise, and
it pairs with the automatic pre-execution branch (§8).

## 6. The `aryesh-os` MCP server (inbound)

An in-process SDK MCP server — no subprocess, no transport, direct function calls
into the same services the API uses, so permission checks and audit apply
identically.

```ts
const aryeshServer = createSdkMcpServer({
  name: 'aryesh-os',
  version: '1.0.0',
  instructions: 'Read and update Aryesh OS: entities, relations, goals, memory.',
  tools: [
    tool('search_entities', 'Search entities by text, type, status, or filter',
      { query: z.string(), typeKey: z.string().optional(), limit: z.number().default(20) },
      handler, { annotations: { readOnlyHint: true } }),

    tool('get_entity', 'Fetch one entity with all fields and relations',
      { id: z.string() }, handler, { annotations: { readOnlyHint: true } }),

    tool('traverse_graph', 'Walk relations from an entity up to a depth',
      { from: z.string(), depth: z.number().max(4).default(2), relationTypes: z.array(z.string()).optional() },
      handler, { annotations: { readOnlyHint: true } }),

    tool('create_entity', 'Create an entity of a given type',
      { typeKey: z.string(), data: z.record(z.unknown()) }, handler,
      { annotations: { destructiveHint: false } }),

    tool('update_entity', 'Update fields on an entity',
      { id: z.string(), data: z.record(z.unknown()) }, handler),

    tool('relate', 'Create a relation between two entities',
      { relationTypeKey: z.string(), fromId: z.string(), toId: z.string(), weight: z.number().optional() },
      handler),

    tool('propose_memory', 'Propose a durable memory for the user to accept',
      { class: z.enum(['goal','project','decision','preference','general','temporary']),
        title: z.string(), content: z.string(), confidence: z.number(),
        relatedEntityIds: z.array(z.string()) }, handler),

    tool('propose_config_change', 'Propose a schema, field, or dashboard change',
      { kind: z.string(), payload: z.record(z.unknown()), rationale: z.string() }, handler),

    tool('record_insight', 'Record an observation about the user\'s data',
      { title: z.string(), body: z.string(), severity: z.enum(['info','notable','urgent']),
        entityIds: z.array(z.string()) }, handler),
  ],
})
```

Two design points:

1. **Tool schemas are generated from field definitions.** `create_entity`'s
   `data` validates against the compiled Zod schema for the given type
   (`04` §3), so a user-defined field is immediately writable by Claude with no
   code change. This is R1 reaching all the way into the AI layer.
2. **Writes are proposals where they touch meaning.** Entity data writes go
   through the normal permission path. Memory, preferences, Engineering DNA, and
   configuration are `propose_*` only — R4 is enforced by the absence of a
   mutating tool, not by an instruction the model might disregard.
3. `readOnlyHint` annotations let the allowance engine and the model both reason
   about risk, and let SAFE reads run without friction.

## 7. Streaming and the live view

SDK messages map to `execution_events` and fan out over SSE. The execution view
shows a terminal-style transcript: assistant text, collapsed thinking, tool calls
with arguments and results, permission prompts inline, live cost and token
counters, and the elapsed budget. Nothing about the run is hidden (R6).

`agentProgressSummaries` and `forwardSubagentText` are enabled so subagent work
is legible rather than a silent pause.

## 8. Safety mechanics around the working directory

- **Pre-execution snapshot.** If the target is a git repo: record HEAD, refuse to
  start on a dirty tree unless the user confirms, and create a branch
  `aos/<execution-slug>`. If it is not a repo, offer to `git init` or take a file
  snapshot into `data/snapshots/`.
- **Path canonicalisation** against `workingRoot` on every tool call (`06` §6).
- **Post-execution diff** presented as a reviewable change set with accept /
  revert per file. `rewindFiles` powers revert.
- **Concurrency.** One execution per working root at a time; others queue. Two
  agents editing one repo concurrently is a class of bug not worth having.

## 9. Failure handling

| Failure | Response |
|---|---|
| API auth missing/invalid | Fail fast at request creation with a fix-it link; never start a partial run |
| Rate limit / 429 | Exponential backoff inside the budget; surfaced in the UI as "waiting", not "stuck" |
| Model refusal (`stop_reason: refusal`) | Record verbatim, mark `denied_by_model`, do not silently retry with a reworded prompt |
| Budget exceeded | `suspended` with everything preserved; the user may raise the budget and resume |
| Approval timeout | Per-tier policy (`06` §4) — deny for DANGEROUS, park for CONTROLLED |
| Crash / restart | Executions resume from the persisted session id via `resume` |
| Tool error loop | Detected by repeated identical failing calls; suspends with a diagnosis |

## 10. Cost accounting

Every execution records input/output tokens and computed cost against the
model's rate. Rates live in a `settings` row (`claude-opus-5`: $5 / $25 per MTok;
`claude-sonnet-5`: $3 / $15; `claude-haiku-4-5`: $1 / $5 as of 2026-08-20), so
price changes are a config edit. Budgets are enforced per execution, per agent,
per day, and globally, and spend is a first-class metric with its own widget —
this is a personal system with a real bill attached.
