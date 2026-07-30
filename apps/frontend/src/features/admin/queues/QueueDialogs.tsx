import type { FormEvent } from 'react';
import { ErrorMessage } from '../../../components/Shell';
import { useAppI18n } from '../../../i18n/context';
import type { AdminQueueDetail } from '../../../types';
import { PageSetupFields } from '../components/PageSetupFields';

interface SharedDialogProps {
  busy: boolean;
  errorKey: string;
  logoPreview: string;
  onClose: () => void;
  onLogoChange: (file: File | null) => void;
}

interface CreateEventDialogProps extends SharedDialogProps {
  open: boolean;
  startMode: 'now' | 'scheduled';
  onStartModeChange: (mode: 'now' | 'scheduled') => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function CreateEventDialog({
  open,
  busy,
  errorKey,
  logoPreview,
  startMode,
  onClose,
  onLogoChange,
  onStartModeChange,
  onSubmit,
}: CreateEventDialogProps) {
  const { t } = useAppI18n();
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="confirm-dialog create-event-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-event-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <p className="eyebrow">{t('queues.vendorAdmin')}</p>
        <h2 id="create-event-title">{t('queues.create')}</h2>
        <form className="form-stack" onSubmit={onSubmit}>
          <PageSetupFields previewUrl={logoPreview} onLogoChange={onLogoChange} />
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
                  onChange={() => onStartModeChange('now')}
                />{' '}
                {t('queues.startNow')}
              </label>
              <label>
                <input
                  type="radio"
                  checked={startMode === 'scheduled'}
                  onChange={() => onStartModeChange('scheduled')}
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
          <ErrorMessage message={errorKey ? t(errorKey) : ''} />
          <div className="dialog-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? t('queues.creating') : t('queues.create')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

interface EditEventDialogProps extends SharedDialogProps {
  detail: AdminQueueDetail | null;
  logoRemovalRequested: boolean;
  onRemoveLogo: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const hongKongInputDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }) : '';

export function EditEventDialog({
  detail,
  busy,
  errorKey,
  logoPreview,
  logoRemovalRequested,
  onClose,
  onLogoChange,
  onRemoveLogo,
  onSubmit,
}: EditEventDialogProps) {
  const { t } = useAppI18n();
  if (!detail) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-event-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <p className="eyebrow">{t('queues.vendorAdmin')}</p>
        <h2 id="edit-event-title">{t('queues.editTitle')}</h2>
        <form className="form-stack" onSubmit={onSubmit}>
          <PageSetupFields
            defaultName={detail.queue.name}
            defaultDescription={detail.queue.description}
            logoUrl={logoRemovalRequested ? null : detail.queue.logoUrl}
            previewUrl={logoPreview}
            onLogoChange={onLogoChange}
            onRemoveLogo={onRemoveLogo}
          />
          <label>
            {t('queues.newPassword')} <span className="optional">{t('queues.keepPassword')}</span>
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
          <ErrorMessage message={errorKey ? t(errorKey) : ''} />
          <div className="dialog-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? t('queues.saving') : t('queues.save')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

interface ArchiveEventDialogProps {
  detail: AdminQueueDetail | null;
  busy: boolean;
  errorKey: string;
  confirmationName: string;
  onConfirmationNameChange: (name: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function ArchiveEventDialog({
  detail,
  busy,
  errorKey,
  confirmationName,
  onConfirmationNameChange,
  onClose,
  onConfirm,
}: ArchiveEventDialogProps) {
  const { t } = useAppI18n();
  if (!detail) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
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
            onChange={event => onConfirmationNameChange(event.target.value)}
          />
        </label>
        <ErrorMessage message={errorKey ? t(errorKey) : ''} />
        <div className="dialog-actions">
          <button className="button ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="button danger"
            disabled={busy || confirmationName !== detail.queue.name}
            onClick={onConfirm}
          >
            {busy ? t('queues.archiving') : t('queues.archiveTitle')}
          </button>
        </div>
      </section>
    </div>
  );
}
