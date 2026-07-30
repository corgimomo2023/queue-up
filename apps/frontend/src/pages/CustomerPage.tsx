import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, apiRequest, customerTicketStore } from '../api/client';
import { Card, ErrorMessage, Shell } from '../components/Shell';
import { EventBrand, LifecycleStatus } from '../components/EventBrand';
import { CustomerNotifications } from '../components/CustomerNotifications';
import { reconcileTicketStatus } from '../ticket-reconciliation';
import type { QueueInfo, TicketStatus } from '../types';
import { useAppI18n } from '../i18n/context';

function requestErrorKey(error: unknown, fallback: string) {
  return error instanceof ApiError && error.status === 429 ? 'errors.rateLimited' : fallback;
}

function shouldDiscardTicket(error: unknown) {
  return error instanceof ApiError && [401, 404, 410].includes(error.status);
}

export function CustomerPage() {
  const { queueId = '' } = useParams();
  const activeQueueIdRef = useRef(queueId);
  activeQueueIdRef.current = queueId;
  const { t } = useAppI18n();
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [ticket, setTicket] = useState<TicketStatus | null>(null);
  const [ticketQueueId, setTicketQueueId] = useState(queueId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectionState, setConnectionState] = useState<
    'idle' | 'connecting' | 'connected' | 'reconnecting'
  >('idle');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine !== false);
  const [isVisible, setIsVisible] = useState(() => document.visibilityState !== 'hidden');
  const [ticketConnectionVersion, setTicketConnectionVersion] = useState(0);

  const loadQueue = useCallback(async () => {
    const requestedQueueId = queueId;
    try {
      const nextQueue = await apiRequest<QueueInfo>(`/api/queues/${requestedQueueId}`);
      if (activeQueueIdRef.current !== requestedQueueId) return;
      setQueue(nextQueue);
    } catch (requestError) {
      if (activeQueueIdRef.current !== requestedQueueId) return;
      setError(requestErrorKey(requestError, 'errors.queueNotFound'));
    }
  }, [queueId]);

  const refreshTicket = useCallback(async () => {
    const requestedQueueId = queueId;
    const saved = customerTicketStore.load(requestedQueueId);
    if (!saved) return;
    const ticketIsCurrent = () => {
      const current = customerTicketStore.load(requestedQueueId);
      return (
        activeQueueIdRef.current === requestedQueueId &&
        current?.customerId === saved.customerId &&
        current.leaveToken === saved.leaveToken
      );
    };
    try {
      const status = await apiRequest<TicketStatus>(
        `/api/queues/${requestedQueueId}/status?token=${encodeURIComponent(saved.leaveToken)}`,
      );
      if (!ticketIsCurrent()) return;
      setTicketQueueId(requestedQueueId);
      setTicket(current => reconcileTicketStatus(current, status));
      setError('');
      setQueue(current => (current ? { ...current, waitingCount: status.waitingCount } : current));
    } catch (requestError) {
      if (!ticketIsCurrent()) return;
      if (shouldDiscardTicket(requestError)) {
        customerTicketStore.remove(requestedQueueId);
        setTicket(null);
        setTicketConnectionVersion(version => version + 1);
        return;
      }
      setError('errors.ticketRefreshFailed');
    }
  }, [queueId]);

  useEffect(() => {
    setQueue(null);
    setTicket(null);
    setTicketQueueId(queueId);
    setError('');
    setConnectionState('idle');
  }, [queueId]);

  useEffect(() => {
    void loadQueue();
    void refreshTicket();
    const timer = setInterval(() => void loadQueue(), 5000);
    return () => clearInterval(timer);
  }, [loadQueue, refreshTicket]);

  useEffect(() => {
    const updateOnlineStatus = () => {
      const online = navigator.onLine !== false;
      setIsOnline(online);
      if (online) {
        void loadQueue();
        void refreshTicket();
      }
    };
    const updateVisibility = () => {
      const visible = document.visibilityState !== 'hidden';
      setIsVisible(visible);
      if (visible) {
        void loadQueue();
        void refreshTicket();
      }
    };
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, [loadQueue, refreshTicket]);

  useEffect(() => {
    const saved = customerTicketStore.load(queueId);
    if (!saved) {
      setConnectionState('idle');
      return;
    }
    setConnectionState('connecting');
    const source = new EventSource(
      `/api/queues/${queueId}/events?token=${encodeURIComponent(saved.leaveToken)}`,
    );
    source.addEventListener('open', () => {
      if (activeQueueIdRef.current === queueId) setConnectionState('connected');
    });
    source.addEventListener('error', () => {
      if (activeQueueIdRef.current !== queueId) return;
      setConnectionState('reconnecting');
      void refreshTicket();
    });
    source.addEventListener('update', () => void refreshTicket());
    source.addEventListener('status', () => void refreshTicket());
    source.addEventListener('queue.called', event => {
      if (activeQueueIdRef.current !== queueId) return;
      let payload: { calledAt?: string; expiresAt?: string } = {};
      if (event instanceof MessageEvent) {
        try {
          payload = JSON.parse(event.data) as typeof payload;
        } catch {
          payload = {};
        }
      }
      setTicketQueueId(queueId);
      setTicket(current =>
        current
          ? {
              ...current,
              status: 'served',
              position: 0,
              peopleAhead: 0,
              isNext: false,
              calledAt: typeof payload.calledAt === 'string' ? payload.calledAt : current.calledAt,
              expiresAt:
                typeof payload.expiresAt === 'string' ? payload.expiresAt : current.expiresAt,
            }
          : current,
      );
      void refreshTicket();
      source.close();
    });
    source.addEventListener('queue_ended', () => {
      source.close();
      void loadQueue();
    });
    source.addEventListener('queue_archived', () => {
      source.close();
      if (activeQueueIdRef.current !== queueId) return;
      setQueue(null);
      setTicket(null);
      setError('errors.eventNotFound');
      customerTicketStore.remove(queueId);
      setTicketConnectionVersion(version => version + 1);
    });
    const timer = setInterval(() => void refreshTicket(), 5000);
    return () => {
      source.close();
      clearInterval(timer);
    };
  }, [queueId, ticketConnectionVersion, refreshTicket, loadQueue]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestedQueueId = queueId;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const joined = await apiRequest<TicketStatus & { leaveToken: string }>(
        `/api/queues/${requestedQueueId}/join`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: form.get('name'),
            phone: form.get('phone'),
            message: form.get('message'),
          }),
        },
      );
      customerTicketStore.save(requestedQueueId, {
        customerId: joined.customerId,
        leaveToken: joined.leaveToken,
      });
      if (activeQueueIdRef.current !== requestedQueueId) return;
      setTicketQueueId(requestedQueueId);
      setTicketConnectionVersion(version => version + 1);
      setTicket(joined);
      setQueue(current => (current ? { ...current, waitingCount: joined.waitingCount } : current));
    } catch (requestError) {
      if (activeQueueIdRef.current !== requestedQueueId) return;
      setError(requestErrorKey(requestError, 'errors.joinFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    const requestedQueueId = queueId;
    const saved = customerTicketStore.load(requestedQueueId);
    if (!saved) return;
    setBusy(true);
    try {
      await apiRequest(`/api/queues/${requestedQueueId}/customers/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${saved.leaveToken}` },
      });
      customerTicketStore.remove(requestedQueueId);
      if (activeQueueIdRef.current !== requestedQueueId) return;
      setTicketConnectionVersion(version => version + 1);
      setTicket(null);
      await loadQueue();
    } catch (requestError) {
      if (activeQueueIdRef.current !== requestedQueueId) return;
      setError(requestErrorKey(requestError, 'errors.leaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const hasSavedTicket = Boolean(customerTicketStore.load(queueId));
  const currentTicket = ticketQueueId === queueId ? ticket : null;
  const connectionMessage = !isOnline
    ? 'customer.offline'
    : !isVisible
      ? 'customer.background'
      : connectionState === 'reconnecting'
        ? 'customer.reconnecting'
        : connectionState === 'connected'
          ? 'customer.connected'
          : 'customer.connecting';

  if (!queue) {
    return (
      <Shell>
        <div className="narrow">
          <Card>
            <p>{t('customer.loading')}</p>
            <ErrorMessage message={error ? t(error) : ''} />
          </Card>
        </div>
      </Shell>
    );
  }

  if (queue.lifecycleStatus === 'scheduled') {
    return (
      <Shell>
        <div className="narrow">
          <Card className="lifecycle-card">
            <LifecycleStatus event={queue} audience="customer" />
          </Card>
        </div>
      </Shell>
    );
  }

  if (queue.lifecycleStatus === 'ended') {
    return (
      <Shell>
        <div className="narrow">
          <Card className="lifecycle-card">
            <LifecycleStatus event={queue} audience="customer" />
          </Card>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="customer-wrap">
        <div className="queue-title">
          <EventBrand event={queue} eyebrow={t('customer.queue')} />
          <p className="muted">{t('customer.liveUpdates')}</p>
          {hasSavedTicket && (
            <p
              className={`connection-status ${!isOnline || connectionState === 'reconnecting' ? 'warning' : ''}`}
              aria-live="polite"
            >
              {t(connectionMessage)}
            </p>
          )}
        </div>

        {currentTicket ? (
          <Card className="ticket-card">
            <p className="eyebrow">{t('customer.position')}</p>
            <div className="ticket-number">
              {currentTicket.status === 'served' ? t('customer.now') : currentTicket.position}
            </div>
            <h2>
              {currentTicket.status === 'served'
                ? t('customer.yourTurn')
                : currentTicket.isNext
                  ? t('customer.next')
                  : t('customer.inLine')}
            </h2>
            {currentTicket.status === 'served' && (
              <div className="alert" role="status">
                <strong>{t('customer.called')}</strong>
              </div>
            )}

            {currentTicket.status === 'waiting' && (
              <>
                <div className="queue-stats" aria-label={t('customer.statsLabel')}>
                  <div className="queue-stat">
                    <span>{t('customer.peopleAhead')}</span>
                    <strong>{currentTicket.peopleAhead}</strong>
                  </div>
                  <div className="queue-stat">
                    <span>{t('customer.totalWaiting')}</span>
                    <strong>{currentTicket.waitingCount}</strong>
                  </div>
                </div>
                <p className="muted ticket-id">
                  {t('customer.ticket', { id: currentTicket.customerId })}
                </p>
                <p className="muted live-note">{t('customer.keepOpen')}</p>
              </>
            )}

            <CustomerNotifications key={queueId} queueId={queueId} ticket={currentTicket} />
            <ErrorMessage message={error ? t(error) : ''} />
            <button
              className="button danger"
              disabled={busy}
              onClick={() => confirm(t('customer.leaveConfirm')) && void leave()}
            >
              {t('customer.leave')}
            </button>
          </Card>
        ) : hasSavedTicket ? (
          <Card className="ticket-card">
            <p className="eyebrow">{t('customer.position')}</p>
            <h2>{t('customer.recoveringTicket')}</h2>
            <ErrorMessage message={error ? t(error) : ''} />
          </Card>
        ) : (
          <Card>
            <div className="section-heading">
              <p className="eyebrow">{t('customer.join')}</p>
              <h2>
                {queue.waitingCount
                  ? t('customer.waitingNow', {
                      count: queue.waitingCount,
                      unit: t(queue.waitingCount === 1 ? 'common.person' : 'common.people'),
                    })
                  : t('customer.first')}
              </h2>
              <p className="muted">{t('customer.joinHint')}</p>
            </div>
            <form className="form-stack" onSubmit={join}>
              <label>
                {t('customer.name')}
                <input
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="name"
                  placeholder={t('customer.namePlaceholder')}
                />
              </label>
              <label>
                {t('customer.phone')} <span className="optional">{t('common.optional')}</span>
                <input name="phone" type="tel" placeholder={t('customer.phonePlaceholder')} />
              </label>
              <label>
                {t('customer.message')} <span className="optional">{t('common.optional')}</span>
                <textarea
                  name="message"
                  maxLength={200}
                  rows={4}
                  placeholder={t('customer.messagePlaceholder')}
                />
              </label>
              <ErrorMessage message={error ? t(error) : ''} />
              <button className="button primary" disabled={busy}>
                {busy ? t('customer.joining') : t('customer.joinButton')}
              </button>
            </form>
          </Card>
        )}
      </div>
    </Shell>
  );
}
