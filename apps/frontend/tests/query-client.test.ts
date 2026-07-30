import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client';
import { createAppQueryClient, queryKeys, shouldRetryQuery } from '../src/query/client';

describe('server-state query policy', () => {
  it('retries transient failures but never retries client errors', () => {
    expect(shouldRetryQuery(0, new TypeError('offline'))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError('temporarily unavailable', 503))).toBe(true);
    expect(shouldRetryQuery(2, new ApiError('temporarily unavailable', 503))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError('authentication required', 401))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError('rate limited', 429))).toBe(false);
  });

  it('uses stable, scoped keys for queue, ticket, vendor and admin data', () => {
    expect(queryKeys.queue('event-a')).toEqual(['queue', 'event-a']);
    expect(queryKeys.ticket('event-a', 12)).toEqual(['ticket', 'event-a', 12]);
    expect(queryKeys.vendor('event-a')).toEqual(['vendor', 'event-a']);
    expect(queryKeys.adminOverview('removed')).toEqual(['admin', 'overview', 'removed']);
    expect(queryKeys.adminQueue('event-a')).toEqual(['admin', 'queue', 'event-a']);
  });

  it('refetches stale server state after focus and reconnect', () => {
    const client = createAppQueryClient();
    const defaults = client.getDefaultOptions().queries;
    expect(defaults?.refetchOnWindowFocus).toBe(true);
    expect(defaults?.refetchOnReconnect).toBe(true);
    expect(defaults?.staleTime).toBe(2_000);
  });
});
