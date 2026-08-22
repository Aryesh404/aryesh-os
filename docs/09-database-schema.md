# 09 — Database Schema

**libSQL** (SQLite dialect), file `data/aryesh.db`, WAL, `foreign_keys=ON`,
accessed only through repositories in `packages/db`.

With a fixed domain (`02`), these are **real typed tables** — not a generic
entity bag. Constraints are enforceable, queries are readable, and the JSON
machinery from v1 is gone. Custom fields ride along in one JSON column per table.

## 1. Core tables

```sql
CREATE TABLE areas (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, icon TEXT,
  target_share REAL,                         -- 0..1 intended attention
  sort_order INTEGER NOT NULL DEFAULT 0,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES areas(id),
  name TEXT NOT NULL, description TEXT, why TEXT,
  status TEXT NOT NULL DEFAULT 'active',     -- active|paused|achieved|retired
  target_date INTEGER,                       -- optional; many themes have none
  importance INTEGER NOT NULL DEFAULT 3,
  progress REAL, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES areas(id),
  theme_id TEXT REFERENCES themes(id),
  parent_goal_id TEXT REFERENCES goals(id),
  name TEXT NOT NULL, description TEXT, why TEXT,
  start_date INTEGER, target_date INTEGER,   -- both nullable: undated goals are
                                             -- judged on momentum, not pace (04 §3)
  status TEXT NOT NULL DEFAULT 'active',
  importance INTEGER NOT NULL DEFAULT 3,     -- 1..5, feeds attention ranking
  measurement_mode TEXT NOT NULL DEFAULT 'completion',  -- completion|momentum (03 §4.0)
  progress_model TEXT NOT NULL DEFAULT '{"mode":"rollup"}',   -- JSON
  projection_model TEXT,                     -- JSON; null = linear (04 §2)
  progress REAL, confidence REAL,            -- cached, computed
  progress_computed_at INTEGER,
  degraded_reason TEXT,                      -- set when a contributor is unsatisfied
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX idx_goals_area ON goals(area_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_goals_target ON goals(target_date) WHERE deleted_at IS NULL AND target_date IS NOT NULL;
CREATE INDEX idx_goals_theme ON goals(theme_id) WHERE deleted_at IS NULL;

CREATE TABLE metrics (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  area_id TEXT REFERENCES areas(id),
  unit TEXT NOT NULL, direction TEXT NOT NULL,      -- increase|decrease|maintain
  baseline REAL, target REAL, target_date INTEGER, tolerance REAL,
  cadence TEXT NOT NULL, aggregation TEXT NOT NULL DEFAULT 'last',
  source TEXT NOT NULL,                              -- manual|derived|computed|external
  expression TEXT, collector_key TEXT,
  components TEXT,                                   -- JSON; null = scalar metric (03 §11)
  bounded INTEGER NOT NULL DEFAULT 1,                -- 0 = no meaningful target;
                                                     -- valid only as a rate contributor
  private INTEGER NOT NULL DEFAULT 0,
  last_reading_at INTEGER, last_value REAL,          -- denormalised hot path
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

-- Append-only time series. The most important table in the system.
CREATE TABLE readings (
  id TEXT PRIMARY KEY,
  metric_id TEXT NOT NULL REFERENCES metrics(id),
  at INTEGER NOT NULL,
  value REAL NOT NULL,
  component TEXT,                           -- null for scalar metrics (03 §11)
  source TEXT NOT NULL,                     -- manual|collector|derived|import
  note TEXT, actor TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_readings_metric_at ON readings(metric_id, at DESC);
CREATE UNIQUE INDEX idx_readings_dedupe ON readings(metric_id, at, source, component);
```

`readings` is never cascade-deleted and never updated — a correction is a new
reading superseding the old, so history stays auditable. The unique index makes
collector re-runs idempotent, which is what makes backfill safe to run twice.

