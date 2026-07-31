import { Link } from 'react-router';
import { Card } from '../../../components/Shell';
import { EventBrand } from '../../../components/EventBrand';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useAppI18n } from '../../../i18n/context';
import type { AdminQueueDetail, SuperAdminOverview } from '../../../types';
import { dateTime } from '../formatters';

const periodDate = (value: string | null, locale: string, noEnd: string) =>
  value ? dateTime(value, locale) : noEnd;

interface QueueListPanelProps {
  events: SuperAdminOverview['queues'];
  busy: boolean;
  showArchived: boolean;
  archivedCount: number;
  search: string;
  onShowArchivedChange: (show: boolean) => void;
  onSearchChange: (search: string) => void;
  onView: (queueId: string) => void;
}

export function QueueListPanel({
  events,
  busy,
  showArchived,
  archivedCount,
  search,
  onShowArchivedChange,
  onSearchChange,
  onView,
}: QueueListPanelProps) {
  const { t, locale } = useAppI18n();
  return (
    <Card className="admin-panel">
      <div className="panel-heading admin-toolbar">
        <div>
          <h2>{t('queues.megabox')}</h2>
          <p className="muted">{t('queues.archivedHint')}</p>
        </div>
        <div className="admin-filter-row">
          <div className="segmented-control">
            <button
              className={!showArchived ? 'active' : ''}
              onClick={() => onShowArchivedChange(false)}
            >
              {t('common.active')}
            </button>
            <button
              className={showArchived ? 'active' : ''}
              onClick={() => onShowArchivedChange(true)}
            >
              {t('queues.archivedCount', { count: archivedCount })}
            </button>
          </div>
          <label className="search-field">
            <span className="sr-only">{t('queues.search')}</span>
            <Input
              value={search}
              onChange={event => onSearchChange(event.target.value)}
              placeholder={t('queues.searchPlaceholder')}
            />
          </label>
        </div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('common.event')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.period')}</th>
              <th>{t('common.waiting')}</th>
              <th>{t('common.served')}</th>
              <th>{t('common.total')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {events.map(event => (
              <tr key={event.queueId}>
                <td data-label={t('common.event')}>
                  <strong>{event.name}</strong>
                  <code>{event.queueId}</code>
                </td>
                <td data-label={t('common.status')}>
                  <span
                    className={`status-pill ${event.isRemoved ? 'removed' : event.lifecycleStatus}`}
                  >
                    {event.isRemoved ? t('common.archived') : t(`common.${event.lifecycleStatus}`)}
                  </span>
                </td>
                <td data-label={t('common.period')}>
                  <small>
                    {periodDate(event.startAt, locale, t('queues.noEnd'))}
                    <br />
                    {t('queues.to')} {periodDate(event.endAt, locale, t('queues.noEnd'))}
                  </small>
                </td>
                <td data-label={t('common.waiting')}>
                  <span className="status-count waiting">{event.waitingCount}</span>
                </td>
                <td data-label={t('common.served')}>{event.servedCount}</td>
                <td data-label={t('common.total')}>{event.totalCustomers}</td>
                <td data-label={t('common.action')}>
                  <Button variant="secondary" size="small" onClick={() => onView(event.queueId)}>
                    {t('common.view')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!busy && events.length === 0 && (
        <div className="empty">
          <strong>{t('queues.noMatch')}</strong>
          <p>{t('queues.noMatchHint')}</p>
        </div>
      )}
    </Card>
  );
}

interface QueueDetailPanelProps {
  detail: AdminQueueDetail;
  busy: boolean;
  onEdit: () => void;
  onBack: () => void;
  onRestore: () => void;
  onArchive: () => void;
}

export function QueueDetailPanel({
  detail,
  busy,
  onEdit,
  onBack,
  onRestore,
  onArchive,
}: QueueDetailPanelProps) {
  const { t, locale } = useAppI18n();
  return (
    <Card className="admin-panel queue-detail">
      <div className="panel-heading admin-toolbar">
        <div>
          <p className="eyebrow">{t('queues.detail')}</p>
          <h2>{detail.queue.name}</h2>
          <code>{detail.queue.queueId}</code>
        </div>
        <div className="stack">
          <Button
            variant="secondary"
            size="small"
            disabled={detail.queue.isRemoved}
            onClick={onEdit}
          >
            {t('queues.edit')}
          </Button>
          <Button variant="ghost" size="small" onClick={onBack}>
            {t('queues.back')}
          </Button>
        </div>
      </div>
      <section className="page-setup-preview">
        <p className="eyebrow">{t('queues.pageSetup')}</p>
        <EventBrand event={detail.queue} headingAs="div" compact />
      </section>
      <div className="detail-status-row">
        <span
          className={`status-pill ${detail.queue.isRemoved ? 'removed' : detail.queue.lifecycleStatus}`}
        >
          {detail.queue.isRemoved
            ? t('common.archived')
            : t(`common.${detail.queue.lifecycleStatus}`)}
        </span>
        <span>
          {t('queues.starts', {
            date: periodDate(detail.queue.startAt, locale, t('queues.noEnd')),
          })}
        </span>
        <span>
          {t('queues.ends', {
            date: periodDate(detail.queue.endAt, locale, t('queues.noEnd')),
          })}
        </span>
        <span>{t('queues.timeZone', { zone: detail.queue.timeZone })}</span>
      </div>
      {!detail.queue.isRemoved && (
        <div className="detail-links">
          <Link className="text-link" to={detail.queue.vendorUrl}>
            {t('queues.staffPage')}
          </Link>
          <Link className="text-link" to={detail.queue.customerUrl}>
            {t('queues.customerPage')}
          </Link>
        </div>
      )}
      <div className="mini-metrics">
        <span>
          <strong>{detail.counts.waiting}</strong> {t('queues.countWaiting')}
        </span>
        <span>
          <strong>{detail.counts.served}</strong> {t('queues.countServed')}
        </span>
        <span>
          <strong>{detail.counts.ended}</strong> {t('queues.countEnded')}
        </span>
        <span>
          <strong>{detail.counts.total}</strong> {t('queues.countTotal')}
        </span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table customer-history">
          <thead>
            <tr>
              <th>{t('common.customer')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.phone')}</th>
              <th>{t('common.message')}</th>
              <th>{t('common.joined')}</th>
              <th>{t('queues.endedColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {detail.customers.map(customer => (
              <tr key={customer.customerId}>
                <td data-label={t('common.customer')}>
                  <strong>{customer.name}</strong>
                  <code>#{customer.customerId}</code>
                </td>
                <td data-label={t('common.status')}>
                  <span className={`status-pill ${customer.status}`}>
                    {t(`common.${customer.status}`)}
                  </span>
                </td>
                <td data-label={t('common.phone')}>{customer.phoneMasked || '—'}</td>
                <td data-label={t('common.message')} className="message-cell">
                  {customer.message || '—'}
                </td>
                <td data-label={t('common.joined')}>
                  {dateTime(customer.joinedAt, locale) || t('common.noActivity')}
                </td>
                <td data-label={t('queues.endedColumn')}>
                  {dateTime(customer.endedAt, locale) || t('common.noActivity')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.customers.length === 0 && (
        <div className="empty">
          <strong>{t('queues.noHistory')}</strong>
        </div>
      )}
      <section className="danger-zone">
        <div>
          <h3>{t(detail.queue.isRemoved ? 'queues.restoreTitle' : 'queues.archiveTitle')}</h3>
          <p>{t(detail.queue.isRemoved ? 'queues.restoreHint' : 'queues.archiveHint')}</p>
        </div>
        {detail.queue.isRemoved ? (
          <Button variant="secondary" disabled={busy} onClick={onRestore}>
            {t('queues.restore')}
          </Button>
        ) : (
          <Button variant="danger" onClick={onArchive}>
            {t('queues.archiveTitle')}
          </Button>
        )}
      </section>
    </Card>
  );
}
