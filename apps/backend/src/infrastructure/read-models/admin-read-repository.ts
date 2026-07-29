import { In, IsNull, Not, type DataSource } from 'typeorm';
import {
  CustomerStatus,
  type ActorType,
  type AuditAction,
  type CustomerEndReason,
  type CustomerStatus as CustomerStatusValue,
} from '../../domain/constants';
import type { QueueRow } from '../../types';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { CustomerEntity, CustomerTable } from '../database/entities/customer.entity';
import { QueueEntity, QueueTable } from '../database/entities/queue.entity';

export interface QueueOverviewRow extends QueueRow {
  queueId: string;
  createdAt: string;
  waitingCount: number;
  servedCount: number;
  totalCustomers: number;
  lastActivityAt: string | null;
}

export interface AdminSummary {
  queues: number;
  removedQueues: number;
  waiting: number;
  served: number;
  totalCustomers: number;
}

export interface CustomerHistoryRow {
  customerId: number;
  name: string;
  phone: string | null;
  message: string | null;
  joinedAt: string;
  status: CustomerStatusValue;
  endedAt: string | null;
  endedReason: CustomerEndReason | null;
}

export interface CustomerHistoryCounts {
  waiting: number;
  served: number;
  ended: number;
  total: number;
}

export interface AuditEventRow {
  id: number;
  queueId: string | null;
  queueName: string | null;
  customerId: number | null;
  actorType: ActorType;
  action: AuditAction;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface RawAuditEvent extends Omit<AuditEventRow, 'metadata'> {
  metadataJson: string;
}

export function createAdminReadRepository(dataSource: DataSource) {
  const queues = dataSource.getRepository(QueueEntity);
  const customers = dataSource.getRepository(CustomerEntity);
  const auditLogs = dataSource.getRepository(AuditLogEntity);

  const listQueueOverview = (showRemoved: boolean): Promise<QueueOverviewRow[]> =>
    queues
      .createQueryBuilder('queue')
      .leftJoin(CustomerTable, 'customer', 'customer.queue_id = queue.id')
      .select('queue.id', 'id')
      .addSelect('queue.slug', 'slug')
      .addSelect('queue.slug', 'queueId')
      .addSelect('queue.name', 'name')
      .addSelect('queue.email_hash', 'email_hash')
      .addSelect('queue.phone_hash', 'phone_hash')
      .addSelect('queue.password_hash', 'password_hash')
      .addSelect('queue.description', 'description')
      .addSelect('queue.logo_path', 'logo_path')
      .addSelect('queue.created_at', 'created_at')
      .addSelect('queue.created_at', 'createdAt')
      .addSelect('queue.start_at', 'start_at')
      .addSelect('queue.end_at', 'end_at')
      .addSelect('queue.removed_at', 'removed_at')
      .addSelect('SUM(CASE WHEN customer.status = :waiting THEN 1 ELSE 0 END)', 'waitingCount')
      .addSelect('SUM(CASE WHEN customer.status = :served THEN 1 ELSE 0 END)', 'servedCount')
      .addSelect('COUNT(customer.id)', 'totalCustomers')
      .addSelect('MAX(customer.joined_at)', 'lastActivityAt')
      .where(showRemoved ? 'queue.removed_at IS NOT NULL' : 'queue.removed_at IS NULL')
      .setParameters({ waiting: CustomerStatus.Waiting, served: CustomerStatus.Served })
      .groupBy('queue.id')
      .orderBy('COALESCE(MAX(customer.joined_at), queue.created_at)', 'DESC')
      .getRawMany<QueueOverviewRow>();

  const getSummary = async (): Promise<AdminSummary> => {
    const [liveQueues, removedQueues, waiting, served, totalCustomers] = await Promise.all([
      queues.countBy({ removed_at: IsNull() }),
      queues.countBy({ removed_at: Not(IsNull()) }),
      customers.countBy({ status: CustomerStatus.Waiting }),
      customers.countBy({ status: CustomerStatus.Served }),
      customers.count(),
    ]);
    return { queues: liveQueues, removedQueues, waiting, served, totalCustomers };
  };

  const listCustomerHistory = async (
    queueId: number,
    limit: number,
  ): Promise<CustomerHistoryRow[]> =>
    (
      await customers.find({
        where: { queue_id: queueId },
        order: { id: 'DESC' },
        take: limit,
      })
    ).map(customer => ({
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      message: customer.message,
      joinedAt: customer.joined_at,
      status: customer.status,
      endedAt: customer.ended_at,
      endedReason: customer.ended_reason,
    }));

  const getCustomerHistoryCounts = async (queueId: number): Promise<CustomerHistoryCounts> => {
    const [waiting, served, ended, total] = await Promise.all([
      customers.countBy({ queue_id: queueId, status: CustomerStatus.Waiting }),
      customers.countBy({ queue_id: queueId, status: CustomerStatus.Served }),
      customers.countBy({
        queue_id: queueId,
        status: In([CustomerStatus.Left, CustomerStatus.Removed]),
      }),
      customers.countBy({ queue_id: queueId }),
    ]);
    return { waiting, served, ended, total };
  };

  const listAuditEvents = async (limit: number, queueSlug?: string): Promise<AuditEventRow[]> => {
    const query = auditLogs
      .createQueryBuilder('audit')
      .leftJoin(QueueTable, 'queue', 'queue.id = audit.queue_id')
      .select('audit.id', 'id')
      .addSelect('queue.slug', 'queueId')
      .addSelect('queue.name', 'queueName')
      .addSelect('audit.customer_id', 'customerId')
      .addSelect('audit.actor_type', 'actorType')
      .addSelect('audit.action', 'action')
      .addSelect('audit.metadata_json', 'metadataJson')
      .addSelect('audit.ip_address', 'ipAddress')
      .addSelect('audit.user_agent', 'userAgent')
      .addSelect('audit.created_at', 'createdAt')
      .orderBy('audit.id', 'DESC')
      .take(limit);
    if (queueSlug) query.where('queue.slug = :queueSlug', { queueSlug });
    return (await query.getRawMany<RawAuditEvent>()).map(({ metadataJson, ...event }) => {
      try {
        return { ...event, metadata: JSON.parse(metadataJson) as unknown };
      } catch {
        return { ...event, metadata: {} };
      }
    });
  };

  return {
    listQueueOverview,
    getSummary,
    listCustomerHistory,
    getCustomerHistoryCounts,
    listAuditEvents,
  };
}

export type AdminReadRepository = ReturnType<typeof createAdminReadRepository>;
