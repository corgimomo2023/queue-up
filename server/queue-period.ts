export const BUSINESS_TIME_ZONE = 'Asia/Hong_Kong';
export type QueueLifecycle = 'scheduled' | 'active' | 'ended';

export class EventPeriodError extends RangeError {
  readonly status = 400;
  readonly code = 'INVALID_EVENT_PERIOD';
}

const HONG_KONG_UTC_OFFSET_HOURS = 8;
const LOCAL_MINUTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return monthLengths[month - 1] ?? 0;
}

function assertValidDate(year: number, month: number, day: number, value: string): void {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new EventPeriodError(`Invalid date: ${value}`);
  }
}

function utcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  millisecond = 0,
): string {
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, millisecond);
  return instant.toISOString();
}

export function hongKongLocalToUtc(value: string): string {
  const match = LOCAL_MINUTE_PATTERN.exec(value);
  if (match === null) throw new EventPeriodError(`Invalid Hong Kong local minute: ${value}`);

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  assertValidDate(year, month, day, value);
  if (hour > 23 || minute > 59) {
    throw new EventPeriodError(`Invalid Hong Kong local minute: ${value}`);
  }

  return utcIso(year, month, day, hour - HONG_KONG_UTC_OFFSET_HOURS, minute);
}

export function hongKongEndDateToUtc(value: string): string {
  const match = DATE_PATTERN.exec(value);
  if (match === null) throw new EventPeriodError(`Invalid Hong Kong end date: ${value}`);

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  assertValidDate(year, month, day, value);
  return utcIso(year, month, day, 23 - HONG_KONG_UTC_OFFSET_HOURS, 59, 59, 999);
}

function instantMilliseconds(value: string, label: string): number {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) throw new EventPeriodError(`Invalid ${label}: ${value}`);
  return milliseconds;
}

export function queueLifecycle(
  period: { startAt: string; endAt: string | null },
  now: Date,
): QueueLifecycle {
  const startMs = instantMilliseconds(period.startAt, 'queue start instant');
  const endMs = period.endAt === null
    ? null
    : instantMilliseconds(period.endAt, 'queue end instant');
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) throw new EventPeriodError('Invalid current instant');
  if (endMs !== null && endMs < startMs) {
    throw new EventPeriodError('Queue end instant cannot be earlier than its start instant');
  }
  if (nowMs < startMs) return 'scheduled';
  if (endMs !== null && nowMs > endMs) return 'ended';
  return 'active';
}
