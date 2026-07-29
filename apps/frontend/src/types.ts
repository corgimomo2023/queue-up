export type QueueLifecycle = 'scheduled' | 'active' | 'ended';
export type QueuePeriod = {
  startAt: string;
  endAt: string | null;
  lifecycleStatus: QueueLifecycle;
  timeZone: 'Asia/Hong_Kong';
  isRemoved: boolean;
  removedAt: string | null;
};

export type EventBranding = { name: string; description: string | null; logoUrl: string | null };
export type QueueInfo = { queueId: string; waitingCount: number } & EventBranding & QueuePeriod;
export type CreatedQueue = {
  queueId: string;
  vendorUrl: string;
  customerUrl: string;
} & EventBranding &
  QueuePeriod;
export type TicketStatus = {
  customerId: number;
  name: string;
  status: 'waiting' | 'served';
  position: number;
  peopleAhead: number;
  waitingCount: number;
  isNext: boolean;
  leaveToken?: string;
  queueStatus?: QueuePeriod;
};
export type VendorCustomer = {
  customerId: number;
  name: string;
  phone?: string;
  message?: string;
  joinedAt: string;
};
export type VendorDashboard = {
  queueId: string;
  waitingCount: number;
  customers: VendorCustomer[];
  customerUrl: string;
} & EventBranding &
  QueuePeriod;

export type AdminQueueSummary = {
  queueId: string;
  createdAt: string;
  waitingCount: number;
  servedCount: number;
  totalCustomers: number;
  lastActivityAt: string | null;
} & EventBranding &
  QueuePeriod;
export type SuperAdminOverview = {
  summary: {
    queues: number;
    removedQueues: number;
    scheduledQueues: number;
    activeQueues: number;
    endedQueues: number;
    waiting: number;
    served: number;
    totalCustomers: number;
  };
  queues: AdminQueueSummary[];
};
export type AdminCustomer = {
  customerId: number;
  name: string;
  phoneMasked: string | null;
  message: string | null;
  joinedAt: string;
  status: 'waiting' | 'served' | 'left' | 'removed';
  endedAt: string | null;
  endedReason: string | null;
};
export type AdminQueueDetail = {
  queue: { queueId: string; vendorUrl: string; customerUrl: string } & EventBranding & QueuePeriod;
  counts: { waiting: number; served: number; ended: number; total: number };
  customers: AdminCustomer[];
};
export type AuditEvent = {
  id: number;
  queueId: string | null;
  queueName: string | null;
  customerId: number | null;
  actorType: string;
  action: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};
export type AuditResponse = { events: AuditEvent[] };
