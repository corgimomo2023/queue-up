import { useState } from 'react';
import { useAppI18n } from '../../../i18n/context';

export function PageSetupFields({
  defaultName = '',
  defaultDescription = '',
  logoUrl = null,
  previewUrl = '',
  onLogoChange,
  onRemoveLogo,
}: {
  defaultName?: string;
  defaultDescription?: string | null;
  logoUrl?: string | null;
  previewUrl?: string;
  onLogoChange(file: File | null): void;
  onRemoveLogo?: () => void;
}) {
  const { t } = useAppI18n();
  const [name, setName] = useState(defaultName);
  const visibleLogo = previewUrl || logoUrl;

  return (
    <fieldset className="page-setup-fields">
      <legend className="sr-only">{t('queues.pageSetup')}</legend>
      <h3>{t('queues.pageSetup')}</h3>
      <label>
        {t('queues.eventName')}
        <input
          name="name"
          required
          maxLength={100}
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder={t('queues.eventNamePlaceholder')}
        />
      </label>
      <label>
        {t('queues.eventDescription')} <span className="optional">{t('common.optional')}</span>
        <textarea
          aria-label={t('queues.eventDescription')}
          name="description"
          maxLength={500}
          rows={4}
          defaultValue={defaultDescription ?? ''}
          placeholder={t('queues.descriptionPlaceholder')}
        />
      </label>
      <label>
        {t('queues.eventLogo')} <span className="optional">{t('common.optional')}</span>
        <input
          aria-label={t('queues.eventLogo')}
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={event => onLogoChange(event.target.files?.[0] ?? null)}
        />
      </label>
      <p className="muted">{t('queues.logoHint')}</p>
      {visibleLogo && (
        <div className="logo-preview">
          <img
            src={visibleLogo}
            alt={t('branding.previewAlt', { name: name || t('common.event') })}
          />
          {logoUrl && onRemoveLogo && (
            <button type="button" className="button small ghost" onClick={onRemoveLogo}>
              {t('queues.removeLogo')}
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}
