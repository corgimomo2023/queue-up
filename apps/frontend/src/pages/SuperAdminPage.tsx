import { type FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError, apiRequest } from '../api/client';
import { adminApi } from '../api/resources';
import { Card, ErrorMessage, Shell } from '../components/Shell';
import { AdminShell } from '../features/admin/AdminShell';
import { AuditModule } from '../features/admin/modules/AuditModule';
import { OverviewModule } from '../features/admin/modules/OverviewModule';
import { QueuesModule } from '../features/admin/modules/QueuesModule';
import { SystemModule } from '../features/admin/modules/SystemModule';
import { useAppI18n } from '../i18n/context';
import { appQueryClient, queryKeys } from '../query/client';

const requiresLogin = (error: unknown) => error instanceof ApiError && error.status === 401;

export function SuperAdminPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useAppI18n();
  const [forceLogin, setForceLogin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const overviewQuery = useQuery(
    {
      queryKey: queryKeys.adminOverview(),
      queryFn: ({ signal }) => adminApi.overview('active', signal),
      enabled: !forceLogin,
    },
    appQueryClient,
  );
  const auditQuery = useQuery(
    {
      queryKey: queryKeys.adminAudit(),
      queryFn: ({ signal }) => adminApi.audit(signal),
      enabled: !forceLogin,
    },
    appQueryClient,
  );
  const overview = overviewQuery.data ?? null;
  const audit = auditQuery.data?.events ?? [];
  const loginRequired =
    forceLogin || requiresLogin(overviewQuery.error) || requiresLogin(auditQuery.error);
  const checking = !loginRequired && (overviewQuery.isPending || auditQuery.isPending);
  const loadError =
    !loginRequired && (overviewQuery.isError || auditQuery.isError) ? 'errors.loadAdmin' : '';

  const loadDashboard = () =>
    Promise.all([
      appQueryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() }),
      appQueryClient.invalidateQueries({ queryKey: queryKeys.adminAudit() }),
    ]);

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
      setForceLogin(false);
      await loadDashboard();
      navigate('/super-admin/overview', { replace: true });
    } catch {
      setError('errors.accessDenied');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/api/super-admin/logout', { method: 'POST' });
      appQueryClient.removeQueries({ queryKey: ['admin'] });
      setForceLogin(true);
    } catch {
      setError('errors.actionFailed');
    } finally {
      setBusy(false);
    }
  }

  if (checking)
    return (
      <Shell>
        <div className="narrow">
          <Card>
            <p>{t('superAdmin.checking')}</p>
          </Card>
        </div>
      </Shell>
    );
  if (loginRequired)
    return (
      <Shell>
        <div className="narrow">
          <Card className="admin-login">
            <div className="lock-mark">EQ</div>
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
            <ErrorMessage message={t(error || loadError || 'errors.loadAdminData')} />
          </Card>
        </div>
      </Shell>
    );
  if (location.pathname === '/super-admin' || location.pathname === '/super-admin/')
    return <Navigate to="/super-admin/overview" replace />;

  const module = location.pathname.split('/')[2];
  return (
    <AdminShell busy={busy} onRefresh={() => void loadDashboard()} onLogout={() => void logout()}>
      <ErrorMessage message={error || loadError ? t(error || loadError) : ''} />
      {module === 'overview' && <OverviewModule overview={overview} audit={audit} />}
      {module === 'audit' && <AuditModule events={audit} overview={overview} />}
      {module === 'queues' && <QueuesModule overview={overview} />}
      {module === 'system' && <SystemModule overview={overview} />}
    </AdminShell>
  );
}
