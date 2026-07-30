import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';

export const queryKeys = {
  queue: (queueId: string) => ['queue', queueId] as const,
  ticket: (queueId: string, customerId: number) => ['ticket', queueId, customerId] as const,
  vendor: (queueId: string) => ['vendor', queueId] as const,
  adminOverview: (status: 'active' | 'removed' = 'active') =>
    ['admin', 'overview', status] as const,
  adminAudit: () => ['admin', 'audit'] as const,
  adminQueue: (queueId: string) => ['admin', 'queue', queueId] as const,
};

export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) return error.status >= 500;
  return true;
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const appQueryClient = createAppQueryClient();
