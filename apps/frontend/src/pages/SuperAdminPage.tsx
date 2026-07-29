import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { apiRequest } from '../api/client';
import { Card, ErrorMessage, Shell } from '../components/Shell';
import { AdminShell } from '../features/admin/AdminShell';
import { AuditModule } from '../features/admin/modules/AuditModule';
import { OverviewModule } from '../features/admin/modules/OverviewModule';
import { QueuesModule } from '../features/admin/modules/QueuesModule';
import { SystemModule } from '../features/admin/modules/SystemModule';
import type { AuditEvent, AuditResponse, SuperAdminOverview } from '../types';
import { useAppI18n } from '../i18n/context';

export function SuperAdminPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useAppI18n();
  const [authState, setAuthState] = useState<'checking' | 'login' | 'ready'>('checking');
  const [overview, setOverview] = useState<SuperAdminOverview | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const [nextOverview, nextAudit] = await Promise.all([
        apiRequest<SuperAdminOverview>('/api/super-admin/overview'),
        apiRequest<AuditResponse>('/api/super-admin/audit?limit=100'),
      ]);
      setOverview(nextOverview);
      setAudit(nextAudit.events);
      setAuthState('ready');
      setError('');
    } catch (cause) {
      const requiresLogin = cause instanceof Error && cause.message.includes('authentication');
      if (requiresLogin) setAuthState('login');
      else setError('errors.loadAdmin');
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest('/api/super-admin/login', {
        method: 'POST',
        body: JSON.stringify({ key: form.get('key') }),
      });
      await loadDashboard();
      navigate('/super-admin/overview', { replace: true });
    } catch {
      setError('errors.accessDenied');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await apiRequest('/api/super-admin/logout', { method: 'POST' });
    setOverview(null);
    setAudit([]);
    setAuthState('login');
  }

  if (authState === 'checking')
    return (
      <Shell>
        <div className="narrow">
          <Card>
            <p>{t('superAdmin.checking')}</p>
          </Card>
        </div>
      </Shell>
    );
  if (authState === 'login')
    return (
      <Shell>
        <div className="narrow">
          <Card className="admin-login">
            <div className="lock-mark">N</div>
            <p className="eyebrow">{t('superAdmin.restricted')}</p>
            <h1>{t('superAdmin.title')}</h1>
            <p className="muted">{t('superAdmin.intro')}</p>
            <form className="form-stack" onSubmit={login}>
              <label>
                {t('superAdmin.key')}
                <input name="key" type="password" autoComplete="current-password" required />
              </label>
              <ErrorMessage message={error ? t(error) : ''} />
              <button className="button primary" disabled={busy}>
                {busy ? t('common.checking') : t('superAdmin.open')}
              </button>
            </form>
          </Card>
        </div>
      </Shell>
    );
  if (!overview)
    return (
      <Shell>
        <div className="narrow">
          <Card>
            <ErrorMessage message={error ? t(error) : t('errors.loadAdminData')} />
          </Card>
        </div>
      </Shell>
    );
  if (location.pathname === '/super-admin' || location.pathname === '/super-admin/')
    return <Navigate to="/super-admin/overview" replace />;

  const module = location.pathname.split('/')[2];
  return (
    <AdminShell busy={busy} onRefresh={() => void loadDashboard()} onLogout={() => void logout()}>
      <ErrorMessage message={error ? t(error) : ''} />
      {module === 'overview' && <OverviewModule overview={overview} audit={audit} />}
      {module === 'audit' && <AuditModule events={audit} overview={overview} />}
      {module === 'queues' && <QueuesModule overview={overview} />}
      {module === 'system' && <SystemModule overview={overview} />}
    </AdminShell>
  );
}
