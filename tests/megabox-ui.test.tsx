import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../src/pages/HomePage';
import { SuperAdminPage } from '../src/pages/SuperAdminPage';

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
}));
const indexHtml = readFileSync('index.html', 'utf8');

describe('NextQ wording and simple actor UI', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('presents Staff Admin login without exposing Vendor Admin navigation', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Staff Admin login' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'N NextQ' })).toBeInTheDocument();
    expect(screen.getByText('© 2026 Gallops Digital. All rights reserved.')).toBeInTheDocument();
    expect(indexHtml).toContain('<title>NextQ</title>');
    expect(screen.getByLabelText('Event ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.queryByRole('link', { name: 'Vendor Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Business name')).not.toBeInTheDocument();
  });

  it('presents the super admin as Vendor Admin and exposes event management', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes('/audit')
        ? json({ events: [] })
        : json({
            summary: { queues: 0, removedQueues: 0, scheduledQueues: 0, activeQueues: 0, endedQueues: 0, waiting: 0, served: 0, totalCustomers: 0 },
            queues: [],
          });
    }));

    render(<MemoryRouter initialEntries={['/super-admin/queues']}><SuperAdminPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/super-admin/queues');
    expect(screen.getByRole('button', { name: 'Create event' })).toBeInTheDocument();
    expect(screen.getByText('Vendor Admin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(screen.getByLabelText('Staff Admin password')).toBeRequired();
    expect(screen.getByLabelText('Staff Admin password')).toHaveAttribute('type', 'password');
  });
});
