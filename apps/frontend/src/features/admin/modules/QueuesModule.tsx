import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { apiRequest } from '../../../api/client';
import { Card, ErrorMessage } from '../../../components/Shell';
import { EventBrand } from '../../../components/EventBrand';
import type { AdminQueueDetail, SuperAdminOverview } from '../../../types';
import { dateTime } from '../formatters';
import { useAppI18n } from '../../../i18n/context';
import { PageSetupFields } from '../components/PageSetupFields';

const periodDate = (value: string | null, locale: string, noEnd: string) =>
  value ? dateTime(value, locale) : noEnd;
const hongKongInputDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }) : '';

export function QueuesModule({ overview }: { overview: SuperAdminOverview }) {
  const { t, locale } = useAppI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const queueId = location.pathname.split('/')[3] || '';
  const [detail, setDetail] = useState<AdminQueueDetail | null>(null);
  const [archivedOverview, setArchivedOverview] = useState<SuperAdminOverview | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmationName, setConfirmationName] = useState('');
  const [startMode, setStartMode] = useState<'now' | 'scheduled'>('now');
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [logoRemovalRequested, setLogoRemovalRequested] = useState(false);

  useEffect(
    () => () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  function selectLogo(file: File | null) {
    if (
      file &&
      (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > 2 * 1024 * 1024)
    ) {
      setPendingLogo(null);
      setLogoPreview('');
      setError('errors.invalidLogo');
      return;
    }
    setError('');
    setPendingLogo(file);
    setLogoPreview(file ? URL.createObjectURL(file) : '');
    if (file) setLogoRemovalRequested(false);
  }

  function resetBrandingDraft() {
    selectLogo(null);
    setLogoRemovalRequested(false);
  }

  function stageLogoRemoval() {
    if (!detail || detail.queue.isRemoved) return;
    selectLogo(null);
    setLogoRemovalRequested(true);
  }

  useEffect(() => {
    if (!queueId) {
      setDetail(null);
      return;
    }
    let active = true;
    setBusy(true);
    setError('');
    apiRequest<AdminQueueDetail>(`/api/super-admin/queues/${queueId}`)
      .then(value => {
        if (active) setDetail(value);
      })
      .catch(() => {
        if (active) setError('errors.loadEvent');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [queueId, location.key]);

  useEffect(() => {
    const warning = (location.state as { brandingWarning?: string } | null)?.brandingWarning;
    if (warning) setError(warning);
  }, [location.state]);

  useEffect(() => {
    if (!showArchived || archivedOverview) return;
    setBusy(true);
    apiRequest<SuperAdminOverview>('/api/super-admin/overview?status=removed')
      .then(setArchivedOverview)
      .catch(() => setError('errors.loadArchived'))
      .finally(() => setBusy(false));
  }, [showArchived, archivedOverview]);

  const filteredEvents = useMemo(() => {
    const source = showArchived ? (archivedOverview?.queues ?? []) : overview.queues;
    const query = search.trim().toLowerCase();
    return source.filter(
      event =>
        !query ||
        event.name.toLowerCase().includes(query) ||
        event.queueId.toLowerCase().includes(query),
    );
  }, [showArchived, archivedOverview, overview.queues, search]);

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    let created: { queueId: string };
    try {
      created = await apiRequest<{ queueId: string }>('/api/queues', {
        method: 'POST',
        body: JSON.stringify({
          businessName: form.get('name'),
          password: form.get('password'),
          startMode,
          description: String(form.get('description') || '').trim() || null,
          startLocal: startMode === 'scheduled' ? form.get('startLocal') : '',
          endDate: form.get('endDate'),
        }),
      });
    } catch {
      setError('errors.createEvent');
      setBusy(false);
      return;
    }
    try {
      if (pendingLogo)
        await apiRequest(`/api/super-admin/queues/${created.queueId}/logo`, {
          method: 'PUT',
          body: pendingLogo,
          headers: { 'Content-Type': pendingLogo.type },
        });
      resetBrandingDraft();
      setCreating(false);
      setBusy(false);
      navigate(`/super-admin/queues/${created.queueId}`);
    } catch {
      resetBrandingDraft();
      setCreating(false);
      setBusy(false);
      navigate(`/super-admin/queues/${created.queueId}`, {
        state: { brandingWarning: 'errors.logoUploadAfterSave' },
      });
    }
  }

  async function editEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | null> = {
      name: String(form.get('name') || ''),
      description: String(form.get('description') || '').trim() || null,
    };
    const password = String(form.get('password') || '');
    const startLocal = String(form.get('startLocal') || '').trim();
    const endDate = String(form.get('endDate') || '').trim();
    if (password) body.password = password;
    if (startLocal) body.startLocal = startLocal;
    body.endDate = endDate;
    try {
      await apiRequest(`/api/super-admin/queues/${detail.queue.queueId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    } catch {
      setError('errors.editEvent');
      setBusy(false);
      return;
    }
    try {
      if (pendingLogo)
        await apiRequest(`/api/super-admin/queues/${detail.queue.queueId}/logo`, {
          method: 'PUT',
          body: pendingLogo,
          headers: { 'Content-Type': pendingLogo.type },
        });
      else if (logoRemovalRequested)
        await apiRequest(`/api/super-admin/queues/${detail.queue.queueId}/logo`, {
          method: 'DELETE',
        });
      resetBrandingDraft();
      setEditing(false);
      setBusy(false);
      navigate(`/super-admin/queues/${detail.queue.queueId}`, { replace: true });
    } catch {
      resetBrandingDraft();
      setEditing(false);
      setBusy(false);
      navigate(`/super-admin/queues/${detail.queue.queueId}`, {
        replace: true,
        state: { brandingWarning: 'errors.logoUploadAfterSave' },
      });
    }
  }

  async function archiveEvent() {
    if (!detail || confirmationName !== detail.queue.name) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/super-admin/queues/${detail.queue.queueId}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmationName }),
      });
      navigate('/super-admin/queues');
    } catch {
      setError('errors.archiveEvent');
      setBusy(false);
    }
  }

  async function restoreEvent() {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/super-admin/queues/${detail.queue.queueId}/restore`, {
        method: 'POST',
        body: '{}',
      });
      navigate('/super-admin/queues');
    } catch {
      setError('errors.restoreEvent');
      setBusy(false);
    }
  }

  return (
    <>
      <header className="module-heading">
        <div>
          <p className="eyebrow">{t('queues.eyebrow')}</p>
          <h1>{t('queues.title')}</h1>
          <p className="muted">{t('queues.intro')}</p>
        </div>
        <div className="stack">
          <span className="status-pill">
            {t('queues.count', { count: overview.summary.queues })}
          </span>
          {!queueId && (
            <button
              className="button primary"
              aria-hidden={creating}
              disabled={creating}
              onClick={() => {
                selectLogo(null);
                setCreating(true);
              }}
            >
              {t('queues.create')}
            </button>
          )}
        </div>
      </header>
      <ErrorMessage message={error ? t(error) : ''} />
      {!queueId && (
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
                  onClick={() => setShowArchived(false)}
                >
                  {t('common.active')}
                </button>
                <button
                  className={showArchived ? 'active' : ''}
                  onClick={() => setShowArchived(true)}
                >
                  {t('queues.archivedCount', { count: overview.summary.removedQueues })}
                </button>
              </div>
              <label className="search-field">
                <span className="sr-only">{t('queues.search')}</span>
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
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
                {filteredEvents.map(event => (
                  <tr key={event.queueId}>
                    <td data-label={t('common.event')}>
                      <strong>{event.name}</strong>
                      <code>{event.queueId}</code>
                    </td>
                    <td data-label={t('common.status')}>
                      <span
                        className={`status-pill ${event.isRemoved ? 'removed' : event.lifecycleStatus}`}
                      >
                        {event.isRemoved
                          ? t('common.archived')
                          : t(`common.${event.lifecycleStatus}`)}
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
                      <button
                        className="button small secondary"
                        onClick={() => navigate(`/super-admin/queues/${event.queueId}`)}
                      >
                        {t('common.view')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!busy && filteredEvents.length === 0 && (
            <div className="empty">
              <strong>{t('queues.noMatch')}</strong>
              <p>{t('queues.noMatchHint')}</p>
            </div>
          )}
        </Card>
      )}
      {queueId && busy && !detail && (
        <Card className="admin-panel">
          <p>{t('queues.loadingDetail')}</p>
        </Card>
      )}
      {queueId && detail && (
        <Card className="admin-panel queue-detail">
          <div className="panel-heading admin-toolbar">
            <div>
              <p className="eyebrow">{t('queues.detail')}</p>
              <h2>{detail.queue.name}</h2>
              <code>{detail.queue.queueId}</code>
            </div>
            <div className="stack">
              <button
                className="button small secondary"
                disabled={detail.queue.isRemoved}
                onClick={() => {
                  resetBrandingDraft();
                  setEditing(true);
                }}
              >
                {t('queues.edit')}
              </button>
              <button
                className="button small ghost"
                onClick={() => navigate('/super-admin/queues')}
              >
                {t('queues.back')}
              </button>
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
              <button className="button secondary" disabled={busy} onClick={restoreEvent}>
                {t('queues.restore')}
              </button>
            ) : (
              <button className="button danger" onClick={() => setConfirming(true)}>
                {t('queues.archiveTitle')}
              </button>
            )}
          </section>
        </Card>
      )}

      {creating && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => {
            resetBrandingDraft();
            setCreating(false);
          }}
        >
          <section
            className="confirm-dialog create-event-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-event-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <p className="eyebrow">{t('queues.vendorAdmin')}</p>
            <h2 id="create-event-title">{t('queues.create')}</h2>
            <form className="form-stack" onSubmit={createEvent}>
              <PageSetupFields previewUrl={logoPreview} onLogoChange={selectLogo} />
              <label>
                {t('queues.staffPassword')}
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                />
              </label>
              <p className="muted">{t('queues.passwordHint')}</p>
              <fieldset className="period-fields">
                <legend>{t('queues.accessPeriod')}</legend>
                <div
                  className="segmented-control"
                  role="radiogroup"
                  aria-label={t('queues.eventStart')}
                >
                  <label>
                    <input
                      type="radio"
                      checked={startMode === 'now'}
                      onChange={() => setStartMode('now')}
                    />{' '}
                    {t('queues.startNow')}
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={startMode === 'scheduled'}
                      onChange={() => setStartMode('scheduled')}
                    />{' '}
                    {t('queues.schedule')}
                  </label>
                </div>
                {startMode === 'scheduled' && (
                  <label>
                    {t('queues.startDate')}
                    <input name="startLocal" type="datetime-local" required />
                  </label>
                )}
                <label>
                  {t('queues.endDate')}
                  <input name="endDate" type="date" />
                </label>
              </fieldset>
              <ErrorMessage message={error ? t(error) : ''} />
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => {
                    resetBrandingDraft();
                    setCreating(false);
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? t('queues.creating') : t('queues.create')}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {editing && detail && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => {
            resetBrandingDraft();
            setEditing(false);
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-event-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <p className="eyebrow">{t('queues.vendorAdmin')}</p>
            <h2 id="edit-event-title">{t('queues.editTitle')}</h2>
            <form className="form-stack" onSubmit={editEvent}>
              <PageSetupFields
                defaultName={detail.queue.name}
                defaultDescription={detail.queue.description}
                logoUrl={logoRemovalRequested ? null : detail.queue.logoUrl}
                previewUrl={logoPreview}
                onLogoChange={selectLogo}
                onRemoveLogo={stageLogoRemoval}
              />
              <label>
                {t('queues.newPassword')}{' '}
                <span className="optional">{t('queues.keepPassword')}</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                />
              </label>
              <label>
                {t('queues.newStart')} <span className="optional">{t('common.optional')}</span>
                <input name="startLocal" type="datetime-local" />
              </label>
              <label>
                {t('queues.newEnd')} <span className="optional">{t('queues.clearEnd')}</span>
                <input
                  name="endDate"
                  type="date"
                  defaultValue={hongKongInputDate(detail.queue.endAt)}
                />
              </label>
              <ErrorMessage message={error ? t(error) : ''} />
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => {
                    resetBrandingDraft();
                    setEditing(false);
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? t('queues.saving') : t('queues.save')}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {confirming && detail && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setConfirming(false)}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <p className="eyebrow">{t('queues.archiveTitle')}</p>
            <h2 id="archive-title">{t('queues.archiveQuestion')}</h2>
            <p>{t('queues.archiveRouteHint')}</p>
            <label>
              {t('queues.typeConfirm', { name: detail.queue.name })}
              <input
                autoFocus
                value={confirmationName}
                onChange={event => setConfirmationName(event.target.value)}
              />
            </label>
            <ErrorMessage message={error ? t(error) : ''} />
            <div className="dialog-actions">
              <button className="button ghost" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="button danger"
                disabled={busy || confirmationName !== detail.queue.name}
                onClick={archiveEvent}
              >
                {busy ? t('queues.archiving') : t('queues.archiveTitle')}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
