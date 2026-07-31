import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiRequest } from '../api/client';
import { Card, ErrorMessage, Shell } from '../components/Shell';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
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
    <Shell
      actions={
        <nav className="landing-nav" aria-label={t('home.navigation')}>
          <a href="#features">{t('home.featuresNav')}</a>
          <a href="#staff-login">{t('home.title')}</a>
        </nav>
      }
    >
      <div className="landing-page">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-copy">
            <p className="eyebrow">{t('home.eyebrow')}</p>
            <h1 id="landing-title">{t('home.heroTitle')}</h1>
            <p className="lede">{t('home.heroIntro')}</p>
            <div className="feature-row" aria-label={t('home.featuresLabel')}>
              <span>{t('home.featureQr')}</span>
              <span>{t('home.featureLive')}</span>
              <span>{t('home.featureLanguages')}</span>
            </div>
            <div className="landing-steps" id="features">
              {(['share', 'join', 'call'] as const).map((step, index) => (
                <article className="landing-step" key={step}>
                  <span className="step-number">0{index + 1}</span>
                  <h2>{t(`home.steps.${step}.title`)}</h2>
                  <p>{t(`home.steps.${step}.body`)}</p>
                </article>
              ))}
            </div>
          </div>
          <Card className="admin-login landing-login" id="staff-login">
            <div className="lock-mark">EQ</div>
            <h2>{t('home.title')}</h2>
            <p className="muted">{t('home.intro')}</p>
            <form className="form-stack" onSubmit={login}>
              <label>
                {t('common.eventId')}
                <Input
                  name="eventId"
                  autoComplete="username"
                  required
                  placeholder={t('home.eventIdPlaceholder')}
                />
              </label>
              <label>
                {t('common.password')}
                <Input name="password" type="password" autoComplete="current-password" required />
              </label>
              <ErrorMessage message={error ? t(error) : ''} />
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? t('common.checking') : t('home.submit')}
              </Button>
            </form>
            <p className="muted landing-customer-hint">{t('home.customerHint')}</p>
            <div className="landing-admin-link">
              <span>{t('home.adminLabel')}</span>
              <Link to="/super-admin" aria-label={t('home.adminSignIn')}>
                {t('home.adminSignIn')} <span aria-hidden="true">→</span>
              </Link>
            </div>
          </Card>
        </section>
      </div>
    </Shell>
  );
}
