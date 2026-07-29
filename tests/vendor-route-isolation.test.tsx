import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VendorPage } from '../src/pages/VendorPage';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXI=') } }));

const period = {
  startAt: '2026-07-28T17:30:00.000Z',
  endAt: '2026-07-31T15:59:59.999Z',
  lifecycleStatus: 'active' as const,
  isRemoved: false,
  removedAt: null,
};

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function VendorRouteHarness() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate('/vendor/event-b')}>Switch event</button><Routes><Route path="/vendor/:queueId" element={<VendorPage />} /></Routes></>;
}

describe('Staff route isolation', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('clears the previous event dashboard when navigating to an unauthorised event', async () => {
    const eventA = { queueId: 'event-a', name: 'Event A', logoUrl: null, description: null, ...period, waitingCount: 1 };
    let resolveAction!: (value: Response) => void;
    const pendingAction = new Promise<Response>(resolve => { resolveAction = resolve; });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/queues/event-a') return response(eventA);
      if (url === '/api/vendor/event-a') return response({ ...eventA, customerUrl: '/q/event-a', customers: [{ customerId: 1, name: 'Alice from A', joinedAt: period.startAt }] });
      if (url === '/api/vendor/event-a/serve-next') return pendingAction;
      if (url === '/api/queues/event-b') return response({ ...eventA, queueId: 'event-b', name: 'Event B', waitingCount: 0 });
      if (url === '/api/vendor/event-b') return response({ error: 'Vendor authentication required' }, 401);
      return response({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/vendor/event-a']}><VendorRouteHarness /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Alice from A')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Call next' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/vendor/event-a/serve-next', expect.objectContaining({ method: 'POST' })));
    fireEvent.click(screen.getByRole('button', { name: 'Switch event' }));

    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    resolveAction(await response({ ok: true }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByText('Alice from A')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Call next' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/vendor/event-a')).toHaveLength(1);
  });
});
