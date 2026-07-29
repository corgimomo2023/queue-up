import { Card } from '../../../components/Shell';
import type { SuperAdminOverview } from '../../../types';
import { useAppI18n } from '../../../i18n/context';

export function SystemModule({ overview }: { overview: SuperAdminOverview }) {
  const { t } = useAppI18n();
  return <>
    <header className="module-heading"><div><p className="eyebrow">{t('systemPage.eyebrow')}</p><h1>{t('systemPage.title')}</h1><p className="muted">{t('systemPage.intro')}</p></div><span className="status-pill healthy">{t('systemPage.operational')}</span></header>
    <section className="system-grid">
      <Card className="system-card"><span className="system-mark healthy">API</span><div><h2>{t('systemPage.apiConnected')}</h2><p className="muted">{t('systemPage.apiHint')}</p></div><strong>{t('systemPage.ready')}</strong></Card>
      <Card className="system-card"><span className="system-mark healthy">DB</span><div><h2>{t('systemPage.dbReady')}</h2><p className="muted">{t('systemPage.dbHint')}</p></div><strong>{t('systemPage.records', { count: overview.summary.totalCustomers })}</strong></Card>
      <Card className="system-card"><span className="system-mark protected">ID</span><div><h2>{t('systemPage.auth')}</h2><p className="muted">{t('systemPage.authHint')}</p></div><strong>{t('systemPage.protected')}</strong></Card>
      <Card className="system-card"><span className="system-mark pending">CF</span><div><h2>{t('systemPage.cf')}</h2><p className="muted">{t('systemPage.cfHint')}</p></div><strong>{t('systemPage.notEnabled')}</strong></Card>
    </section>
    <Card className="admin-panel system-note"><h2>{t('systemPage.boundary')}</h2><p>{t('systemPage.boundaryHint')}</p></Card>
  </>;
}
