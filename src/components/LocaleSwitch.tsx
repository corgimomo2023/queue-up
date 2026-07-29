import { locales } from '../i18n/config';
import { useAppI18n } from '../i18n/context';

const labelKeys = { 'en-US': 'locale.enUS', 'zh-TW': 'locale.zhTW' } as const;

export function LocaleSwitch() {
  const { locale, setLocale, t } = useAppI18n();
  return <div className="locale-switch" role="group" aria-label={t('locale.label')}>
    {locales.map(option => <button
      key={option}
      type="button"
      className={option === locale ? 'active' : ''}
      aria-pressed={option === locale}
      onClick={() => setLocale(option)}
    >{t(labelKeys[option])}</button>)}
  </div>;
}
