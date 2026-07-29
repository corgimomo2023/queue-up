import type { ElementType } from 'react';
import type { EventBranding, QueueLifecycle } from '../types';
import { useAppI18n } from '../i18n/context';

export function EventBrand({ event, eyebrow, headingAs: Heading = 'h1', compact = false }: {
  event: EventBranding;
  eyebrow?: string;
  headingAs?: ElementType;
  compact?: boolean;
}) {
  const { t } = useAppI18n();
  return <div className={`event-brand${compact ? ' compact' : ''}`}>
    {event.logoUrl && <img className="event-logo" src={event.logoUrl} alt={t('branding.logoAlt', { name: event.name })} />}
    <div className="event-brand-copy">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <Heading>{event.name}</Heading>
      {event.description && <p className="event-description">{event.description}</p>}
    </div>
  </div>;
}

const hkDateTime = (value: string, locale: string) => new Intl.DateTimeFormat(locale, {
  dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Hong_Kong',
}).format(new Date(value));

export function LifecycleStatus({ event, audience }: {
  event: EventBranding & { lifecycleStatus: QueueLifecycle; startAt: string; endAt: string | null };
  audience: 'staff' | 'customer';
}) {
  const { t, locale } = useAppI18n();
  const scheduled = event.lifecycleStatus === 'scheduled';
  const date = scheduled ? event.startAt : event.endAt;
  return <div className="lifecycle-presentation">
    <span className={`status-pill ${event.lifecycleStatus}`}>{t(scheduled ? 'common.scheduled' : 'common.ended')}</span>
    <EventBrand event={event} eyebrow={t(audience === 'staff' ? 'staff.dashboard' : 'customer.queue')} />
    <div className="lifecycle-message" role="status">
      <h2>{t(scheduled ? 'lifecycle.notOpen' : 'lifecycle.closed')}</h2>
      <p className="lifecycle-time">{date
        ? t(scheduled ? 'lifecycle.opensAt' : 'lifecycle.closedAt', { date: hkDateTime(date, locale) })
        : t('lifecycle.closedNoDate')}</p>
      <p className="muted">{t(scheduled ? `${audience}.scheduledHint` : `${audience}.endedHint`)}</p>
    </div>
  </div>;
}