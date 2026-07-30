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

function formatCountdown(expiresAt: string | null, now: number) {
  if (!expiresAt) return '--:--';
  const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function CustomerNotifications({ queueId, ticket }: CustomerNotificationsProps) {
  const { t } = useAppI18n();
  const [enabled, setEnabled] = useState(() => notificationPreferenceStore.load(queueId));
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported' | null>(null);
  const [now, setNow] = useState(Date.now());
  const [testActive, setTestActive] = useState(false);
  const [dismissedCall, setDismissedCall] = useState<string | null>(null);
  const deliveredCall = useRef<string | null>(null);
  const dismissButton = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const callKey =
    ticket.status === 'served' ? (ticket.calledAt ?? `ticket-${ticket.customerId}`) : null;
  const expiresAt = ticket.expiresAt ? Date.parse(ticket.expiresAt) : Number.NaN;
  const callIsActive = Boolean(callKey && Number.isFinite(expiresAt) && expiresAt > now);

  useEffect(() => {
    if (!callKey || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (nextNow >= expiresAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [callKey, expiresAt]);

  useEffect(() => {
    if (!enabled || !callIsActive || !callKey || deliveredCall.current === callKey) return;
    deliveredCall.current = callKey;
    void deliverForegroundNotification(t('customer.yourTurn'), t('customer.called'));
  }, [callIsActive, callKey, enabled, t]);

  async function enable() {
    setPermission(await enableForegroundNotifications(queueId));
    setEnabled(true);
  }

  async function testAlert() {
    setTestActive(true);
    await deliverForegroundNotification(t('customer.yourTurn'), t('customer.called'));
  }

  const showingTest = testActive && !callIsActive;
  const showCallBanner = Boolean(callIsActive && callKey && dismissedCall !== callKey);
  const showBanner = showingTest || showCallBanner;
  const callExpired = Boolean(callKey && !callIsActive);
  const countdown = showingTest ? '05:00' : formatCountdown(ticket.expiresAt, now);

  useEffect(() => {
    if (callKey) setTestActive(false);
  }, [callKey]);

  useEffect(() => {
    if (!showBanner) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dismissButton.current?.focus();
    return () => previousFocus.current?.focus();
  }, [showBanner]);

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

      {callExpired && !testActive && (
        <p className="alert call-expired" aria-live="polite">
          {t('customer.callExpired')}
        </p>
      )}

      {showBanner && (
        <div
          key={showingTest ? 'test-alert' : callKey}
          className="call-banner"
          role="alertdialog"
          aria-labelledby="call-banner-title"
        >
          <div className="call-banner-content">
            <p className="call-banner-now">{t('customer.now')}</p>
            <h2 id="call-banner-title">{t('customer.yourTurn')}</h2>
            <p>{t('customer.called')}</p>
            <div className="call-countdown" aria-label={t('customer.timeRemaining')}>
              {countdown}
            </div>
            <button
              ref={dismissButton}
              className="button call-banner-dismiss"
              type="button"
              onClick={() => {
                if (showingTest) {
                  setTestActive(false);
                  return;
                }
                if (callKey) setDismissedCall(callKey);
              }}
            >
              {t('customer.dismissCall')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
