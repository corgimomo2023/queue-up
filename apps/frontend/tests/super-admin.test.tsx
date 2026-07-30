import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SuperAdminPage } from '../src/pages/SuperAdminPage';

const styles = readFileSync('src/styles.css', 'utf8');
const accessPeriodStyles = readFileSync('src/access-period.css', 'utf8');

function AdminRouteHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/super-admin/queues/event-b')}>Switch event</button>
      <SuperAdminPage />
    </>
  );
}

describe('SuperAdminPage', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Super admin authentication required' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
  });

  it('keeps admin module names free of browser hyperlink styling', () => {
    expect(styles).toContain('.admin-module-nav a:visited');
    expect(styles).toMatch(/\.admin-module-nav a\s*\{[^}]*text-decoration:\s*none/);
    expect(styles).toMatch(/\.admin-module-nav a:visited\s*\{[^}]*color:\s*#5d554f/);
  });

  it('keeps the create-event dialog wide and scrollable within short viewports', () => {
    expect(accessPeriodStyles).toMatch(
      /\.create-event-dialog\s*\{[^}]*width:\s*min\(760px,\s*100%\)/,
    );
    expect(accessPeriodStyles).toMatch(
      /\.confirm-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 40px\)[^}]*overflow-y:\s*auto/,
    );
  });

  it('shows the protected login instead of leaking admin data', async () => {
    render(
      <MemoryRouter>
        <SuperAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Event Admin sign-in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Event Admin password')).toHaveAttribute('type', 'password');
  });

  it('uses module navigation and opens audit as its own workspace', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes('/audit')
          ? {
              events: [
                {
                  id: 1,
                  queueId: null,
                  queueName: null,
                  customerId: null,
                  actorType: 'super_admin',
                  action: 'SUPER_ADMIN_LOGIN_SUCCESS',
                  metadata: {},
                  ipAddress: null,
                  userAgent: null,
                  createdAt: '2026-07-22T09:00:00.000Z',
                },
              ],
            }
          : {
              summary: {
                queues: 2,
                removedQueues: 0,
                scheduledQueues: 0,
                activeQueues: 2,
                endedQueues: 0,
                waiting: 3,
                served: 4,
                totalCustomers: 7,
              },
              queues: [],
            };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );

    render(
      <MemoryRouter initialEntries={['/super-admin/overview']}>
        <SuperAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    const menu = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menu);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('navigation', { name: 'Admin menu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute(
      'href',
      '/super-admin/queues',
    );

    fireEvent.click(screen.getByRole('link', { name: 'Audit log' }));
    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.getByText('Super Admin Login Success')).toBeInTheDocument();
  });

  it('hides staff and customer links for archived events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes('/queues/archived-one')
          ? {
              queue: {
                queueId: 'archived-one',
                name: 'Archived Event',
                vendorUrl: '/vendor/archived-one',
                customerUrl: '/q/archived-one',
                startAt: '2026-07-22T08:00:00.000Z',
                endAt: null,
                lifecycleStatus: 'active',
                timeZone: 'Asia/Hong_Kong',
                isRemoved: true,
                removedAt: '2026-07-23T08:00:00.000Z',
              },
              counts: { waiting: 0, served: 0, ended: 0, total: 0 },
              customers: [],
            }
          : url.includes('/audit')
            ? { events: [] }
            : {
                summary: {
                  queues: 0,
                  removedQueues: 1,
                  scheduledQueues: 0,
                  activeQueues: 0,
                  endedQueues: 0,
                  waiting: 0,
                  served: 0,
                  totalCustomers: 0,
                },
                queues: [],
              };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );

    render(
      <MemoryRouter initialEntries={['/super-admin/queues/archived-one']}>
        <SuperAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Archived Event' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Staff dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Customer queue page' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore event' })).toBeInTheDocument();
  });

  it('keeps queue inspection and system status in separate modules', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        let body: unknown;
        if (url.includes('/audit')) body = { events: [] };
        else if (url.includes('/queues/test-one'))
          body = {
            queue: {
              queueId: 'test-one',
              name: 'Test One',
              vendorUrl: '/vendor/test-one',
              customerUrl: '/q/test-one',
              startAt: '2026-07-22T08:00:00.000Z',
              endAt: '2026-07-23T15:59:59.999Z',
              lifecycleStatus: 'active',
              timeZone: 'Asia/Hong_Kong',
              isRemoved: false,
              removedAt: null,
            },
            counts: { waiting: 1, served: 0, ended: 0, total: 1 },
            customers: [
              {
                customerId: 1,
                name: 'Alan',
                phoneMasked: '91••••67',
                message: 'Window seat',
                joinedAt: '2026-07-22T09:00:00.000Z',
                status: 'waiting',
                endedAt: null,
                endedReason: null,
              },
            ],
          };
        else
          body = {
            summary: {
              queues: 1,
              removedQueues: 0,
              scheduledQueues: 0,
              activeQueues: 1,
              endedQueues: 0,
              waiting: 1,
              served: 0,
              totalCustomers: 1,
            },
            queues: [
              {
                queueId: 'test-one',
                name: 'Test One',
                createdAt: '2026-07-22T08:00:00.000Z',
                waitingCount: 1,
                servedCount: 0,
                totalCustomers: 1,
                lastActivityAt: '2026-07-22T09:00:00.000Z',
                startAt: '2026-07-22T08:00:00.000Z',
                endAt: null,
                lifecycleStatus: 'active',
                timeZone: 'Asia/Hong_Kong',
                isRemoved: false,
                removedAt: null,
              },
            ],
          };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );

    render(
      <MemoryRouter initialEntries={['/super-admin/queues']}>
        <SuperAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('heading', { name: 'Test One' })).toBeInTheDocument();
    expect(screen.getByText('Window seat')).toBeInTheDocument();
    expect(screen.getByText('Time zone: Asia/Hong_Kong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit event' }));
    const endDate = screen.getByLabelText(/New end date/) as HTMLInputElement;
    expect(endDate.value).toBe('2026-07-23');
    fireEvent.change(endDate, { target: { value: '' } });
    expect(endDate.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive event' }));
    expect(screen.getByRole('dialog', { name: 'Archive this event?' })).toBeInTheDocument();
    const destructiveButton = screen.getAllByRole('button', { name: 'Archive event' })[1];
    expect(destructiveButton).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Test One' } });
    expect(destructiveButton).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('link', { name: 'System' }));
    expect(await screen.findByRole('heading', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByText('Records available')).toBeInTheDocument();
  });

  it('does not carry an open event dialog across admin event routes', async () => {
    let resolveEventB!: (value: Response) => void;
    const eventB = new Promise<Response>(resolve => {
      resolveEventB = resolve;
    });
    const detail = (queueId: string, name: string) => ({
      queue: {
        queueId,
        name,
        vendorUrl: `/vendor/${queueId}`,
        customerUrl: `/q/${queueId}`,
        description: null,
        logoUrl: null,
        startAt: '2026-07-22T08:00:00.000Z',
        endAt: null,
        lifecycleStatus: 'active',
        timeZone: 'Asia/Hong_Kong',
        isRemoved: false,
        removedAt: null,
      },
      counts: { waiting: 0, served: 0, ended: 0, total: 0 },
      customers: [],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        const json = (body: unknown) =>
          Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        if (url.includes('/queues/event-a')) return json(detail('event-a', 'Event A'));
        if (url.includes('/queues/event-b')) return eventB;
        if (url.includes('/audit')) return json({ events: [] });
        return json({
          summary: {
            queues: 2,
            removedQueues: 0,
            scheduledQueues: 0,
            activeQueues: 2,
            endedQueues: 0,
            waiting: 0,
            served: 0,
            totalCustomers: 0,
          },
          queues: [],
        });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/super-admin/queues/event-a']}>
        <AdminRouteHarness />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Event A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit event' }));
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch event' }));
    expect(screen.queryByRole('heading', { name: 'Event A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit event' })).not.toBeInTheDocument();

    resolveEventB(
      new Response(JSON.stringify(detail('event-b', 'Event B')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Event B' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit event' })).not.toBeInTheDocument(),
    );
  });
});
