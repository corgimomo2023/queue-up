export const locales = ['en-US', 'zh-TW'] as const;
export type AppLocale = (typeof locales)[number];
