import type { TicketStatus } from './types';

export function reconcileTicketStatus(
  current: TicketStatus | null,
  incoming: TicketStatus,
): TicketStatus {
  if (
    current?.customerId === incoming.customerId &&
    current.status === 'served' &&
    incoming.status === 'waiting'
  ) {
    return current;
  }
  return incoming;
}
