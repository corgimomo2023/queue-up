import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

describe('NextQ internationalization', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.lang = '';
    vi.restoreAllMocks();
  });

  it('loads the saved Traditional Chinese locale and keeps database data untouched', () => {
    localStorage.setItem('nextq-locale', 'zh-TW');
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '工作人員管理員登入' })).toBeInTheDocument();
    expect(screen.getByLabelText('活動 ID')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh-TW');
  });

  it('switches between both supported locales and persists the choice', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Staff Admin login' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(screen.getByRole('heading', { name: '工作人員管理員登入' })).toBeInTheDocument();
    expect(localStorage.getItem('nextq-locale')).toBe('zh-TW');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Staff Admin login' })).toBeInTheDocument();
    expect(localStorage.getItem('nextq-locale')).toBe('en-US');
  });

  it('localizes login errors and re-renders them when the locale changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'denied' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Event ID'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open event dashboard' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');

    fireEvent.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(screen.getByRole('alert')).toHaveTextContent('存取被拒');
    expect(screen.queryByText('home.accessDenied')).not.toBeInTheDocument();
  });
});
