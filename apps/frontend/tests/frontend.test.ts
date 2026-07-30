import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, customerTicketStore } from '../src/api/client';
import { reconcileTicketStatus } from '../src/ticket-reconciliation';
import type { TicketStatus } from '../src/types';

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
  it('wraps unbroken customer messages inside the Staff Admin queue card', () => {
    const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
    expect(css).toMatch(/\.customer-info p\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  });
  it('never lets a stale waiting refresh overwrite a served ticket', () => {
    const waiting: TicketStatus = {
      customerId: 2,
      name: 'Alan',
      status: 'waiting',
      position: 1,
      peopleAhead: 0,
      waitingCount: 1,
      isNext: true,
      calledAt: null,
      expiresAt: null,
    };
    const served: TicketStatus = {
      ...waiting,
      status: 'served',
      position: 0,
      waitingCount: 0,
      isNext: false,
      calledAt: '2026-07-30T02:00:00.000Z',
      expiresAt: '2026-07-30T02:05:00.000Z',
    };

    expect(reconcileTicketStatus(served, waiting)).toEqual(served);
    expect(reconcileTicketStatus(waiting, served)).toEqual(served);
  });

  it('delivers browser notifications without depending on device audio or vibration', async () => {
    vi.resetModules();
    const shown: string[] = [];
    class NotificationMock {
      static permission: NotificationPermission = 'granted';
      readonly title: string;
      constructor(title: string) {
        this.title = title;
        shown.push(title);
      }
    }
    vi.stubGlobal('Notification', NotificationMock);
    const { deliverForegroundNotification } = await import('../src/notification-preferences');

    await expect(deliverForegroundNotification('It is your turn', 'Return now')).resolves.toBe(
      undefined,
    );
    expect(shown).toEqual(['It is your turn']);
  });

  it('keeps ticket operations usable when localStorage writes are blocked', () => {
    localStorage.setItem(
      'queueflow:ticket:q-memory',
      JSON.stringify({ leaveToken: 'old', customerId: 1 }),
    );
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });

    expect(() =>
      customerTicketStore.save('q-memory', { leaveToken: 'opaque', customerId: 7 }),
    ).not.toThrow();
    expect(customerTicketStore.load('q-memory')).toEqual({
      leaveToken: 'opaque',
      customerId: 7,
    });
    setItem.mockRestore();
    expect(customerTicketStore.load('q-memory')).toEqual({
      leaveToken: 'opaque',
      customerId: 7,
    });
    expect(JSON.parse(localStorage.getItem('queueflow:ticket:q-memory') ?? 'null')).toEqual({
      leaveToken: 'opaque',
      customerId: 7,
    });
    localStorage.setItem(
      'queueflow:ticket:q-memory',
      JSON.stringify({ leaveToken: 'cross-tab', customerId: 9 }),
    );
    expect(customerTicketStore.load('q-memory')).toEqual({
      leaveToken: 'cross-tab',
      customerId: 9,
    });

    localStorage.setItem(
      'queueflow:ticket:q-stale',
      JSON.stringify({ leaveToken: 'stale', customerId: 8 }),
    );
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    expect(() => customerTicketStore.remove('q-memory')).not.toThrow();
    expect(() => customerTicketStore.remove('q-stale')).not.toThrow();
    expect(customerTicketStore.load('q-memory')).toBeNull();
    expect(customerTicketStore.load('q-stale')).toBeNull();
    removeItem.mockRestore();
    expect(customerTicketStore.load('q-stale')).toBeNull();
    expect(localStorage.getItem('queueflow:ticket:q-stale')).toBeNull();
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
