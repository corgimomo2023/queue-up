export interface TicketRecord {
  leaveToken: string;
  customerId: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  const data = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json()) as Record<string, unknown>)
    : {};
  if (!response.ok)
    throw new ApiError(
      typeof data.error === 'string' ? data.error : 'Request failed',
      response.status,
    );
  return data as T;
}

const key = (queueId: string) => `queueflow:ticket:${queueId}`;
const volatileTickets = new Map<string, TicketRecord | null>();

export const customerTicketStore = {
  save(queueId: string, ticket: TicketRecord) {
    try {
      localStorage.setItem(key(queueId), JSON.stringify(ticket));
      volatileTickets.delete(queueId);
    } catch {
      volatileTickets.set(queueId, ticket);
    }
  },
  load(queueId: string): TicketRecord | null {
    if (volatileTickets.has(queueId)) {
      const fallback = volatileTickets.get(queueId) ?? null;
      try {
        if (fallback === null) {
          localStorage.removeItem(key(queueId));
          volatileTickets.delete(queueId);
          return null;
        }
        localStorage.setItem(key(queueId), JSON.stringify(fallback));
        volatileTickets.delete(queueId);
        return fallback;
      } catch {
        return fallback;
      }
    }
    try {
      const value = localStorage.getItem(key(queueId));
      return value ? (JSON.parse(value) as TicketRecord) : null;
    } catch {
      return null;
    }
  },
  remove(queueId: string) {
    try {
      localStorage.removeItem(key(queueId));
      volatileTickets.delete(queueId);
    } catch {
      volatileTickets.set(queueId, null);
    }
  },
};
