import {
  ApiErrorCode,
  QueueLifecycleStatus,
  type QueueLifecycleStatus as Status,
} from '../constants';
import { daysInMonth, instantMilliseconds, utcIsoString } from '../../shared/datetime-utils';

export const BUSINESS_TIME_ZONE = 'Asia/Hong_Kong';

export class EventPeriodError extends RangeError {
  readonly status = 400;
  readonly code = ApiErrorCode.InvalidEventPeriod;
}

const HONG_KONG_UTC_OFFSET_HOURS = 8;
const LOCAL_MINUTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertValidDate(year: number, month: number, day: number, value: string): void {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new EventPeriodError(`Invalid date: ${value}`);
  }
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

  return utcIsoString(year, month, day, hour - HONG_KONG_UTC_OFFSET_HOURS, minute);
}

export function hongKongEndDateToUtc(value: string): string {
  const match = DATE_PATTERN.exec(value);
  if (match === null) throw new EventPeriodError(`Invalid Hong Kong end date: ${value}`);

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  assertValidDate(year, month, day, value);
  return utcIsoString(year, month, day, 23 - HONG_KONG_UTC_OFFSET_HOURS, 59, 59, 999);
}

function requireInstant(value: string, label: string): number {
  const milliseconds = instantMilliseconds(value);
  if (milliseconds === null) throw new EventPeriodError(`Invalid ${label}: ${value}`);
  return milliseconds;
}

export function queueLifecycle(
  period: { startAt: string; endAt: string | null },
  now: Date,
): Status {
  const startMs = requireInstant(period.startAt, 'queue start instant');
  const endMs = period.endAt === null ? null : requireInstant(period.endAt, 'queue end instant');
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) throw new EventPeriodError('Invalid current instant');
  if (endMs !== null && endMs < startMs) {
    throw new EventPeriodError('Queue end instant cannot be earlier than its start instant');
  }
  if (nowMs < startMs) return QueueLifecycleStatus.Scheduled;
  if (endMs !== null && nowMs > endMs) return QueueLifecycleStatus.Ended;
  return QueueLifecycleStatus.Active;
}

export type QueueLifecycle = Status;
