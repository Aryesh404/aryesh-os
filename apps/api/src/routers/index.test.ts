import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createTestApi, type TestApi } from '../testing.js';

let api: TestApi;
beforeEach(async () => {
  api = await createTestApi();
});
afterEach(() => api.close());

const caller = () => api.anonymous;

describe('health', () => {
  it('reports ok with an injected clock', async () => {
    const res = await caller().health.ping();
    expect(res).toEqual({ ok: true, at: 1_700_000_000_000, version: '0.1.0' });
  });
});

describe('measure.normalise', () => {
  it('returns the value together with its derivation', async () => {
    const res = await caller().measure.normalise({
      direction: 'increase',
      current: 140_000,
      baseline: 0,
      target: 500_000,
      label: 'monthly_revenue',
    });

    expect(res.value).toBeCloseTo(0.28, 5);
    expect(res.method).toBe('metric-normalisation');
    expect(res.inputs[0]?.detail).toBe('140000 of 500000, baseline 0');
  });

  /**
   * "This cannot be measured" is a legitimate answer, not a server fault.
   * Regression guard: tRPC middleware `next()` resolves with a result object
   * rather than throwing, so a try/catch here silently yields 500 instead.
   */
  it('surfaces an unmeasurable metric as UNPROCESSABLE_CONTENT, not 500', async () => {
    const promise = caller().measure.normalise({
      direction: 'increase',
      current: 12,
      baseline: 0,
      // no target — an unbounded metric is valid only as a rate contributor
    });

    await expect(promise).rejects.toThrow(TRPCError);
    await expect(promise).rejects.toMatchObject({
      code: 'UNPROCESSABLE_CONTENT',
      message: expect.stringContaining('no target'),
    });
  });

  it('rejects an unknown direction as BAD_REQUEST', async () => {
    const promise = caller().measure.normalise({
      // @ts-expect-error deliberately invalid input
      direction: 'sideways',
      current: 12,
    });
    await expect(promise).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
