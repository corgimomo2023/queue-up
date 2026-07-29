import { Link } from 'react-router';
import { Card, Shell } from '../components/Shell';
import { useAppI18n } from '../i18n/context';

export function NotFoundPage() {
  const { t } = useAppI18n();
  return (
    <Shell>
      <div className="narrow">
        <Card>
          <p className="eyebrow">404</p>
          <h1>{t('notFound.title')}</h1>
          <p className="muted">{t('notFound.hint')}</p>
          <Link className="button primary" to="/">
            {t('notFound.back')}
          </Link>
        </Card>
      </div>
    </Shell>
  );
}
