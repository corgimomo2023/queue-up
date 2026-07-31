import type { ComponentPropsWithoutRef, PropsWithChildren, ReactNode } from 'react';
import { Link } from 'react-router';
import { LocaleSwitch } from './LocaleSwitch';
import { useAppI18n } from '../i18n/context';

export function Shell({ children, actions }: PropsWithChildren<{ actions?: ReactNode }>) {
  const { t } = useAppI18n();
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-mark">EQ</span>Easy Queue
        </Link>
        <div className="topbar-actions">
          <LocaleSwitch />
          {actions}
        </div>
      </header>
      <main>{children}</main>
      <footer>{t('shell.footer')}</footer>
    </div>
  );
}

export function Card({
  children,
  className = '',
  ...props
}: PropsWithChildren<ComponentPropsWithoutRef<'section'>>) {
  return (
    <section className={`card ${className}`} {...props}>
      {children}
    </section>
  );
}

export function ErrorMessage({ message }: { message?: string }) {
  return message ? (
    <div className="alert error" role="alert">
      {message}
    </div>
  ) : null;
}
