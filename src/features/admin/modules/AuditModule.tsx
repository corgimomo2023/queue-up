import { useMemo, useState } from 'react';
import type { AuditEvent, SuperAdminOverview } from '../../../types';
import { Card } from '../../../components/Shell';
import { dateTime, titleCase } from '../formatters';
import { useAppI18n } from '../../../i18n/context';

export function AuditModule({ events, overview }: { events: AuditEvent[]; overview: SuperAdminOverview }) {
  const { t, locale } = useAppI18n();
  const [queueId, setQueueId] = useState('');
  const [query, setQuery] = useState('');
  const visible = useMemo(() => events.filter(event => {
    const text = `${event.action} ${event.actorType} ${event.queueName || ''}`.toLowerCase();
    return (!queueId || event.queueId === queueId) && (!query || text.includes(query.toLowerCase()));
  }), [events, queueId, query]);
  return <>
    <header className="module-heading"><div><p className="eyebrow">{t('audit.eyebrow')}</p><h1>{t('audit.title')}</h1><p className="muted">{t('audit.intro')}</p></div><span className="status-pill">{t('audit.count', { count: visible.length })}</span></header>
    <Card className="admin-panel audit-module">
      <div className="audit-filters"><label>{t('audit.search')}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('audit.searchPlaceholder')} /></label><label>{t('audit.event')}<select value={queueId} onChange={event => setQueueId(event.target.value)}><option value="">{t('audit.all')}</option>{overview.queues.map(queue => <option key={queue.queueId} value={queue.queueId}>{queue.name}</option>)}</select></label></div>
      <div className="audit-list">{visible.map(event => <article key={event.id} className="audit-row"><div className="audit-icon">{event.action.charAt(0)}</div><div><strong>{titleCase(event.action)}</strong><p>{event.queueName || t('common.system')}{event.customerId ? ` · ${t('audit.customer', { id: event.customerId })}` : ''}</p></div><span className="audit-actor">{titleCase(event.actorType)}</span><time>{dateTime(event.createdAt, locale) || t('common.noActivity')}</time></article>)}</div>
      {visible.length === 0 && <div className="empty"><strong>{t('audit.none')}</strong></div>}
    </Card>
  </>;
}
