import { Link } from 'react-router';
import type { AuditEvent, SuperAdminOverview } from '../../../types';
import { Card } from '../../../components/Shell';
import { dateTime, titleCase } from '../formatters';
import { useAppI18n } from '../../../i18n/context';

export function OverviewModule({
  overview,
  audit,
}: {
  overview: SuperAdminOverview;
  audit: AuditEvent[];
}) {
  const { t, locale } = useAppI18n();
  const active = overview.queues
    .filter(queue => queue.lifecycleStatus === 'active' && queue.waitingCount > 0)
    .slice(0, 4);
  return (
    <>
      <header className="module-heading">
        <div>
          <p className="eyebrow">{t('overview.eyebrow')}</p>
          <h1>{t('overview.title')}</h1>
          <p className="muted">{t('overview.intro')}</p>
        </div>
        <span className="status-pill healthy">{t('adminShell.online')}</span>
      </header>
      <section className="metric-grid" aria-label={t('overview.systemOverview')}>
        <Card>
          <span>{t('overview.events')}</span>
          <strong>{overview.summary.queues}</strong>
          <small>{t('overview.managed')}</small>
        </Card>
        <Card>
          <span>{t('overview.waitingNow')}</span>
          <strong>{overview.summary.waiting}</strong>
          <small>{t('overview.across')}</small>
        </Card>
        <Card>
          <span>{t('overview.served')}</span>
          <strong>{overview.summary.served}</strong>
          <small>{t('overview.completed')}</small>
        </Card>
        <Card>
          <span>{t('overview.active')}</span>
          <strong>{overview.summary.activeQueues}</strong>
          <small>{t('overview.open')}</small>
        </Card>
      </section>
      <section className="admin-overview-grid">
        <Card className="admin-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('overview.activeQueues')}</h2>
              <p className="muted">{t('overview.activeHint')}</p>
            </div>
            <Link to="/super-admin/queues" className="text-link">
              {t('overview.viewAll')}
            </Link>
          </div>
          <div className="overview-list">
            {active.map(queue => (
              <Link key={queue.queueId} to={`/super-admin/queues/${queue.queueId}`}>
                <div>
                  <strong>{queue.name}</strong>
                  <small>{queue.queueId}</small>
                </div>
                <span>{t('overview.queueWaiting', { count: queue.waitingCount })}</span>
              </Link>
            ))}
          </div>
          {active.length === 0 && (
            <div className="empty compact">
              <strong>{t('overview.noActive')}</strong>
            </div>
          )}
        </Card>
        <Card className="admin-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('overview.recent')}</h2>
              <p className="muted">{t('overview.recentHint')}</p>
            </div>
            <Link to="/super-admin/audit" className="text-link">
              {t('overview.openLog')}
            </Link>
          </div>
          <div className="overview-audit">
            {audit.slice(0, 5).map(event => (
              <article key={event.id}>
                <span className="audit-icon">{event.action.charAt(0)}</span>
                <div>
                  <strong>{titleCase(event.action)}</strong>
                  <small>
                    {event.queueName || t('common.system')} ·{' '}
                    {dateTime(event.createdAt, locale) || t('common.noActivity')}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </Card>
      </section>
    </>
  );
}