```sql
CREATE TABLE milestones (
  id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id),
  name TEXT NOT NULL, due_date INTEGER,
  achieved INTEGER NOT NULL DEFAULT 0, achieved_at INTEGER,
  weight REAL NOT NULL DEFAULT 1, sort_order INTEGER,
  custom_fields TEXT NOT NULL DEFAULT '{}', ...
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY, area_id TEXT REFERENCES areas(id),
  business_id TEXT REFERENCES businesses(id), client_id TEXT REFERENCES clients(id),
  name TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL, health TEXT,
  start_date INTEGER, target_date INTEGER, completed_at INTEGER,
  progress REAL,
  progress_basis TEXT NOT NULL DEFAULT '{"mode":"task_based"}',  -- 03 §4.4;
                                             -- task_based caps confidence at 0.6
  progress_confidence REAL,
  local_path TEXT, repo_url TEXT, tech_stack TEXT,   -- Claude execution hooks
  custom_fields TEXT NOT NULL DEFAULT '{}', ...
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  area_id TEXT REFERENCES areas(id),
  title TEXT NOT NULL, status TEXT NOT NULL,
  estimate REAL, actual REAL,
  due_date INTEGER, started_at INTEGER, completed_at INTEGER,
  custom_fields TEXT NOT NULL DEFAULT '{}', ...
);
CREATE INDEX idx_tasks_status ON tasks(status, due_date) WHERE deleted_at IS NULL;

CREATE TABLE habits (
  id TEXT PRIMARY KEY, area_id TEXT REFERENCES areas(id),
  name TEXT NOT NULL, cadence TEXT NOT NULL, target_per_period INTEGER NOT NULL DEFAULT 1,
  current_streak INTEGER NOT NULL DEFAULT 0, longest_streak INTEGER NOT NULL DEFAULT 0, ...
);
CREATE TABLE habit_entries (
  id TEXT PRIMARY KEY, habit_id TEXT NOT NULL REFERENCES habits(id),
  date INTEGER NOT NULL, completed INTEGER NOT NULL, note TEXT,
  UNIQUE(habit_id, date)
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY, area_id TEXT REFERENCES areas(id),
  title TEXT NOT NULL, date INTEGER NOT NULL,
  context TEXT, choice TEXT NOT NULL, rationale TEXT NOT NULL,
  alternatives TEXT,                           -- JSON array
  expected_outcome TEXT, confidence REAL NOT NULL,
  reversibility TEXT NOT NULL,
  review_date INTEGER,
  outcome_verdict TEXT, outcome_notes TEXT, outcome_assessed_at INTEGER,
  custom_fields TEXT NOT NULL DEFAULT '{}', ...
);
CREATE INDEX idx_decisions_review ON decisions(review_date)
  WHERE outcome_verdict IS NULL AND deleted_at IS NULL;
```

## 2. Relations

One table, six fixed kinds (`02` §2):

```sql
CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                        -- contributes_to|belongs_to|depends_on|
                                             -- measures|informed_by|relates_to
  from_type TEXT NOT NULL, from_id TEXT NOT NULL,
  to_type   TEXT NOT NULL, to_id   TEXT NOT NULL,
  weight REAL,                               -- contributes_to only
  leads_metric_id TEXT, lag_days INTEGER,    -- measures edges only (03 §10)
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL, deleted_at INTEGER,
  UNIQUE(kind, from_type, from_id, to_type, to_id)
);
CREATE INDEX idx_rel_from ON relations(from_type, from_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX idx_rel_to   ON relations(to_type,   to_id,   kind) WHERE deleted_at IS NULL;
CREATE INDEX idx_rel_contrib ON relations(to_id, weight)
  WHERE kind = 'contributes_to' AND deleted_at IS NULL;
```

