import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../src/pages/HomePage';
import { SuperAdminPage } from '../src/pages/SuperAdminPage';

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
const indexHtml = readFileSync('index.html', 'utf8');

describe('Easy Queue wording and simple actor UI', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('presents staff sign-in without exposing Event Admin navigation', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'EQ Easy Queue' })).toBeInTheDocument();
    expect(screen.getByText('© 2026 Gallops Digital. All rights reserved.')).toBeInTheDocument();
    expect(indexHtml).toContain('<title>Easy Queue</title>');
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(indexHtml).toContain(
      '<link rel="icon" href="/favicon-easy-queue.ico?v=2" sizes="any" />',
    );
    expect(indexHtml).not.toContain('href="/favicon.ico"');
    expect(indexHtml).toContain('<meta property="og:title" content="Easy Queue" />');
    expect(indexHtml).toContain(
      '<meta property="og:description" content="A simple event queue with live position updates." />',
    );
    expect(screen.getByLabelText('Event ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.queryByRole('link', { name: 'Event Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Business name')).not.toBeInTheDocument();
  });

  it('ships an installable Easy Queue manifest', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({
      name: 'Easy Queue',
      short_name: 'Easy Queue',
      description: 'A simple event queue with live position updates.',
      start_url: '/',
      display: 'standalone',
      background_color: '#fffaf5',
      theme_color: '#ea641e',
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/favicon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/favicon-512.png', sizes: '512x512' }),
      ]),
    );
  });

  it('presents the super admin as Event Admin and exposes event management', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        return url.includes('/audit')
          ? json({ events: [] })
          : json({
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
            });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/super-admin/queues']}>
        <SuperAdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute(
      'href',
      '/super-admin/queues',
    );
    expect(screen.getByRole('button', { name: 'Create event' })).toBeInTheDocument();
    expect(screen.getByText('Event Admin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(screen.getByLabelText('Staff password')).toBeRequired();
    expect(screen.getByLabelText('Staff password')).toHaveAttribute('type', 'password');
  });
});
