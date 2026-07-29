export const dateTime = (value: string | null, locale = 'en-US') =>
  value
    ? new Date(value).toLocaleString(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Hong_Kong',
        hour12: false,
      })
    : '';
export const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
