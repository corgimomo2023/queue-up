import { type PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { createInstance, type i18n, type Resource } from 'i18next';
import { I18nextProvider, initReactI18next, useTranslation } from 'react-i18next';
import enUS from './en-US';
import zhTW from './zh-TW';
import { locales, type AppLocale } from './config';
import { I18nContext, type AppTranslate } from './context';

const resources = {
  'en-US': { translation: enUS },
  'zh-TW': { translation: zhTW },
} as const;
const localeKey = 'nextq-locale';

function detectLocale(): AppLocale {
  const saved = localStorage.getItem(localeKey);
  if (locales.includes(saved as AppLocale)) return saved as AppLocale;
  const browser = navigator.language.toLowerCase();
  if (browser.startsWith('zh')) return 'zh-TW';
  return 'en-US';
}

function createI18n(locale: AppLocale): i18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    resources: resources as unknown as Resource,
    lng: locale,
    fallbackLng: 'en-US',
    supportedLngs: [...locales],
    interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
    initAsync: false,
  });
  return instance;
}

function TranslationBridge({
  locale,
  setLocale,
  children,
}: PropsWithChildren<{ locale: AppLocale; setLocale: (locale: AppLocale) => void }>) {
  const { t: translate } = useTranslation();
  const value = useMemo(
    () => ({ locale, setLocale, t: translate as AppTranslate }),
    [locale, setLocale, translate],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function AppI18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<AppLocale>(detectLocale);
  const [instance] = useState(() => createI18n(locale));
  const setLocale = (nextLocale: AppLocale) => {
    localStorage.setItem(localeKey, nextLocale);
    void instance.changeLanguage(nextLocale);
    setLocaleState(nextLocale);
  };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nextProvider i18n={instance}>
      <TranslationBridge locale={locale} setLocale={setLocale}>
        {children}
      </TranslationBridge>
    </I18nextProvider>
  );
}
