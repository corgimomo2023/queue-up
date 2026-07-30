import { apiRequest } from './client';
import type {
  AdminQueueDetail,
  AuditResponse,
  QueueInfo,
  SuperAdminOverview,
  TicketStatus,
  VendorDashboard,
} from '../types';

const withSignal = (signal?: AbortSignal): RequestInit => (signal ? { signal } : {});

export const queueApi = {
  get(queueId: string, signal?: AbortSignal) {
    return apiRequest<QueueInfo>(`/api/queues/${queueId}`, withSignal(signal));
  },
  ticketStatus(queueId: string, leaveToken: string, signal?: AbortSignal) {
    return apiRequest<TicketStatus>(
      `/api/queues/${queueId}/status?token=${encodeURIComponent(leaveToken)}`,
      withSignal(signal),
    );
  },
};

export const vendorApi = {
  dashboard(queueId: string, signal?: AbortSignal) {
    return apiRequest<VendorDashboard>(`/api/vendor/${queueId}`, withSignal(signal));
  },
};

export const adminApi = {
  overview(status: 'active' | 'removed' = 'active', signal?: AbortSignal) {
    const suffix = status === 'removed' ? '?status=removed' : '';
    return apiRequest<SuperAdminOverview>(`/api/super-admin/overview${suffix}`, withSignal(signal));
  },
  audit(signal?: AbortSignal) {
    return apiRequest<AuditResponse>('/api/super-admin/audit?limit=100', withSignal(signal));
  },
  queue(queueId: string, signal?: AbortSignal) {
    return apiRequest<AdminQueueDetail>(`/api/super-admin/queues/${queueId}`, withSignal(signal));
  },
};
