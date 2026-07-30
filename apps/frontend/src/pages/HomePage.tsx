import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { apiRequest } from '../api/client';
import { Card, ErrorMessage, Shell } from '../components/Shell';
import { useAppI18n } from '../i18n/context';

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useAppI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const eventId = String(form.get('eventId') || '')
      .trim()
      .toLowerCase();
    const password = String(form.get('password') || '');
    try {
      await apiRequest(`/api/queues/${encodeURIComponent(eventId)}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ credential: password }),
      });
      navigate(`/vendor/${encodeURIComponent(eventId)}`);
    } catch {
      setError('errors.accessDenied');
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="narrow">
        <Card className="admin-login">
          <div className="lock-mark">EQ</div>
          <p className="eyebrow">{t('home.eyebrow')}</p>
          <h1>{t('home.title')}</h1>
          <p className="muted">{t('home.intro')}</p>
          <form className="form-stack" onSubmit={login}>
            <label>
              {t('common.eventId')}
              <input
                name="eventId"
                autoComplete="username"
                required
                placeholder={t('home.eventIdPlaceholder')}
              />
            </label>
            <label>
              {t('common.password')}
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <ErrorMessage message={error ? t(error) : ''} />
            <button className="button primary" disabled={busy}>
              {busy ? t('common.checking') : t('home.submit')}
            </button>
          </form>
          <p className="muted">{t('home.customerHint')}</p>
        </Card>
      </div>
    </Shell>
  );
}
