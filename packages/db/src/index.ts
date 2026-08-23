export { createDb, getDb, closeDb, resolveDbUrl, configureConnection } from './client.js';
export type { Db, DbOptions } from './client.js';
export { newId, newIdAt } from './ids.js';
export * from './repositories/index.js';
export { ensureSearchIndex, search, reindexSearch } from './search.js';
export {
  exportAll,
  importAll,
  validateExport,
  snapshotDatabase,
  listBackups,
  pruneBackups,
  SCHEMA_VERSION,
} from './backup.js';
export type {
  ExportPayload,
  ExportManifest,
  BackupFile,
  ImportResult,
} from './backup.js';
export type { SearchHit } from './search.js';
export * as schema from './schema/index.js';
