import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../src/pages/HomePage';
import { CustomerPage } from '../src/pages/CustomerPage';
import { VendorPage } from '../src/pages/VendorPage';
import { dateTime } from '../src/features/admin/formatters';

const scheduledQueue = {
  queueId: 'later',
  name: 'Later Shop',
  waitingCount: 0,
  startAt: '2026-07-23T01:30:00.000Z',
  endAt: null,
  lifecycleStatus: 'scheduled',
  timeZone: 'Asia/Hong_Kong',
  isRemoved: false,
  removedAt: null,
};

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('access period UI', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('formats admin timestamps in Hong Kong time', () => {
    expect(dateTime('2026-07-22T12:00:00.000Z')).toContain('20:00');
  });

  it('uses the landing page for Staff Admin login without event creation', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Staff Admin login' })).toBeInTheDocument();
    expect(screen.getByLabelText('Event ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Business name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
  });

  it('renders a non-interactive scheduled customer state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(scheduledQueue)),
    );
    render(
      <MemoryRouter initialEntries={['/q/later']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Not open yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join queue' })).not.toBeInTheDocument();
  });

  it('renders scheduled Staff Admin state before asking for a password', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('/api/vendor/')
          ? response({ error: 'Vendor authentication required' }, 401)
          : response(scheduledQueue),
      ),
    );
    render(
      <MemoryRouter initialEntries={['/vendor/later']}>
        <Routes>
          <Route path="/vendor/:queueId" element={<VendorPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Not open yet' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
