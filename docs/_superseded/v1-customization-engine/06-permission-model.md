# 06 — Permission Model & Allowance System

The autonomy claim in the brief ("Level 5") is only safe if the permission layer
is genuinely good. This is the subsystem where a shortcut costs real money, real
code, or real data. It gets designed carefully and tested hardest.

## 1. Principles

1. **Deny by default.** An action with no matching rule requires consent.
2. **Two checkpoints, not one.** Plan-time approval sets intent; every tool call
   is re-checked at runtime. Approving a plan is not a blank cheque for whatever
   the model decides to do inside it.
3. **Permissions are data** (R1) — rules are rows, editable and revocable.
4. **Everything is logged**, including auto-allowed actions and denials.
5. **Some things are never delegable.** A small non-overridable list (§7).
6. **Grants are narrow by default and expire.** The UI makes the narrow option
   the easy one.

## 2. Action taxonomy

Every capability Claude or an agent can invoke is a registered `Action` with a
stable id and an intrinsic risk tier.

```ts
interface ActionDefinition {
  id: string                     // 'fs.write', 'git.push', 'os.entity.delete'
  domain: 'fs'|'git'|'shell'|'net'|'pkg'|'os'|'ai'|'comms'|'money'|'deploy'
  risk: 'safe' | 'controlled' | 'dangerous'
  reversible: boolean
  description: string
  params: ZodType                // for rendering the approval and matching conditions
  summarize(params): string      // human sentence shown in the approval card
  affects?: (params) => ResourceRef[]   // paths, repos, entities, amounts
}
```

| Tier | Meaning | Default | Examples |
|---|---|---|---|
| **SAFE** | Read-only, no side effects outside the workspace | Auto-allow | `fs.read`, `fs.search`, `code.analyze`, `test.run`, `os.entity.read`, `report.generate`, `git.status`, `git.diff` |
| **CONTROLLED** | Mutates the workspace; reversible with effort | Ask once, then grantable per project | `fs.write`, `fs.create`, `pkg.install`, `git.branch`, `git.commit`, `os.entity.create`, `os.entity.update`, `shell.run` (allow-listed) |
| **DANGEROUS** | Irreversible, external, or costly | Always ask; some never delegable | `fs.delete`, `git.push`, `git.force_push`, `deploy.production`, `db.migrate.production`, `comms.send`, `money.spend`, `os.config.delete`, `secret.read`, `shell.run` (arbitrary) |

Risk is **intrinsic to the action but modulated by parameters**. `fs.write` to
`C:/Projects/Client Project/src/**` is CONTROLLED; `fs.write` to `.env`,
`.git/**`, or anything outside the registered project root is escalated to
DANGEROUS by a parameter condition. `shell.run` is classified by matching the
command against an allow-list (`npm test`, `npm run build`, `git status`), a
deny-list (`rm -rf`, `curl | sh`, `format`), and defaulting to DANGEROUS.

## 3. Rule schema

```ts
interface PermissionRule {
  id: string
  effect: 'allow' | 'ask' | 'deny'
  action: string                 // 'fs.write' | 'git.*' | '*'
  scope: {
    projectId?: EntityId         // this project only
    agentId?: string             // this agent only
    environment?: 'local' | 'staging' | 'production'
    pathGlob?: string            // 'C:/Projects/Client Project/**'
  }
  conditions?: FilterGroup       // over action params: amount < 5000, branch != 'main'
  budget?: {                     // consumable limits
    maxInvocations?: number; usedInvocations: number
    maxCostUsd?: number;       usedCostUsd: number
    maxAmountUsd?: number       // for money.* actions
    window?: 'execution' | 'day' | 'week' | 'forever'
  }
  expiresAt?: Date
  priority: number
  source: 'seed' | 'user' | 'allowance-prompt'
  createdBy: ActorRef; createdAt: Date
  revokedAt?: Date; note?: string
}
```

### Evaluation

```
matching rules (not revoked, not expired, scope matches, conditions pass)
  → sort by specificity, then priority, then recency
  → first DENY wins outright (deny is absolute)
  → else most specific ALLOW with remaining budget wins
  → else ASK
```

Specificity ranking: exact action + project + path glob > exact action + project
> exact action > wildcard domain > global. Rule evaluation is a pure function
with an exhaustive test suite, and the UI has a **"why?"** explainer that shows
the exact rule chain that produced a decision — indispensable the first time a
grant behaves unexpectedly.

## 4. The Allowance prompt

The approval card is a product surface, not a browser confirm dialog. It shows
what will happen, to what, why, and whether it can be undone.

```
┌─ ALLOWANCE REQUEST ─────────────────── risk: CONTROLLED ─┐
│ Agent    Developer                                        │
│ Action   Modify backend authentication                    │
│ Target   Client Project · src/auth/*.ts  (4 files)        │
│ Why      Objective: "Add refresh-token rotation"          │
│          Step 3 of 6 in the approved plan                 │
│ Diff     [ preview 128 additions, 41 deletions ]          │
│ Undo     Reversible — branch `aos/refresh-rotation`       │
│                                                           │
│ [ Allow once ]  [ Allow for this project ]                │
│ [ Allow similar actions ]  [ Always ask ]  [ Deny ]       │
│ Grants expire in [ 7 days ▾ ]      □ Notify on each use   │
└───────────────────────────────────────────────────────────┘
```

Each button writes a rule of a different breadth:

