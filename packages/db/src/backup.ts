import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Client } from '@libsql/client';
import type { Db } from './client.js';

/**
 * docs/09 §7 — the whole OS is one file you can copy, and that is the point.
 *
 * Two mechanisms, deliberately different:
 *   - a binary snapshot, for recovery: fast, exact, opaque
 *   - a portable JSON export, for ownership: readable, diffable, importable
 *
 * The second is what makes "your data is yours" true rather than a claim.
 */

export const SCHEMA_VERSION = 1;

/** Every table carrying user data. System bookkeeping is deliberately excluded. */
const EXPORTED_TABLES = [
  'areas',
  'themes',
  'goals',
  'milestones',
  'metrics',
  'readings',
  'projects',
  'tasks',
  'habits',
  'habit_entries',
  'relations',
  'accounts',
  'transactions',
  'categories',
  'custom_field_defs',
  'goal_snapshots',
  'metric_snapshots',
  'settings',
] as const;

/**
 * Not exported: credentials, sessions, passkeys, device tokens (secrets, and
 * meaningless on another machine), and audit_events/revisions/jobs (large,
 * machine-local bookkeeping). A binary snapshot carries those.
 */
const EXCLUDED_FROM_EXPORT = [
  'credentials',
  'sessions',
  'passkeys',
  'auth_challenges',
  'device_tokens',
  'audit_events',
  'revisions',
  'jobs',
];

export interface ExportManifest {
  schemaVersion: number;
  exportedAt: number;
  /** sha256 of each table's serialised rows, so tampering is detectable. */
  checksums: Record<string, string>;
  counts: Record<string, number>;
  excluded: string[];
}

export interface ExportPayload {
  manifest: ExportManifest;
  tables: Record<string, unknown[]>;
}

const checksum = (rows: unknown[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');

/**
 * A directory of readable JSON rather than a proprietary blob: human-readable,
 * diffable, and git-committable if you want a history of your own life.
 */
export async function exportAll(db: Db, now: number): Promise<ExportPayload> {
  const tables: Record<string, unknown[]> = {};
  const checksums: Record<string, string> = {};
  const counts: Record<string, number> = {};

  for (const table of EXPORTED_TABLES) {
    const rows = await db.all<Record<string, unknown>>(
      sql.raw(`SELECT * FROM ${table}`),
    );
    tables[table] = rows;
    checksums[table] = checksum(rows);
    counts[table] = rows.length;
  }

  return {
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now,
      checksums,
      counts,
      excluded: EXCLUDED_FROM_EXPORT,
    },
    tables,
  };
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; problems: string[] };

/**
 * Checked before anything is written. An import that fails halfway is worse
 * than one that refuses to start.
 */
export function validateExport(payload: ExportPayload): ValidationResult {
  const problems: string[] = [];

  if (payload.manifest === undefined || payload.tables === undefined) {
    return { valid: false, problems: ['not an Aryesh OS export'] };
  }

  if (payload.manifest.schemaVersion !== SCHEMA_VERSION) {
    problems.push(
      `export is schema version ${payload.manifest.schemaVersion}, this build reads ${SCHEMA_VERSION}`,
    );
  }

  for (const [table, expected] of Object.entries(payload.manifest.checksums)) {
    const rows = payload.tables[table];
    if (rows === undefined) {
      problems.push(`manifest lists '${table}' but the export has no such table`);
      continue;
    }
    if (checksum(rows) !== expected) {
      problems.push(`'${table}' does not match its checksum — the file was altered`);
    }
  }

  return problems.length === 0 ? { valid: true } : { valid: false, problems };
}

export interface ImportResult {
  tables: number;
  rows: number;
}

/**
 * Replaces the contents of the exported tables. Runs inside one transaction, so
 * a failure leaves the database exactly as it was rather than half-restored.
 *
 * Foreign keys are deferred for the duration: the rows are internally
 * consistent but arrive in an order SQLite would otherwise reject.
 */
export async function importAll(
  client: Client,
  payload: ExportPayload,
): Promise<ImportResult> {
  const validation = validateExport(payload);
  if (!validation.valid) {
    throw new Error(`refusing to import: ${validation.problems.join('; ')}`);
  }

  const statements: Array<{ sql: string; args: unknown[] }> = [];

  // Children first, so deletes do not trip a foreign key on the way out.
  for (const table of [...EXPORTED_TABLES].reverse()) {
    statements.push({ sql: `DELETE FROM ${table}`, args: [] });
  }

  let rowCount = 0;
  for (const table of EXPORTED_TABLES) {
    const rows = (payload.tables[table] ?? []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0) continue;
      const placeholders = columns.map(() => '?').join(', ');
      statements.push({
        sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
        args: columns.map((c) => normalise(row[c])),
      });
      rowCount++;
    }
  }

  await client.execute('PRAGMA foreign_keys = OFF');
  try {
    await client.batch(
      statements.map((s) => ({ sql: s.sql, args: s.args as never })),
      'write',
    );
  } finally {
    await client.execute('PRAGMA foreign_keys = ON');
  }

  return { tables: EXPORTED_TABLES.length, rows: rowCount };
}

/** JSON columns come back as objects; SQLite wants them as text. */
function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

// ---------------------------------------------------------------------------
// Binary snapshots
// ---------------------------------------------------------------------------

export interface BackupFile {
  path: string;
  bytes: number;
  createdAt: number;
}

/**
 * `VACUUM INTO` is hot and consistent — no need to stop the app, and no risk of
 * copying a torn WAL. Taken nightly and before anything destructive.
 */
export async function snapshotDatabase(
  client: Client,
  targetPath: string,
): Promise<BackupFile> {
  const absolute = resolve(targetPath);
  mkdirSync(dirname(absolute), { recursive: true });

  // The path is interpolated because VACUUM INTO does not accept a bound
  // parameter. It is caller-supplied, never user input, and quotes are escaped.
  await client.execute(`VACUUM INTO '${absolute.replace(/'/g, "''")}'`);

  const stats = statSync(absolute);
  return { path: absolute, bytes: stats.size, createdAt: stats.mtimeMs };
}

export function listBackups(directory: string): BackupFile[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.startsWith('aryesh-') && name.endsWith('.db'))
      .map((name) => {
        const path = join(directory, name);
        const stats = statSync(path);
        return { path, bytes: stats.size, createdAt: stats.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/**
 * Hourly, daily, and weekly tiers (docs/09 §7): everything from the last day,
 * one per day for a fortnight, one per week beyond that.
 */
export function pruneBackups(directory: string, now: number): string[] {
  const backups = listBackups(directory);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  const keep = new Set<string>();
  const seenDays = new Set<number>();
  const seenWeeks = new Set<number>();

  for (const backup of backups) {
    const age = now - backup.createdAt;
    if (age < DAY) {
      keep.add(backup.path);
    } else if (age < 14 * DAY) {
      const day = Math.floor(backup.createdAt / DAY);
      if (!seenDays.has(day)) {
        seenDays.add(day);
        keep.add(backup.path);
      }
    } else {
      const week = Math.floor(backup.createdAt / (7 * DAY));
      if (!seenWeeks.has(week)) {
        seenWeeks.add(week);
        keep.add(backup.path);
      }
    }
  }

  const removed: string[] = [];
  for (const backup of backups) {
    if (keep.has(backup.path)) continue;
    try {
      unlinkSync(backup.path);
      removed.push(backup.path);
    } catch {
      /* already gone */
    }
  }
  return removed;
}
