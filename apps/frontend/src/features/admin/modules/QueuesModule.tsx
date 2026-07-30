import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { apiRequest } from '../../../api/client';
import { adminApi } from '../../../api/resources';
import { Card, ErrorMessage } from '../../../components/Shell';
import type { AdminQueueDetail, SuperAdminOverview } from '../../../types';
import { useAppI18n } from '../../../i18n/context';
import { appQueryClient, queryKeys } from '../../../query/client';
import { ArchiveEventDialog, CreateEventDialog, EditEventDialog } from '../queues/QueueDialogs';
import { QueueDetailPanel, QueueListPanel } from '../queues/QueuePanels';

export function QueuesModule({ overview }: { overview: SuperAdminOverview }) {
  const { t } = useAppI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const queueId = location.pathname.split('/')[3] || '';
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [mutationBusy, setMutationBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmationName, setConfirmationName] = useState('');
  const [startMode, setStartMode] = useState<'now' | 'scheduled'>('now');
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [logoRemovalRequested, setLogoRemovalRequested] = useState(false);

  const detailQuery = useQuery(
    {
      queryKey: queryKeys.adminQueue(queueId),
      queryFn: ({ signal }) => adminApi.queue(queueId, signal),
      enabled: Boolean(queueId),
    },
    appQueryClient,
  );
  const archivedQuery = useQuery(
    {
      queryKey: queryKeys.adminOverview('removed'),
      queryFn: ({ signal }) => adminApi.overview('removed', signal),
      enabled: showArchived,
    },
    appQueryClient,
  );
  const detail: AdminQueueDetail | null = detailQuery.data ?? null;
  const archivedOverview = archivedQuery.data ?? null;
  const busy = mutationBusy || detailQuery.isFetching || archivedQuery.isFetching;
  const queryError = detailQuery.isError
    ? 'errors.loadEvent'
    : archivedQuery.isError
      ? 'errors.loadArchived'
      : '';
  const visibleError = error || queryError;

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

  useEffect(() => {
    setCreating(false);
    setEditing(false);
    setConfirming(false);
    setConfirmationName('');
    setPendingLogo(null);
    setLogoPreview('');
    setLogoRemovalRequested(false);
  }, [queueId]);

  function stageLogoRemoval() {
    if (!detail || detail.queue.isRemoved) return;
    selectLogo(null);
    setLogoRemovalRequested(true);
  }

  useEffect(() => {
    const warning = (location.state as { brandingWarning?: string } | null)?.brandingWarning;
    if (warning) setError(warning);
  }, [location.state]);

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
    setMutationBusy(true);
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
      setMutationBusy(false);
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
      setMutationBusy(false);
      void appQueryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() });
      navigate(`/super-admin/queues/${created.queueId}`);
    } catch {
      resetBrandingDraft();
      setCreating(false);
      setMutationBusy(false);
      void appQueryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() });
      navigate(`/super-admin/queues/${created.queueId}`, {
        state: { brandingWarning: 'errors.logoUploadAfterSave' },
      });
    }
  }

  async function editEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setMutationBusy(true);
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
      setMutationBusy(false);
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
      setMutationBusy(false);
      void appQueryClient.invalidateQueries({
        queryKey: queryKeys.adminQueue(detail.queue.queueId),
      });
      void appQueryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() });
      navigate(`/super-admin/queues/${detail.queue.queueId}`, { replace: true });
    } catch {
      resetBrandingDraft();
      setEditing(false);
      setMutationBusy(false);
      void appQueryClient.invalidateQueries({
        queryKey: queryKeys.adminQueue(detail.queue.queueId),
      });
      void appQueryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() });
      navigate(`/super-admin/queues/${detail.queue.queueId}`, {
        replace: true,
        state: { brandingWarning: 'errors.logoUploadAfterSave' },
      });
    }
  }

  async function archiveEvent() {
    if (!detail || confirmationName !== detail.queue.name) return;
    setMutationBusy(true);
    setError('');
    try {
      await apiRequest(`/api/super-admin/queues/${detail.queue.queueId}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmationName }),
      });
      appQueryClient.removeQueries({ queryKey: queryKeys.adminQueue(detail.queue.queueId) });
      void appQueryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() });
      void appQueryClient.invalidateQueries({ queryKey: queryKeys.adminOverview('removed') });
      setMutationBusy(false);
      navigate('/super-admin/queues');
    } catch {
      setError('errors.archiveEvent');
      setMutationBusy(false);
    }
  }

  async function restoreEvent() {
    if (!detail) return;
    setMutationBusy(true);
    setError('');
    try {
      await apiRequest(`/api/super-admin/queues/${detail.queue.queueId}/restore`, {
        method: 'POST',
        body: '{}',
      });
      appQueryClient.removeQueries({ queryKey: queryKeys.adminQueue(detail.queue.queueId) });
      void appQueryClient.invalidateQueries({ queryKey: queryKeys.adminOverview() });
      void appQueryClient.invalidateQueries({ queryKey: queryKeys.adminOverview('removed') });
      setMutationBusy(false);
      navigate('/super-admin/queues');
    } catch {
      setError('errors.restoreEvent');
      setMutationBusy(false);
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
      <ErrorMessage message={visibleError ? t(visibleError) : ''} />
      {!queueId && (
        <QueueListPanel
          events={filteredEvents}
          busy={busy}
          showArchived={showArchived}
          archivedCount={overview.summary.removedQueues}
          search={search}
          onShowArchivedChange={setShowArchived}
          onSearchChange={setSearch}
          onView={selectedQueueId => navigate(`/super-admin/queues/${selectedQueueId}`)}
        />
      )}
      {queueId && busy && !detail && (
        <Card className="admin-panel">
          <p>{t('queues.loadingDetail')}</p>
        </Card>
      )}
      {queueId && detail && (
        <QueueDetailPanel
          detail={detail}
          busy={busy}
          onEdit={() => {
            resetBrandingDraft();
            setEditing(true);
          }}
          onBack={() => navigate('/super-admin/queues')}
          onRestore={() => void restoreEvent()}
          onArchive={() => setConfirming(true)}
        />
      )}

      <CreateEventDialog
        open={creating}
        busy={busy}
        errorKey={visibleError}
        logoPreview={logoPreview}
        startMode={startMode}
        onLogoChange={selectLogo}
        onStartModeChange={setStartMode}
        onSubmit={createEvent}
        onClose={() => {
          resetBrandingDraft();
          setCreating(false);
        }}
      />

      <EditEventDialog
        detail={editing ? detail : null}
        busy={busy}
        errorKey={visibleError}
        logoPreview={logoPreview}
        logoRemovalRequested={logoRemovalRequested}
        onLogoChange={selectLogo}
        onRemoveLogo={stageLogoRemoval}
        onSubmit={editEvent}
        onClose={() => {
          resetBrandingDraft();
          setEditing(false);
        }}
      />

      <ArchiveEventDialog
        detail={confirming ? detail : null}
        busy={busy}
        errorKey={visibleError}
        confirmationName={confirmationName}
        onConfirmationNameChange={setConfirmationName}
        onClose={() => setConfirming(false)}
        onConfirm={() => void archiveEvent()}
      />
    </>
  );
}
