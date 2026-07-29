import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerPage } from '../src/pages/CustomerPage';
import { VendorPage } from '../src/pages/VendorPage';
import { QueuesModule } from '../src/features/admin/modules/QueuesModule';
import type { SuperAdminOverview } from '../src/types';

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

const period = {
  startAt: '2026-07-29T01:30:00.000Z',
  endAt: '2026-07-31T15:59:59.999Z',
  lifecycleStatus: 'active' as const,
  timeZone: 'Asia/Hong_Kong' as const,
  isRemoved: false,
  removedAt: null,
};

const brand = {
  queueId: 'summer-show',
  name: 'Summer Show',
  description: 'Games, gifts and family fun on level 5.',
  logoUrl: '/event-assets/summer.webp',
};

const overview: SuperAdminOverview = {
  summary: {
    queues: 0,
    removedQueues: 0,
    scheduledQueues: 0,
    activeQueues: 0,
    endedQueues: 0,
    waiting: 0,
    served: 0,
    totalCustomers: 0,
  },
  queues: [],
};

describe('event branding and lifecycle UI', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows shared branding while retaining active public queue actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ ...brand, ...period, waitingCount: 0 })),
    );
    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('img', { name: 'Summer Show event logo' })).toHaveAttribute(
      'src',
      brand.logoUrl,
    );
    expect(screen.getByRole('heading', { name: brand.name })).toBeInTheDocument();
    expect(screen.getByText(brand.description)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join queue' })).toBeInTheDocument();
  });

  it('shows a retry message instead of queue not found when joining is rate limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'POST'
          ? response({ error: 'Too many requests, please try again later.' }, 429)
          : response({ ...brand, ...period, waitingCount: 0 }),
      ),
    );
    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Alan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join queue' }));
    expect(
      await screen.findByText('Too many requests. Please try again shortly.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Queue not found')).not.toBeInTheDocument();
  });

  it('presents branded scheduled public state with exact HKT opening and no queue action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ ...brand, ...period, lifecycleStatus: 'scheduled', waitingCount: 0 })),
    );
    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Not open yet' })).toBeInTheDocument();
    expect(screen.getByText(/Wednesday, July 29, 2026 at 9:30 AM HKT/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Summer Show event logo' })).toBeInTheDocument();
    expect(screen.getByText(brand.description)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join queue' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('presents branded closed Staff state with the inclusive HKT end and no password or queue actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('/api/vendor/')
          ? response({ error: 'Vendor authentication required' }, 401)
          : response({ ...brand, ...period, lifecycleStatus: 'ended', waitingCount: 0 }),
      ),
    );
    render(
      <MemoryRouter initialEntries={['/vendor/summer-show']}>
        <Routes>
          <Route path="/vendor/:queueId" element={<VendorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Closed' })).toBeInTheDocument();
    expect(screen.getByText(/Friday, July 31, 2026 at 11:59 PM HKT/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Summer Show event logo' })).toBeInTheDocument();
    expect(screen.getByText(brand.description)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Call next' })).not.toBeInTheDocument();
  });

  it('never flashes Staff login while the public scheduled lifecycle is still loading', async () => {
    let resolvePeriod!: (value: Response) => void;
    const periodResponse = new Promise<Response>(resolve => {
      resolvePeriod = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/api/vendor/')
        ? response({ error: 'Vendor authentication required' }, 401)
        : periodResponse,
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/vendor/summer-show']}>
        <Routes>
          <Route path="/vendor/:queueId" element={<VendorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/vendor/summer-show', expect.anything()),
    );
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    resolvePeriod(
      await response({ ...brand, ...period, lifecycleStatus: 'scheduled', waitingCount: 0 }),
    );
    expect(await screen.findByRole('heading', { name: 'Not open yet' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('supports Page Setup description and raw logo upload during event creation', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/queues') {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          businessName: 'Autumn Fair',
          description: 'A neighbourhood celebration.',
        });
        return response({ queueId: 'autumn-fair' });
      }
      if (String(input) === '/api/super-admin/queues/autumn-fair/logo') {
        expect(init?.method).toBe('PUT');
        expect(init?.body).toBeInstanceOf(File);
        expect(new Headers(init?.headers).get('Content-Type')).toBe('image/png');
        return response({ logoUrl: '/event-assets/autumn.png' });
      }
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/super-admin/queues']}>
        <QueuesModule overview={overview} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(screen.getByRole('heading', { name: 'Page Setup' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Autumn Fair' } });
    fireEvent.change(screen.getByLabelText('Event description'), {
      target: { value: 'A neighbourhood celebration.' },
    });
    expect(screen.getByLabelText('Event description')).toHaveAttribute('maxlength', '500');
    fireEvent.change(screen.getByLabelText('Staff Admin password'), {
      target: { value: 'password-123' },
    });
    const logo = new File(['png'], 'autumn.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Event logo'), { target: { files: [logo] } });
    expect(screen.getByRole('img', { name: 'Autumn Fair logo preview' })).toHaveAttribute(
      'src',
      'blob:preview',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/super-admin/queues/autumn-fair/logo',
        expect.anything(),
      ),
    );
  });

  it('stages logo removal so Cancel sends no DELETE and Save sends it once', async () => {
    const detail = {
      queue: {
        ...brand,
        ...period,
        vendorUrl: '/vendor/summer-show',
        customerUrl: '/q/summer-show',
      },
      counts: { waiting: 0, served: 0, ended: 0, total: 0 },
      customers: [],
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE' && String(input).endsWith('/logo'))
        return response({ logoUrl: null });
      return response(detail);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/super-admin/queues/summer-show']}>
        <Routes>
          <Route
            path="/super-admin/queues/:queueId"
            element={<QueuesModule overview={overview} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('img', { name: 'Summer Show event logo' })).toBeInTheDocument();
    expect(screen.getByText(brand.description)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit event' }));
    expect(screen.getByRole('heading', { name: 'Page Setup' })).toBeInTheDocument();
    expect(screen.getByLabelText('Event description')).toHaveValue(brand.description);
    fireEvent.click(screen.getByRole('button', { name: 'Remove logo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/super-admin/queues/summer-show/logo',
      expect.objectContaining({ method: 'DELETE' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove logo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/super-admin/queues/summer-show/logo',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('navigates to the created event with a localized warning when only logo upload fails', async () => {
    const detail = {
      queue: {
        ...brand,
        queueId: 'autumn-fair',
        name: 'Autumn Fair',
        logoUrl: null,
        ...period,
        vendorUrl: '/vendor/autumn-fair',
        customerUrl: '/q/autumn-fair',
      },
      counts: { waiting: 0, served: 0, ended: 0, total: 0 },
      customers: [],
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/queues') return response({ queueId: 'autumn-fair' }, 201);
      if (url.endsWith('/logo')) return response({ error: 'upload failed' }, 500);
      if (url === '/api/super-admin/queues/autumn-fair') return response(detail);
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/super-admin/queues']}>
        <Routes>
          <Route path="/super-admin/queues/*" element={<QueuesModule overview={overview} />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Autumn Fair' } });
    fireEvent.change(screen.getByLabelText('Staff Admin password'), {
      target: { value: 'password-123' },
    });
    fireEvent.change(screen.getByLabelText('Event logo'), {
      target: { files: [new File(['png'], 'autumn.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    expect(
      await screen.findByText(
        'Event details were saved, but the logo upload failed. You can retry from Edit event.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Autumn Fair' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/queues')).toHaveLength(1);
  });

  it('keeps archived Page Setup disabled and read-only', async () => {
    const detail = {
      queue: {
        ...brand,
        ...period,
        vendorUrl: '/vendor/summer-show',
        customerUrl: '/q/summer-show',
        isRemoved: true,
        removedAt: '2026-08-01T00:00:00.000Z',
      },
      counts: { waiting: 0, served: 0, ended: 0, total: 0 },
      customers: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(detail)),
    );
    render(
      <MemoryRouter initialEntries={['/super-admin/queues/summer-show']}>
        <Routes>
          <Route
            path="/super-admin/queues/:queueId"
            element={<QueuesModule overview={overview} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(brand.description)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit event' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
  });
});
