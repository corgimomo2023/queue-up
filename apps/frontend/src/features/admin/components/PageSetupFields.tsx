import { useState } from 'react';
import { useAppI18n } from '../../../i18n/context';
import { Button } from '../../../components/ui/Button';
import { FileUpload } from '../../../components/ui/FileUpload';
import { Input } from '../../../components/ui/Input';
import { Textarea } from '../../../components/ui/Textarea';

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
        <Input
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
        <Textarea
          aria-label={t('queues.eventDescription')}
          name="description"
          rows={4}
          maxLength={500}
          defaultValue={defaultDescription ?? ''}
          placeholder={t('queues.descriptionPlaceholder')}
        />
      </label>
      <FileUpload
        label={t('queues.eventLogo')}
        optionalLabel={t('common.optional')}
        buttonLabel={t('queues.chooseLogo')}
        emptyLabel={t('queues.noLogoSelected')}
        name="logo"
        accept="image/png,image/jpeg,image/webp"
        onFileChange={onLogoChange}
      />
      <p className="muted ui-field-hint">{t('queues.logoHint')}</p>
      {visibleLogo && (
        <div className="logo-preview">
          <img
            src={visibleLogo}
            alt={t('branding.previewAlt', { name: name || t('common.event') })}
          />
          {logoUrl && onRemoveLogo && (
            <Button variant="ghost" size="small" onClick={onRemoveLogo}>
              {t('queues.removeLogo')}
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}
