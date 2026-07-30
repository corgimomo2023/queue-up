import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../src/pages/HomePage';
import { VendorPage } from '../src/pages/VendorPage';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXI=') },
}));

const response = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const activePeriod = {
  startAt: '2026-07-01T00:00:00.000Z',
  endAt: null,
  lifecycleStatus: 'active',
  timeZone: 'Asia/Hong_Kong',
  isRemoved: false,
  removedAt: null,
};

describe('Staff entry flow', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses the landing page for Event ID and password login without exposing Event Admin access', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/queues/megabox-summer/unlock');
      expect(JSON.parse(String(init?.body))).toEqual({ credential: 'staff-password-123' });
      return response({ ok: true, queueId: 'megabox-summer' });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/vendor/:queueId" element={<h1>Staff dashboard</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Event Admin' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Event ID'), { target: { value: ' MEGABOX-SUMMER ' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'staff-password-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open staff dashboard' }));

    expect(await screen.findByRole('heading', { name: 'Staff dashboard' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the customer queue URL in the staff dashboard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('/api/vendor/')
          ? response({
              queueId: 'megabox-summer',
              name: 'Summer Event',
              waitingCount: 0,
              customers: [],
              customerUrl: '/q/megabox-summer',
              ...activePeriod,
            })
          : response({
              queueId: 'megabox-summer',
              name: 'Summer Event',
              waitingCount: 0,
              ...activePeriod,
            }),
      ),
    );

    render(
      <MemoryRouter initialEntries={['/vendor/megabox-summer']}>
        <Routes>
          <Route path="/vendor/:queueId" element={<VendorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Summer Event' })).toBeInTheDocument();
    expect(screen.getByText('Customer queue URL')).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/q/megabox-summer`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy public URL' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByAltText('Customer queue QR code')).toBeInTheDocument());
  });
});
