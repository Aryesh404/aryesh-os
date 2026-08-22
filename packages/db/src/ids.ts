import { monotonicFactory } from 'ulid';

/**
 * ULIDs: sortable by creation time, generated without coordination, and safe to
 * mint before a write. `monotonicFactory` keeps ids strictly increasing within
 * the same millisecond, which matters for keyset pagination and for seeded
 * fixtures that create many records in one tick.
 */
const ulid = monotonicFactory();

export function newId(): string {
  return ulid();
}

/** Deterministic ids for tests and seed data. */
export function newIdAt(seedTime: number): string {
  return ulid(seedTime);
}
