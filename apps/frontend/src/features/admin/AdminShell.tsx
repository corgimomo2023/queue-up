import { type ReactNode, useState } from 'react';
import { NavLink } from 'react-router';
import { LocaleSwitch } from '../../components/LocaleSwitch';
import { useAppI18n } from '../../i18n/context';

type AdminShellProps = {
  children: ReactNode;
  busy: boolean;
  onRefresh: () => void;
  onLogout: () => void;
};

const modules = [
  { to: '/super-admin/overview', label: 'adminShell.overview', mark: 'O' },
  { to: '/super-admin/queues', label: 'adminShell.events', mark: 'E' },
  { to: '/super-admin/audit', label: 'adminShell.audit', mark: 'A' },
  { to: '/super-admin/system', label: 'adminShell.system', mark: 'S' },
];

export function AdminShell({ children, busy, onRefresh, onLogout }: AdminShellProps) {
  const [open, setOpen] = useState(false);
  const { t } = useAppI18n();
  return (
    <div className="admin-app-shell">
      <button
        className={`admin-mobile-menu ${open ? 'open' : ''}`}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls="admin-sidebar"
      >
        {open ? t('adminShell.close') : t('adminShell.modules')}
      </button>
      {open && (
        <button
          className="admin-sidebar-backdrop"
          aria-label={t('adminShell.closeModules')}
          onClick={() => setOpen(false)}
        />
      )}
      <aside id="admin-sidebar" className={`admin-sidebar ${open ? 'open' : ''}`}>
        <div className="admin-sidebar-brand">
          <span className="brand-mark">N</span>
          <div>
            <strong>NextQ</strong>
            <small>{t('adminShell.vendorAdmin')}</small>
          </div>
        </div>
        <nav aria-label={t('adminShell.adminModules')} className="admin-module-nav">
          <p>{t('adminShell.workspace')}</p>
          {modules.map(module => (
            <NavLink
              key={module.to}
              to={module.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <span aria-hidden="true">{module.mark}</span>
              {t(module.label)}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-status">
          <span className="status-dot" />
          <div>
            <strong>{t('adminShell.online')}</strong>
            <small>{t('adminShell.operational')}</small>
          </div>
        </div>
        <button className="admin-logout" onClick={onLogout}>
          {t('common.logOut')}
        </button>
      </aside>
      <section className="admin-workspace">
        <header className="admin-workspace-bar">
          <div>
            <span className="status-dot" />
            {t('adminShell.live')}
          </div>
          <div className="topbar-actions">
            <LocaleSwitch />
            <button className="button small ghost" disabled={busy} onClick={onRefresh}>
              {t('adminShell.refresh')}
            </button>
          </div>
        </header>
        <main className="admin-workspace-content">{children}</main>
      </section>
    </div>
  );
}
