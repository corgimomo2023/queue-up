import { EntitySchema } from 'typeorm';
import type { ActorType, AuditAction } from '../../../domain/constants';

export interface AuditLogRow {
  id: number;
  queue_id: number | null;
  customer_id: number | null;
  actor_type: ActorType;
  action: AuditAction;
  metadata_json: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export const AuditLogEntity = new EntitySchema<AuditLogRow>({
  name: 'AuditLog',
  tableName: 'audit_logs',
  columns: {
    id: { type: Number, primary: true, generated: true },
    queue_id: { type: Number, nullable: true },
    customer_id: { type: Number, nullable: true },
    actor_type: { type: String },
    action: { type: String },
    metadata_json: { type: String, default: '{}' },
    ip_address: { type: String, nullable: true },
    user_agent: { type: String, nullable: true },
    created_at: { type: String, default: () => 'CURRENT_TIMESTAMP' },
  },
  indices: [{ name: 'idx_audit_logs_queue_created', columns: ['queue_id', 'created_at', 'id'] }],
});
