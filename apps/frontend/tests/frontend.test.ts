import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, customerTicketStore } from '../src/api/client';

describe('frontend API utilities', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it('parses JSON and throws safe API messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ queueId: 'abc' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(apiRequest<{ queueId: string }>('/api/x')).resolves.toEqual({ queueId: 'abc' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(apiRequest('/api/x')).rejects.toThrow('Invalid request');
  });
  it('preserves HTTP status on API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Too many requests, please try again later.' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(apiRequest('/api/x')).rejects.toMatchObject({
      message: 'Too many requests, please try again later.',
      status: 429,
    });
  });
  it('stores each customer ticket by queue without leaking into cookies', () => {
    customerTicketStore.save('q-one', { leaveToken: 'opaque', customerId: 2 });
    expect(customerTicketStore.load('q-one')).toEqual({ leaveToken: 'opaque', customerId: 2 });
    expect(customerTicketStore.load('q-two')).toBeNull();
    expect(document.cookie).not.toContain('opaque');
    customerTicketStore.remove('q-one');
    expect(customerTicketStore.load('q-one')).toBeNull();
  });
});
