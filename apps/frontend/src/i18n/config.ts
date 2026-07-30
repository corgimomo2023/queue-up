export const locales = ['en-US', 'zh-HK'] as const;
export type AppLocale = (typeof locales)[number];
