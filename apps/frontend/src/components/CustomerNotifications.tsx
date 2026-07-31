import { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '../i18n/context';
import type { TicketStatus } from '../types';
import {
  deliverForegroundNotification,
  enableForegroundNotifications,
  notificationPreferenceStore,
} from '../notification-preferences';

interface CustomerNotificationsProps {
  queueId: string;
  ticket: TicketStatus;
}

export function CustomerNotifications({ queueId, ticket }: CustomerNotificationsProps) {
  const { t } = useAppI18n();
  const [enabled, setEnabled] = useState(() => notificationPreferenceStore.load(queueId));
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported' | null>(null);
  const [testActive, setTestActive] = useState(false);
  const [now, setNow] = useState(Date.now());
  const deliveredCall = useRef<string | null>(null);
  const testTimer = useRef<number | null>(null);
  const callKey =
    ticket.status === 'served' ? (ticket.calledAt ?? `ticket-${ticket.customerId}`) : null;
  const expiresAt = ticket.expiresAt ? Date.parse(ticket.expiresAt) : Number.NaN;
  const callIsActive = Boolean(callKey && Number.isFinite(expiresAt) && expiresAt > now);

  useEffect(() => {
    if (!callKey || !Number.isFinite(expiresAt)) return;
    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      setNow(Date.now());
      return;
    }
    setNow(Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [callKey, expiresAt]);

  useEffect(() => {
    if (!enabled || !callIsActive || !callKey || deliveredCall.current === callKey) return;
    deliveredCall.current = callKey;
    void deliverForegroundNotification(t('customer.yourTurn'), t('customer.called'));
  }, [callIsActive, callKey, enabled, t]);

  useEffect(
    () => () => {
      if (testTimer.current !== null) window.clearTimeout(testTimer.current);
    },
    [],
  );

  async function enable() {
    setPermission(await enableForegroundNotifications(queueId));
    setEnabled(true);
  }

  async function testAlert() {
    setTestActive(true);
    if (testTimer.current !== null) window.clearTimeout(testTimer.current);
    testTimer.current = window.setTimeout(() => {
      setTestActive(false);
      testTimer.current = null;
    }, 5_000);
    await deliverForegroundNotification(t('customer.yourTurn'), t('customer.called'));
  }

  const callExpired = Boolean(callKey && !callIsActive);

  return (
    <>
      {ticket.status === 'waiting' && (
        <div className="notification-controls">
          {!enabled ? (
            <button className="button secondary" type="button" onClick={() => void enable()}>
              {t('customer.enableNotifications')}
            </button>
          ) : (
            <>
              <p className="muted notification-state">
                {permission === 'denied' || permission === 'unsupported'
                  ? t('customer.inAppNotificationsEnabled')
                  : t('customer.notificationsEnabled')}
              </p>
              <button className="button ghost small" type="button" onClick={() => void testAlert()}>
                {t('customer.testNotification')}
              </button>
            </>
          )}
        </div>
      )}

      {callExpired && (
        <p className="alert call-expired" aria-live="polite">
          {t('customer.callExpired')}
        </p>
      )}

      {(callIsActive || testActive) && (
        <section className="call-notice" role="status" aria-live="assertive">
          <p className="call-notice-label">{t('customer.now')}</p>
          <h2>{t('customer.yourTurn')}</h2>
          <p>{t('customer.called')}</p>
        </section>
      )}
    </>
  );
}
