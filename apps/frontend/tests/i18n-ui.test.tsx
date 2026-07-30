import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import enUS from '../src/i18n/en-US';
import zhHK from '../src/i18n/zh-HK';

function translationKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    translationKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('Easy Queue internationalization', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.lang = '';
    vi.restoreAllMocks();
  });

  it('migrates the saved Taiwan locale code to Hong Kong Chinese', () => {
    localStorage.setItem('nextq-locale', 'zh-TW');
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '工作人員登入' })).toBeInTheDocument();
    expect(screen.getByLabelText('活動編號')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh-HK');
    expect(localStorage.getItem('nextq-locale')).toBe('zh-HK');
  });

  it('switches between both supported locales and persists the choice', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(screen.getByRole('heading', { name: '工作人員登入' })).toBeInTheDocument();
    expect(localStorage.getItem('nextq-locale')).toBe('zh-HK');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Open staff dashboard' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');

    fireEvent.click(screen.getByRole('button', { name: '繁體中文' }));
    expect(screen.getByRole('alert')).toHaveTextContent('沒有權限');
    expect(screen.queryByText('home.accessDenied')).not.toBeInTheDocument();
  });

  it('keeps the Hong Kong Chinese dictionary free of Taiwan and internal UI wording', () => {
    const copy = readFileSync('src/i18n/zh-HK.ts', 'utf8');
    const disallowed = [
      '工作人員管理員',
      '供應商管理員',
      '稽核',
      '排程',
      '檢視',
      '金鑰',
      '重新整理',
      '存取',
      '還原',
      '訊息',
      '身分',
      '控制台',
      '健康狀態',
      '唯增',
      '路由',
      '使用者',
      '密鑰',
    ];

    for (const term of disallowed) expect(copy, `disallowed wording: ${term}`).not.toContain(term);
  });

  it('uses the Easy Queue brand in both locale resources', () => {
    const english = readFileSync('src/i18n/en-US.ts', 'utf8');
    const chinese = readFileSync('src/i18n/zh-HK.ts', 'utf8');
    expect(english).toContain('Easy Queue');
    expect(chinese).toContain('Easy Queue');
    expect(english).not.toContain('NextQ');
    expect(chinese).not.toContain('NextQ');
  });

  it('keeps English and Hong Kong Chinese translation keys in sync', () => {
    expect(translationKeys(zhHK).sort()).toEqual(translationKeys(enUS).sort());
  });
});
