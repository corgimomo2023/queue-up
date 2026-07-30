import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, apiRequest, customerTicketStore } from '../api/client';
import { Card, ErrorMessage, Shell } from '../components/Shell';
import { EventBrand, LifecycleStatus } from '../components/EventBrand';
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
  const { t } = useAppI18n();
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [ticket, setTicket] = useState<TicketStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(async () => {
    try {
      setQueue(await apiRequest<QueueInfo>(`/api/queues/${queueId}`));
    } catch (requestError) {
      setError(requestErrorKey(requestError, 'errors.queueNotFound'));
    }
  }, [queueId]);

  const refreshTicket = useCallback(async () => {
    const saved = customerTicketStore.load(queueId);
    if (!saved) return;
    try {
      const status = await apiRequest<TicketStatus>(
        `/api/queues/${queueId}/status?token=${encodeURIComponent(saved.leaveToken)}`,
      );
      setTicket(status);
      setError('');
      setQueue(current => (current ? { ...current, waitingCount: status.waitingCount } : current));
    } catch (requestError) {
      if (shouldDiscardTicket(requestError)) {
        customerTicketStore.remove(queueId);
        setTicket(null);
        return;
      }
      setError('errors.ticketRefreshFailed');
    }
  }, [queueId]);

  useEffect(() => {
    void loadQueue();
    void refreshTicket();
    const timer = setInterval(() => void loadQueue(), 5000);
    return () => clearInterval(timer);
  }, [loadQueue, refreshTicket]);

  useEffect(() => {
    const saved = customerTicketStore.load(queueId);
    if (!saved) return;
    const source = new EventSource(
      `/api/queues/${queueId}/events?token=${encodeURIComponent(saved.leaveToken)}`,
    );
    source.addEventListener('update', () => void refreshTicket());
    source.addEventListener('status', () => void refreshTicket());
    source.addEventListener('queue.called', () => {
      setTicket(current =>
        current
          ? { ...current, status: 'served', position: 0, peopleAhead: 0, isNext: false }
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
      setQueue(null);
      setTicket(null);
      setError('errors.eventNotFound');
      customerTicketStore.remove(queueId);
    });
    const timer = setInterval(() => void refreshTicket(), 5000);
    return () => {
      source.close();
      clearInterval(timer);
    };
  }, [queueId, ticket?.customerId, refreshTicket, loadQueue]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const joined = await apiRequest<TicketStatus & { leaveToken: string }>(
        `/api/queues/${queueId}/join`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: form.get('name'),
            phone: form.get('phone'),
            message: form.get('message'),
          }),
        },
      );
      customerTicketStore.save(queueId, {
        customerId: joined.customerId,
        leaveToken: joined.leaveToken,
      });
      setTicket(joined);
      setQueue(current => (current ? { ...current, waitingCount: joined.waitingCount } : current));
    } catch (requestError) {
      setError(requestErrorKey(requestError, 'errors.joinFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    const saved = customerTicketStore.load(queueId);
    if (!saved) return;
    setBusy(true);
    try {
      await apiRequest(`/api/queues/${queueId}/customers/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${saved.leaveToken}` },
      });
      customerTicketStore.remove(queueId);
      setTicket(null);
      await loadQueue();
    } catch (requestError) {
      setError(requestErrorKey(requestError, 'errors.leaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const hasSavedTicket = Boolean(customerTicketStore.load(queueId));

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
        </div>

        {ticket ? (
          <Card className="ticket-card">
            <p className="eyebrow">{t('customer.position')}</p>
            <div className="ticket-number">
              {ticket.status === 'served' ? t('customer.now') : ticket.position}
            </div>
            <h2>
              {ticket.status === 'served'
                ? t('customer.yourTurn')
                : ticket.isNext
                  ? t('customer.next')
                  : t('customer.inLine')}
            </h2>
            {ticket.status === 'served' && (
              <div className="alert" role="status">
                <strong>{t('customer.called')}</strong>
              </div>
            )}

            {ticket.status === 'waiting' && (
              <>
                <div className="queue-stats" aria-label={t('customer.statsLabel')}>
                  <div className="queue-stat">
                    <span>{t('customer.peopleAhead')}</span>
                    <strong>{ticket.peopleAhead}</strong>
                  </div>
                  <div className="queue-stat">
                    <span>{t('customer.totalWaiting')}</span>
                    <strong>{ticket.waitingCount}</strong>
                  </div>
                </div>
                <p className="muted ticket-id">{t('customer.ticket', { id: ticket.customerId })}</p>
                <p className="muted live-note">{t('customer.keepOpen')}</p>
              </>
            )}

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
