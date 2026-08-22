// Barrel for application code. drizzle-kit reads ./tables/*.ts directly, so it
// never has to resolve this file's ESM-style specifiers.
export * from './tables/structure.js';
export * from './tables/goals.js';
export * from './tables/metrics.js';
export * from './tables/work.js';
export * from './tables/relations.js';
export * from './tables/config.js';
export * from './tables/system.js';
export * from './tables/finance.js';
export * from './tables/snapshots.js';
export * from './tables/jobs.js';
export * from './tables/settings.js';
