import { createContext, useContext } from 'react';
import type { AppLocale } from './config';
import enUS from './en-US';

export type I18nValues = Record<string, string | number | Date>;
export type AppTranslate = (key: string, values?: I18nValues) => string;

function resolvePath(source: unknown, key: string): string | undefined {
  let value: unknown = source;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

function fallbackTranslate(key: string, values: I18nValues = {}) {
  const template = resolvePath(enUS, key) ?? key;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export const I18nContext = createContext<{
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: AppTranslate;
}>({
  locale: 'en-US',
  setLocale: () => undefined,
  t: fallbackTranslate,
});

export function useAppI18n() {
  return useContext(I18nContext);
}
