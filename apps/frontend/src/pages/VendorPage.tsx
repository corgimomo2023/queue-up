import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router';
import { ApiError, apiRequest } from '../api/client';
import { queueApi, vendorApi } from '../api/resources';
import { Card, ErrorMessage, Shell } from '../components/Shell';
import { EventBrand, LifecycleStatus } from '../components/EventBrand';
import { useAppI18n } from '../i18n/context';
import { appQueryClient, queryKeys } from '../query/client';

interface VendorAction {
  path: string;
  method: 'POST' | 'DELETE';
}

export function VendorPage() {
  const { queueId = '' } = useParams();
  const { t, locale } = useAppI18n();
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');
  const [forceLogin, setForceLogin] = useState(false);
  const activeQueueIdRef = useRef(queueId);
  activeQueueIdRef.current = queueId;

  const queueQuery = useQuery(
    {
      queryKey: queryKeys.queue(queueId),
      queryFn: ({ signal }) => queueApi.get(queueId, signal),
      enabled: Boolean(queueId),
    },
    appQueryClient,
  );
  const queue = queueQuery.data ?? null;
  const dashboardQuery = useQuery(
    {
      queryKey: queryKeys.vendor(queueId),
      queryFn: ({ signal }) => vendorApi.dashboard(queueId, signal),
      enabled: Boolean(queueId) && !forceLogin,
      refetchInterval: queue?.lifecycleStatus === 'active' ? 3_000 : false,
    },
    appQueryClient,
  );
  const receivedUnauthorized =
    dashboardQuery.error instanceof ApiError && dashboardQuery.error.status === 401;
  const needsLogin = forceLogin || receivedUnauthorized;
  const dashboard = needsLogin ? null : (dashboardQuery.data ?? null);
  const customerUrl = dashboard?.customerUrl;

  const refreshQueueData = () =>
    Promise.all([
      appQueryClient.invalidateQueries({ queryKey: queryKeys.queue(queueId) }),
      appQueryClient.invalidateQueries({ queryKey: queryKeys.vendor(queueId) }),
    ]);

  const unlockMutation = useMutation(
    {
      mutationFn: (credential: FormDataEntryValue | null) =>
        apiRequest(`/api/queues/${queueId}/unlock`, {
          method: 'POST',
          body: JSON.stringify({ credential }),
        }),
    },
    appQueryClient,
  );
  const actionMutation = useMutation(
    {
      mutationFn: ({ path, method }: VendorAction) => apiRequest(path, { method }),
      onSuccess: refreshQueueData,
    },
    appQueryClient,
  );
  const logoutMutation = useMutation(
    {
      mutationFn: () =>
        apiRequest(`/api/vendor/${queueId}/logout`, {
          method: 'POST',
        }),
    },
    appQueryClient,
  );
  const busy = unlockMutation.isPending || actionMutation.isPending || logoutMutation.isPending;

  useEffect(() => {
    setError('');
    setQr('');
    setForceLogin(false);
  }, [queueId]);

  useEffect(() => {
    if (receivedUnauthorized) setForceLogin(true);
  }, [receivedUnauthorized]);

  useEffect(() => {
    setQr('');
    if (!customerUrl) return;
    let active = true;
    void QRCode.toDataURL(`${location.origin}${customerUrl}`, { width: 420, margin: 2 }).then(
      value => {
        if (active) setQr(value);
      },
    );
    return () => {
      active = false;
    };
  }, [customerUrl]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestQueueId = queueId;
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await unlockMutation.mutateAsync(form.get('credential'));
      if (activeQueueIdRef.current !== requestQueueId) return;
      setForceLogin(false);
      await Promise.all([queueQuery.refetch(), dashboardQuery.refetch()]);
    } catch {
      if (activeQueueIdRef.current !== requestQueueId) return;
      setError('errors.accessDenied');
    }
  }

  async function action(path: string, method: VendorAction['method']) {
    const requestQueueId = queueId;
    setError('');
    try {
      await actionMutation.mutateAsync({ path, method });
      return true;
    } catch (cause) {
      if (activeQueueIdRef.current !== requestQueueId) return false;
      if (cause instanceof ApiError && cause.status === 401) {
        setForceLogin(true);
        appQueryClient.removeQueries({ queryKey: queryKeys.vendor(queueId) });
      }
      setError('errors.actionFailed');
      return false;
    }
  }

  async function logout() {
    const requestQueueId = queueId;
    setError('');
    setForceLogin(true);
    try {
      await logoutMutation.mutateAsync();
      await appQueryClient.cancelQueries({ queryKey: queryKeys.vendor(requestQueueId) });
      appQueryClient.removeQueries({ queryKey: queryKeys.vendor(requestQueueId) });
    } catch {
      if (activeQueueIdRef.current !== requestQueueId) return;
      setForceLogin(false);
      setError('errors.actionFailed');
    }
  }

  const loadError = queueQuery.isError
    ? 'errors.queueNotFound'
    : dashboardQuery.isError && !receivedUnauthorized
      ? 'errors.loadDashboard'
      : '';
  const visibleError = error || loadError;

  if (queueQuery.isPending)
    return (
      <Shell>
        <div className="narrow">
          <Card>
            <p>{t('staff.loading')}</p>
          </Card>
        </div>
      </Shell>
    );
  if (!queue)
    return (
      <Shell>
        <div className="narrow">
          <Card>
            <ErrorMessage message={visibleError ? t(visibleError) : ''} />
          </Card>
        </div>
      </Shell>
    );
  if (queue.lifecycleStatus !== 'active')
    return (
      <Shell>
        <div className="narrow">
          <Card className="lifecycle-card">
            <LifecycleStatus event={queue} audience="staff" />
            <Link className="button ghost" to="/">
              {t('staff.backLogin')}
            </Link>
          </Card>
        </div>
      </Shell>
    );
  if (needsLogin)
    return (
      <Shell>
        <div className="narrow">
          <Card>
            <div className="lock-mark">EQ</div>
            <p className="eyebrow">{t('staff.protectedEvent')}</p>
            <h1>{t('staff.access')}</h1>
            <p className="muted">{t('staff.passwordHint')}</p>
            <form className="form-stack" onSubmit={unlock}>
              <label>
                {t('common.password')}
                <input name="credential" type="password" autoComplete="current-password" required />
              </label>
              <ErrorMessage message={visibleError ? t(visibleError) : ''} />
              <button className="button primary" disabled={busy}>
                {busy ? t('common.checking') : t('staff.unlock')}
              </button>
              <Link className="button ghost" to="/">
                {t('staff.anotherEvent')}
              </Link>
            </form>
          </Card>
        </div>
      </Shell>
    );
  if (!dashboard)
    return (
      <Shell>
        <div className="narrow">
          <Card>
            <p>{t('staff.loading')}</p>
            <ErrorMessage message={visibleError ? t(visibleError) : ''} />
          </Card>
        </div>
      </Shell>
    );

  const joinUrl = `${location.origin}${dashboard.customerUrl}`;
  return (
    <Shell
      actions={
        <button className="button small ghost" onClick={() => void logout()}>
          {t('common.logOut')}
        </button>
      }
    >
      <section className="dashboard-head">
        <div>
          <EventBrand event={dashboard} eyebrow={t('staff.dashboard')} />
          <p className="muted">
            {t('staff.waitingCount', {
              count: dashboard.waitingCount,
              unit: t(dashboard.waitingCount === 1 ? 'common.person' : 'common.people'),
            })}
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy || !dashboard.waitingCount}
          onClick={() => void action(`/api/vendor/${queueId}/serve-next`, 'POST')}
        >
          {t('staff.callNext')}
        </button>
      </section>
      <ErrorMessage message={visibleError ? t(visibleError) : ''} />
      <div className="dashboard-grid">
        <Card className="qr-card">
          <h2>{t('staff.publicAccess')}</h2>
          <p className="muted">{t('staff.publicHint')}</p>
          {qr && <img src={qr} alt={t('staff.qrAlt')} />}
          <div className="stack">
            <strong>{t('staff.publicUrl')}</strong>
            <code>{joinUrl}</code>
            <button
              className="button secondary"
              onClick={() => navigator.clipboard.writeText(joinUrl)}
            >
              {t('staff.copyUrl')}
            </button>
            {qr && (
              <a className="button ghost" href={qr} download={`${dashboard.name}-queue-qr.png`}>
                {t('staff.downloadQr')}
              </a>
            )}
            <Link className="text-link" to={dashboard.customerUrl}>
              {t('staff.previewCustomer')}
            </Link>
          </div>
        </Card>
        <Card className="queue-card">
          <div className="section-heading row">
            <div>
              <h2>{t('staff.currentQueue')}</h2>
              <p className="muted">{t('staff.fifo')}</p>
            </div>
            {dashboard.customers.length > 0 && (
              <button
                className="button small danger"
                disabled={busy}
                onClick={() =>
                  confirm(t('staff.clearConfirm')) &&
                  void action(`/api/vendor/${queueId}/customers`, 'DELETE')
                }
              >
                {t('staff.clearAll')}
              </button>
            )}
          </div>
          {dashboard.customers.length === 0 ? (
            <div className="empty">
              <strong>{t('staff.empty')}</strong>
              <p>{t('staff.emptyHint')}</p>
            </div>
          ) : (
            <ol className="customer-list">
              {dashboard.customers.map((customer, index) => (
                <li key={customer.customerId}>
                  <span className="position">{index + 1}</span>
                  <div className="customer-info">
                    <strong>{customer.name}</strong>
                    <span>
                      {new Date(customer.joinedAt).toLocaleTimeString(locale, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {customer.phone ? ` · ${customer.phone}` : ''}
                    </span>
                    {customer.message && <p>{customer.message}</p>}
                  </div>
                  <button
                    className="button small ghost"
                    disabled={busy}
                    onClick={() =>
                      confirm(t('staff.removeConfirm', { name: customer.name })) &&
                      void action(
                        `/api/vendor/${queueId}/customers/${customer.customerId}`,
                        'DELETE',
                      )
                    }
                  >
                    {t('staff.remove')}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </Shell>
  );
}
