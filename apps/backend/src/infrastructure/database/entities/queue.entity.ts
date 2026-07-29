import { EntitySchema } from 'typeorm';
import type { QueueRow } from '../../../types';

export const QueueTable = 'queues';

export const QueueEntity = new EntitySchema<QueueRow>({
  name: 'Queue',
  tableName: QueueTable,
  columns: {
    id: { type: Number, primary: true, generated: true },
    slug: { type: String, unique: true },
    name: { type: String },
    email_hash: { type: String, nullable: true },
    phone_hash: { type: String, nullable: true },
    password_hash: { type: String, nullable: true },
    created_at: { type: String, default: () => 'CURRENT_TIMESTAMP' },
    start_at: { type: String, default: () => 'CURRENT_TIMESTAMP' },
    end_at: { type: String, nullable: true },
    removed_at: { type: String, nullable: true },
    description: { type: String, nullable: true },
    logo_path: { type: String, nullable: true },
  },
});
