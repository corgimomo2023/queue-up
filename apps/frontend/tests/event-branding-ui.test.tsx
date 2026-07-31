import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerPage } from '../src/pages/CustomerPage';
import { customerTicketStore } from '../src/api/client';
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

  it('keeps the saved customer ticket when status refresh fails at the network', async () => {
    const savedTicket = { customerId: 42, leaveToken: 'keep-this-ticket' };
    customerTicketStore.save(brand.queueId, savedTicket);
    const statusFailure = new TypeError('Failed to fetch');
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/status?token=')
        ? Promise.reject(statusFailure)
        : response({ ...brand, ...period, waitingCount: 1 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    );

    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/status?token='),
        expect.anything(),
      ),
    );
    expect(customerTicketStore.load(brand.queueId)).toEqual(savedTicket);
    expect(
      screen.getByText('We could not update your ticket. Your place is safe and we will retry.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join queue' })).not.toBeInTheDocument();
  });

  it('does not revive a ticket when an older status response arrives after leaving', async () => {
    const waitingStatus = {
      customerId: 42,
      name: 'Alan',
      status: 'waiting',
      position: 2,
      peopleAhead: 1,
      waitingCount: 2,
      isNext: false,
      calledAt: null,
      expiresAt: null,
    } as const;
    customerTicketStore.save(brand.queueId, {
      customerId: 42,
      leaveToken: 'leaving-ticket',
    });
    let statusCalls = 0;
    let resolveStaleStatus: ((value: Response) => void) | undefined;
    const staleStatus = new Promise<Response>(resolve => {
      resolveStaleStatus = resolve;
    });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/status?token=')) {
          statusCalls += 1;
          return statusCalls === 1 ? response(waitingStatus) : staleStatus;
        }
        if (url.includes('/customers/me') && init?.method === 'DELETE') {
          return response({ ok: true });
        }
        return response({ ...brand, ...period, waitingCount: 2 });
      }),
    );
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    );

    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const leave = await screen.findByRole('button', { name: 'Leave queue' });
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(statusCalls).toBe(2));
    fireEvent.click(leave);
    expect(await screen.findByRole('button', { name: 'Join queue' })).toBeInTheDocument();

    await act(async () => {
      resolveStaleStatus?.(await response(waitingStatus));
      await staleStatus;
    });

    expect(customerTicketStore.load(brand.queueId)).toBeNull();
    expect(screen.getByRole('button', { name: 'Join queue' })).toBeInTheDocument();
    expect(screen.queryByText('Ticket #42')).not.toBeInTheDocument();
  });

  it('requests notification permission only after opt-in and can test the browser alert', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    const shownNotifications: string[] = [];
    class NotificationMock {
      static permission: NotificationPermission = 'default';
      static requestPermission = requestPermission;
      readonly title: string;
      constructor(title: string) {
        this.title = title;
        shownNotifications.push(title);
      }
    }
    requestPermission.mockImplementation(async () => {
      NotificationMock.permission = 'granted';
      return 'granted';
    });
    vi.stubGlobal('Notification', NotificationMock);
    customerTicketStore.save(brand.queueId, {
      customerId: 42,
      leaveToken: 'notification-ticket',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('/status?token=')
          ? response({
              customerId: 42,
              name: 'Alan',
              status: 'waiting',
              position: 2,
              peopleAhead: 1,
              waitingCount: 2,
              isNext: false,
              calledAt: null,
              expiresAt: null,
            })
          : response({ ...brand, ...period, waitingCount: 2 }),
      ),
    );
    let calledListener: ((event: Event) => void) | undefined;
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener(name: string, listener: (event: Event) => void) {
          if (name === 'queue.called') calledListener = listener;
        }
        close() {}
      },
    );

    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const enable = await screen.findByRole('button', { name: 'Notify me when it is my turn' });
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(enable);
    await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());

    fireEvent.click(await screen.findByRole('button', { name: 'Test alert' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'It is your turn. Please return to the venue within 5 minutes.',
    );
    await waitFor(() => {
      expect(shownNotifications).toContain('It is your turn');
    });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const calledAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(calledAt) + 2 * 60_000).toISOString();
    act(() => {
      calledListener?.(
        new MessageEvent('queue.called', {
          data: JSON.stringify({ calledAt, expiresAt }),
        }),
      );
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'It is your turn. Please return to the venue within 5 minutes.',
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Time remaining')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I am on my way' })).not.toBeInTheDocument();
  });

  it('does not replay foreground notifications or the full-screen banner after expiry', async () => {
    const calledAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const expiresAt = new Date(Date.now() - 5 * 60_000).toISOString();
    customerTicketStore.save(brand.queueId, {
      customerId: 42,
      leaveToken: 'expired-ticket',
    });
    localStorage.setItem(`nextq:notifications:${brand.queueId}`, 'enabled');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('/status?token=')
          ? response({
              customerId: 42,
              name: 'Alan',
              status: 'served',
              position: 0,
              peopleAhead: 0,
              waitingCount: 0,
              isNext: false,
              calledAt,
              expiresAt,
            })
          : response({ ...brand, ...period, waitingCount: 0 }),
      ),
    );
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    );

    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('The 5-minute return window has ended.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('restores the called alert from the persisted served ticket status after reload', async () => {
    const calledAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(calledAt) + 5 * 60_000).toISOString();
    customerTicketStore.save(brand.queueId, {
      customerId: 42,
      leaveToken: 'served-ticket',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('/status?token=')
          ? response({
              customerId: 42,
              name: 'Alan',
              status: 'served',
              position: 0,
              peopleAhead: 0,
              waitingCount: 0,
              isNext: false,
              calledAt,
              expiresAt,
            })
          : response({ ...brand, ...period, waitingCount: 0 }),
      ),
    );
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    );

    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'It is your turn. Please return to the venue within 5 minutes.',
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Time remaining')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I am on my way' })).not.toBeInTheDocument();
  });

  it('shows the called alert immediately when SSE arrives even if status refresh fails', async () => {
    const calledAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(calledAt) + 5 * 60_000).toISOString();
    customerTicketStore.save(brand.queueId, {
      customerId: 42,
      leaveToken: 'waiting-ticket',
    });
    let statusRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (!String(input).includes('/status?token=')) {
        return response({ ...brand, ...period, waitingCount: 1 });
      }
      statusRequests += 1;
      return statusRequests === 1
        ? response({
            customerId: 42,
            name: 'Alan',
            status: 'waiting',
            position: 1,
            peopleAhead: 0,
            waitingCount: 1,
            isNext: true,
          })
        : Promise.reject(new TypeError('Failed to fetch'));
    });
    let calledListener: ((event: MessageEvent<string>) => void) | undefined;
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
          if (type === 'queue.called') calledListener = listener;
        }
        close() {}
      },
    );

    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: "You're next" })).toBeInTheDocument();

    await act(async () =>
      calledListener?.(
        new MessageEvent('queue.called', { data: JSON.stringify({ calledAt, expiresAt }) }),
      ),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'It is your turn. Please return to the venue within 5 minutes.',
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Time remaining')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I am on my way' })).not.toBeInTheDocument();
    expect(customerTicketStore.load(brand.queueId)).not.toBeNull();
  });

  it('reconnects after an SSE error and recovers a missed call from ticket status', async () => {
    const calledAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(calledAt) + 5 * 60_000).toISOString();
    customerTicketStore.save(brand.queueId, {
      customerId: 42,
      leaveToken: 'reconnect-ticket',
    });
    let statusRequests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (!String(input).includes('/status?token=')) {
          return response({ ...brand, ...period, waitingCount: 1 });
        }
        statusRequests += 1;
        return response(
          statusRequests === 1
            ? {
                customerId: 42,
                name: 'Alan',
                status: 'waiting',
                position: 1,
                peopleAhead: 0,
                waitingCount: 1,
                isNext: true,
                calledAt: null,
                expiresAt: null,
              }
            : {
                customerId: 42,
                name: 'Alan',
                status: 'served',
                position: 0,
                peopleAhead: 0,
                waitingCount: 0,
                isNext: false,
                calledAt,
                expiresAt,
              },
        );
      }),
    );
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener(type: string, listener: EventListener) {
          listeners.set(type, listener);
        }
        close() {}
      },
    );

    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: "You're next" })).toBeInTheDocument();

    await act(async () => listeners.get('error')?.(new Event('error')));

    expect(await screen.findByText('Reconnecting to live updates…')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'It is your turn. Please return to the venue within 5 minutes.',
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Time remaining')).not.toBeInTheDocument();
  });

  it('shows offline and background page status without discarding the ticket', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    customerTicketStore.save(brand.queueId, {
      customerId: 42,
      leaveToken: 'offline-ticket',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('/status?token=')
          ? response({
              customerId: 42,
              name: 'Alan',
              status: 'waiting',
              position: 2,
              peopleAhead: 1,
              waitingCount: 2,
              isNext: false,
              calledAt: null,
              expiresAt: null,
            })
          : response({ ...brand, ...period, waitingCount: 2 }),
      ),
    );
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    );

    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        'You are offline. Your ticket is saved and updates will resume automatically.',
      ),
    ).toBeInTheDocument();
    expect(customerTicketStore.load(brand.queueId)).not.toBeNull();

    online.mockReturnValue(true);
    visibility.mockReturnValue('hidden');
    act(() => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(
      await screen.findByText(
        'This page is running in the background. Return here to check your latest position.',
      ),
    ).toBeInTheDocument();
  });

  it('ignores a stale queue response after navigating to another event', async () => {
    let resolveSummer: ((value: Response) => void) | undefined;
    const delayedSummer = new Promise<Response>(resolve => {
      resolveSummer = resolve;
    });
    const winterBrand = {
      ...brand,
      queueId: 'winter-show',
      name: 'Winter Show',
      logoUrl: '/event-assets/winter.webp',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/queues/summer-show')) return delayedSummer;
        if (url.includes('/api/queues/winter-show')) {
          return Promise.resolve(response({ ...winterBrand, ...period, waitingCount: 0 }));
        }
        return Promise.resolve(response({}, 404));
      }),
    );
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    );

    render(
      <MemoryRouter initialEntries={['/q/summer-show']}>
        <Link to="/q/winter-show">Open winter</Link>
        <Routes>
          <Route path="/q/:queueId" element={<CustomerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Open winter' }));
    expect(await screen.findByRole('heading', { name: 'Winter Show' })).toBeInTheDocument();

    await act(async () => {
      resolveSummer?.(await response({ ...brand, ...period, waitingCount: 3 }));
      await delayedSummer;
    });

    expect(screen.getByRole('heading', { name: 'Winter Show' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Summer Show' })).not.toBeInTheDocument();
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

  it('supports Page setup description and styled logo upload during event creation', async () => {
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
    expect(screen.getByRole('heading', { name: 'Page setup' })).toBeInTheDocument();
    expect(screen.getByText('Choose image')).toHaveClass('ui-file-upload-trigger');
    expect(screen.getByText('No image selected')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Autumn Fair' } });
    fireEvent.change(screen.getByLabelText('Event description'), {
      target: { value: 'A neighbourhood celebration.' },
    });
    expect(screen.getByLabelText('Event description')).toHaveAttribute('maxlength', '500');
    fireEvent.change(screen.getByLabelText('Staff password'), {
      target: { value: 'password-123' },
    });
    const logo = new File(['png'], 'autumn.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Event logo'), { target: { files: [logo] } });
    expect(screen.getByText('autumn.png')).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'Page setup' })).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Staff password'), {
      target: { value: 'password-123' },
    });
    fireEvent.change(screen.getByLabelText('Event logo'), {
      target: { files: [new File(['png'], 'autumn.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    expect(
      await screen.findByText(
        'Event details were saved, but the logo could not be uploaded. Try again from Edit event.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Autumn Fair' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/queues')).toHaveLength(1);
  });

  it('keeps archived Page setup disabled and read-only', async () => {
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
