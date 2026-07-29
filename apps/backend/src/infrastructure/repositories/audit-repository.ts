import type { ActorType, AuditAction } from '../../domain/constants';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import type { RepositoryProvider } from './repository-provider';

export interface AuditRecord {
  actorType: ActorType;
  action: AuditAction;
  queueId?: number;
  customerId?: number;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export type AuditRequestFields = Pick<AuditRecord, 'ipAddress' | 'userAgent'>;

export function createAuditRepository(provider: RepositoryProvider) {
  const repository = provider.getRepository(AuditLogEntity);

  const record = async (entry: AuditRecord): Promise<void> => {
    await repository.insert({
      queue_id: entry.queueId ?? null,
      customer_id: entry.customerId ?? null,
      actor_type: entry.actorType,
      action: entry.action,
      metadata_json: JSON.stringify(entry.metadata ?? {}),
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
    });
  };

  return { record };
}

export type AuditRepository = ReturnType<typeof createAuditRepository>;
