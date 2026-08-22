# 10 — Memory Architecture

Memory is what separates "an AI with a database" from "a system that knows me".
It is also the subsystem most likely to quietly poison everything downstream: a
wrong memory, confidently retrieved, corrupts every future answer. So the design
priorities are, in order: **inspectable, correctable, then useful.**

## 1. Classes

| Class | Lifetime | Decays? | Typical source | Example |
|---|---|---|---|---|
| `goal` | Permanent until deleted | No | User, goal creation | "The ₹5L MRR target exists to fund leaving client work by 2027" |
| `project` | While the project is active; archived with it | No | Executions, analysis | "Client Project uses a custom JWT layer, not Spring Security" |
| `decision` | Permanent | No | User, execution outcomes | "Chose Render over Vercel for the API — cold starts hurt the webhook path" |
| `preference` | Permanent until overridden | No | User; AI proposals only | "Prefers Zod at boundaries over class-validator" |
| `general` | Long-lived | Slowly | Anywhere | "Exams run mid-November — capacity drops" |
| `temporary` | Hours to weeks, `expires_at` required | Expires | Conversation, execution | "Currently mid-refactor on the auth module" |

Class determines lifecycle policy and retrieval weighting. It is user-editable —
promoting a `temporary` note to a `decision` is one click, and is the main way
memory quality improves over time.

## 2. Record

```ts
interface Memory {
  id: string
  class: MemoryClass
  title: string                  // short, scannable
  content: string                // the fact itself, self-contained
  source: {
    actor: ActorRef              // user | agent:<id> | workflow:<id>
    origin: 'manual' | 'execution' | 'analysis' | 'import' | 'inference'
    executionId?: string
    excerpt?: string             // the exact text this was derived from
    fileRef?: string
  }
  confidence: number             // 0..1 — 1.0 only for user-authored
  importance: 1|2|3|4|5
  status: 'proposed' | 'active' | 'archived' | 'disabled'
  pinned: boolean                // always retrieved, bypasses ranking
  expiresAt?: Date
  supersededBy?: MemoryId        // corrections chain rather than overwrite
  relatedEntityIds: EntityId[]
  lastUsedAt?: Date; useCount: number
  embedding?: Float32Array
}
```

Two fields carry unusual weight:

- **`source.excerpt`** — the verbatim text a memory was derived from. When a
  memory looks wrong, the first question is always "where did this come from?",
  and a system that cannot answer it forces the user to distrust all of memory
  rather than one record. Cheap to store, impossible to reconstruct later.
- **`supersededBy`** — corrections form a chain. The old memory is retained and
  excluded from retrieval, so "why did it think that?" stays answerable and a
  bad correction is itself reversible.

## 3. Writing: proposals, not assertions (R4)

Agents cannot write memory. They call `propose_memory`, which creates a record
with `status: 'proposed'`. Proposals surface in a review queue and in-line after
the execution that produced them:

```
Claude proposes to remember:
  [preference] "Prefers Drizzle over Prisma for new services"
  from execution #142 — "…let's use Drizzle here, Prisma's client generation
  fights the dynamic schema…"                        confidence 0.8
  [ Accept ]  [ Accept & pin ]  [ Edit ]  [ Reject ]  [ Never infer this ]
```

Batch-accept exists, but the default is per-item, because the cost of one wrong
preference silently entering the Engineering DNA is paid on every future
execution. "Never infer this" writes a suppression pattern so the same proposal
does not return weekly.

**Engineering DNA is memory of class `preference`** with a dedicated view, not a
separate subsystem. Brief §14's requirements — edit, delete, disable, override —
are the standard memory controls, which is exactly why it should not be built
twice.

## 4. Retrieval

Hybrid, because each method alone fails in a characteristic way: vectors miss
exact identifiers, keywords miss paraphrase, and graph proximity misses anything
not yet connected.

```
query + active context (target entity, open dashboard, current project)
  ├─ pinned memories                              → always included
  ├─ vector search (libSQL ANN over embeddings)   → top 20
  ├─ FTS5 keyword search                          → top 20
  ├─ graph proximity (memories linked to entities within N hops)  → top 20
  └─ class filter (agent's memoryScope, 08 §2)
       ↓ reciprocal-rank fusion, then rescore:
         score = fused
               × (0.5 + 0.5·confidence)
               × importanceWeight[importance]
               × recencyDecay(class, updatedAt)
               × (1 + 0.1·log1p(useCount))
       ↓ deduplicate near-identical content (cosine > 0.95, keep highest confidence)
       ↓ pack to the layer's token budget, whole records only
```

Every retrieved memory is recorded against the execution, so the UI can show
exactly which memories shaped an answer — and clicking through to correct one is
the primary way the system gets smarter.

Embeddings: `voyage-3` or an equivalent, generated on write and on edit, stored
in the `F32_BLOB` column. Model and dimensions are config; a re-embed job handles
model changes. If no embedding provider is configured, retrieval degrades to
FTS + graph only, and says so rather than silently returning worse results.

## 5. Maintenance

A scheduled Memory Manager pass (Haiku 4.5, cheap, frequent):

- **Expiry** — `temporary` past `expires_at` → archived.
- **Duplicate detection** — near-identical pairs → proposes a merge.
- **Conflict detection** — contradictory memories in the same class and topic →
  raises them together for the user to resolve. It never picks a winner: the
  cases where two memories genuinely conflict are exactly the cases where the
  model's guess is least trustworthy.
- **Staleness** — `project` memories on archived projects → archived with them.
- **Promotion suggestions** — a `general` memory used in 10+ executions is
  probably a `preference` worth pinning.

All of it produces proposals. The maintenance pass has no write authority of its
own, which keeps a bad automated merge from being unrecoverable.

## 6. User control

The Memory view is a first-class screen, not a settings sub-page: filter by
class, status, confidence, source, and entity; full-text and semantic search;
inline edit; bulk archive/delete; pin; and a per-memory "used in N executions"
with the list. There is a global **memory kill switch** and per-class toggles —
"stop using preference memory for a while" must be a switch, not a deletion.

Export is plain JSON with all provenance intact. Memory is the most personal data
in the system, and it must be trivially portable.

## 7. What never becomes memory

- Secrets, API keys, tokens, passwords — the redactor drops them, and the
  `propose_memory` handler rejects any content matching secret patterns rather
  than storing and hiding it.
- Anything from a field marked `sensitivity: private` unless explicitly promoted.
- Raw conversation transcripts. Transcripts live in `execution_events`; memory
  holds distilled facts. Conflating the two makes retrieval worse and the store
  unreviewable.

## 8. Relationship to entities

Memory links to entities (`memory_links`), and entities can carry notes as
fields. The line: **entity data is structured and authoritative; memory is
contextual and interpretive.** A project's `tech_stack` field is data. "Aryesh
regrets choosing MongoDB here because the reporting queries got painful" is
memory. Both are retrievable; only one is a fact about the world.
