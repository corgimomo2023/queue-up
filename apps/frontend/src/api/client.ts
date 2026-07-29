export interface TicketRecord {
  leaveToken: string;
  customerId: number;
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
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  return data as T;
}

const key = (queueId: string) => `queueflow:ticket:${queueId}`;
export const customerTicketStore = {
  save(queueId: string, ticket: TicketRecord) {
    localStorage.setItem(key(queueId), JSON.stringify(ticket));
  },
  load(queueId: string): TicketRecord | null {
    try {
      const value = localStorage.getItem(key(queueId));
      return value ? (JSON.parse(value) as TicketRecord) : null;
    } catch {
      return null;
    }
  },
  remove(queueId: string) {
    localStorage.removeItem(key(queueId));
  },
};
