import { describe, expect, it } from 'vitest';
import { hongKongEndDateToUtc, hongKongLocalToUtc, queueLifecycle } from '../src/queue-period';

const now = new Date('2026-08-10T12:00:00.000Z');
const past = '2026-08-10T11:59:59.999Z';
const exactNow = now.toISOString();
const future = '2026-08-10T12:00:00.001Z';

describe('Hong Kong queue periods', () => {
  it('converts a Hong Kong local minute to a UTC ISO instant', () => {
    expect(hongKongLocalToUtc('2026-08-01T09:30')).toBe('2026-08-01T01:30:00.000Z');
  });

  it('converts a Hong Kong end date to the inclusive end-of-day UTC instant', () => {
    expect(hongKongEndDateToUtc('2026-08-10')).toBe('2026-08-10T15:59:59.999Z');
  });

  it('derives scheduled, active, and ended lifecycle states with an inclusive end instant', () => {
    expect(queueLifecycle({ startAt: future, endAt: null }, now)).toBe('scheduled');
    expect(queueLifecycle({ startAt: past, endAt: null }, now)).toBe('active');
    expect(queueLifecycle({ startAt: past, endAt: exactNow }, now)).toBe('active');
    expect(queueLifecycle({ startAt: past, endAt: past }, now)).toBe('ended');
  });

  it.each([
    '2026-8-01T09:30',
    '2026-08-01 09:30',
    '2026-02-29T09:30',
    '2026-04-31T09:30',
    '2026-08-01T24:00',
    '2026-08-01T09:60',
  ])('rejects malformed or impossible Hong Kong local minute %s', value => {
    expect(() => hongKongLocalToUtc(value)).toThrow(RangeError);
  });

  it.each(['2026-8-10', '2026-02-29', '2026-04-31', '2026-08-10T00:00'])(
    'rejects malformed or impossible Hong Kong end date %s',
    value => {
      expect(() => hongKongEndDateToUtc(value)).toThrow(RangeError);
    },
  );

  it('rejects a queue period whose end instant is earlier than its start', () => {
    expect(() => queueLifecycle({ startAt: exactNow, endAt: past }, now)).toThrow(RangeError);
  });
});