Polymorphic endpoints are a deliberate trade: SQLite cannot enforce a foreign key
across a type-tagged reference, so validity is enforced in the repository layer
against a static endpoint table, with a nightly integrity check that reports
(never auto-deletes) orphans. The alternative — a junction table per pair — is
21 tables for one concept.

Both direction indexes exist because traversal runs both ways, and the partial
contribution index exists because progress roll-up is the hottest read in the
product.

## 3. Time series and intelligence

```sql
CREATE TABLE goal_snapshots (
  id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id),
  date INTEGER NOT NULL,
  progress REAL NOT NULL, confidence REAL NOT NULL,
  breakdown TEXT NOT NULL,                   -- JSON contributor array
  velocity_7d REAL, velocity_30d REAL,
  UNIQUE(goal_id, date)
);
CREATE INDEX idx_snap_goal_date ON goal_snapshots(goal_id, date DESC);

CREATE TABLE metric_snapshots (               -- period rollups for fast charts
  metric_id TEXT NOT NULL, period TEXT NOT NULL, period_start INTEGER NOT NULL,
  value REAL NOT NULL, reading_count INTEGER NOT NULL,
  PRIMARY KEY (metric_id, period, period_start)
);

CREATE TABLE insights (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, severity TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL,
  evidence TEXT NOT NULL,                    -- JSON refs + values
  entity_refs TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  dedupe_key TEXT NOT NULL,                  -- kind + entities; drives update-not-insert
  ai_enriched INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER
);
CREATE UNIQUE INDEX idx_insight_dedupe ON insights(dedupe_key) WHERE state != 'dismissed';
```

## 4. Finance, business, support

```sql
accounts(id, name, kind, currency, balance, ...)
transactions(id, account_id, business_id, amount_minor, currency, direction,
             occurred_at, category_id, description, ...)
investments(id, name, kind, units, cost_basis_minor, current_value_minor, ...)
businesses(id, name, ...)   clients(id, business_id, name, ...)   people(id, ...)
categories(id, scope, name, color, semantics, sort_order)         -- user-defined
custom_field_defs(id, object_type, key, label, kind, config, required,
                  default_value, private, sort_order, deleted_at)
notes(id, body, ...)        note_links(note_id, target_type, target_id)
```

**Money is always integer minor units plus a currency code.** Never a float,
anywhere. Painless now, painful to retrofit.

## 5. System

```sql
audit_events(id, at, actor, action, subject_type, subject_id, before, after, note)
revisions(id, subject_type, subject_id, version, patch, inverse, actor, at, label)
jobs(id, kind, payload, run_at, attempts, state, last_error)
settings(key, value)
executions / execution_events / permission_rules / approvals    -- Phase 3, see 10
memory_notes(id, class, content, source, confidence, status, ...)  -- Phase 3, see 10 §6
sessions / credentials                                            -- auth
```

## 6. Migrations

Only one kind of migration exists now: **code migrations**, versioned in git via
Drizzle Kit. User customization (fields, categories, metrics, dashboards) is
ordinary `INSERT`/`UPDATE` traffic — no DDL, no restart. Eliminating the
runtime-DDL path from v1 removes an entire category of failure.

## 7. Backup and export

- **Snapshot**: `VACUUM INTO 'backups/aryesh-<ts>.db'` — hot, consistent, single
  file. Nightly, plus before any destructive operation. Hourly/daily/weekly tiers.
- **Portable export**: JSON per table plus a manifest with schema version and
  checksums. Human-readable, diffable, importable into a fresh instance.
- **Restore**: loads into a scratch DB and validates before swapping.

## 8. Query notes

- Contribution roll-up fetches the subgraph via one recursive CTE, then computes
  in application code — trait-free but still needing expression evaluation and
  normalisation, which do not belong in SQL.
- Trajectory reads are a single indexed range scan on `goal_snapshots`.
- Finance aggregates group `transactions` by `occurred_at` bucket and category.
- All list reads are keyset-paginated on `(updated_at, id)`. No `OFFSET`.