| Button | Rule created |
|---|---|
| Allow once | Ephemeral grant scoped to this execution; no persisted rule |
| Allow for this project | `allow fs.write scope{projectId}` with the default expiry |
| Allow similar actions | `allow fs.* scope{projectId, pathGlob: <derived>}` — the derived glob is shown before confirming |
| Always ask | Explicit `ask` rule, which suppresses broader allows |
| Deny | `deny` rule; the execution branches to its fallback or halts |

Approvals reach the user through whichever surface is present: the web app
inline, the CLI as a prompt, mobile as a push notification with a signed
deep-link. Timeout behaviour is configurable per risk tier and defaults to
**deny after 15 minutes** for DANGEROUS, and **park the execution** for
CONTROLLED so it can be resumed rather than lost.

## 5. Autonomy levels

A single global dial that presets the rule set, with per-project overrides:

| Level | Behaviour |
|---|---|
| 0 — Observe | Read-only. Analysis and proposals only |
| 1 — Assist | SAFE auto; everything else asks |
| 2 — Collaborate | SAFE auto; CONTROLLED auto within registered project roots; DANGEROUS asks |
| 3 — Delegate | + commits and branches auto; pushes to non-default branches auto |
| 4 — Autonomous | + package installs, migrations on local DBs, PR creation |
| 5 — Trusted | + everything except the non-delegable list (§7), still fully budgeted and logged |

The level is a *rule generator*, not a hidden branch — selecting a level writes
visible rules the user can then edit individually. There is no state the
permission UI cannot show.

## 6. Runtime enforcement

Enforcement lives in the bridge's `canUseTool` callback (`07` §5), so it cannot
be bypassed by a model choosing a different phrasing:

```ts
// Signature and return type per the Agent SDK TypeScript reference:
//   canUseTool: (request, { signal }) => Promise<PermissionResult>
//   type PermissionResult = { allow: true }
//                         | { allow: false; reason?: string }
//                         | { prompt: true }
const canUseTool: CanUseTool = async ({ toolName, input }, { signal }) => {
  const action = actionRegistry.classify(toolName, input)   // tool call → action + params
  const decision = await allowance.evaluate(action, { agentId, executionId })
  await audit.record({ action, decision, executionId })

  switch (decision.effect) {
    case 'allow':
      budget.consume(decision.ruleId, action)
      return { allow: true }
    case 'deny':
      return { allow: false, reason: decision.reason }   // reason is fed back to the model
    case 'ask': {
      const approval = await approvals.request(action, decision, { signal })
      return approval.granted ? { allow: true } : { allow: false, reason: approval.reason }
    }
  }
}
```

**A critical detail from the SDK contract:** `canUseTool` is *not* invoked for
tools listed in `allowedTools`, for tools matched by static allow rules, or under
auto-approving permission modes. Anything routed around it is invisible to the
allowance engine and to the audit log.

Therefore the bridge holds these invariants (asserted by tests):

- `permissionMode` is always `'default'` — never `'bypassPermissions'`, and
  `allowDangerouslySkipPermissions` is never set. Level 5 autonomy is delivered
  by *our* rules returning `{ allow: true }` fast, not by disabling the gate.
- `allowedTools` is used **only** for tools whose every possible invocation is
  SAFE and unparameterised. Anything path-, command-, or amount-dependent is
  omitted so it falls through to `canUseTool`.
- `settingSources: []`, so filesystem `.claude/settings.json` files cannot widen
  permissions behind the engine's back. Project context is injected deliberately
  by the bridge instead (`07` §4).
- `disallowedTools` carries the non-delegable list (§7) as a static backstop —
  defence in depth, using scoped rules like `Bash(rm -rf *)` — so a bug in rule
  evaluation still cannot reach them.

The `AfterToolCall` hook mirrors every completed call into the audit log with its
result, so the record reflects what actually happened rather than what was
authorised.

Additional hard boundaries, independent of rules:

- **Filesystem jail.** Every execution declares a working root (the project's
  `local_path`). Paths are canonicalised — symlinks and `..` resolved — and
  compared against the root. Escape attempts are denied and logged as an
  incident, not merely as a denial.
- **Network.** Outbound domains are allow-listed per project.
- **Secrets.** `secret.read` is never auto-allowed and never returns plaintext to
  the model — secrets are injected into the child process environment at spawn,
  after an explicit grant.
- **Budgets.** Every execution has a token, cost, wall-clock, and tool-call
  ceiling. Exceeding one suspends rather than kills, so work can be resumed.

## 7. Non-delegable (no rule can auto-allow these)

- Transferring or spending money — every payment is a human action, always
- Sending external communications to real recipients (email, WhatsApp, client
  messages) — drafting is fine, sending is not
- `git push --force` to a default branch
- Production database migrations or destructive production operations
- Deleting an entity type, a pack, or a backup
- Reading or exporting the secret store
- Modifying the permission rules themselves — the AI may *propose* a rule change
  (R4), which appears in the approvals queue like any other request

This list is a constant in code with an accompanying test asserting that no rule
combination can produce `allow` for any member of it.

## 8. Audit

Every evaluation — allow, ask, deny, auto — writes an `audit_events` row with
actor, action, parameters, decision, the rule that produced it, the execution,
and the resulting change. The Audit view supports filter by actor / action /
project / risk / date, a "show me everything Claude changed this week" preset,
per-execution replay, and CSV export. Retention is unlimited by default;
pruning is explicit.

**Revocation is instant and retroactive in effect:** revoking a rule immediately
suspends any in-flight execution that depended on it, and the audit view can
list everything that rule ever permitted.
