import { EntitySchema } from 'typeorm';
import type { CustomerRow } from '../../../types';

export const CustomerTable = 'customers';

export const CustomerEntity = new EntitySchema<CustomerRow>({
  name: 'Customer',
  tableName: CustomerTable,
  columns: {
    id: { type: Number, primary: true, generated: true },
    queue_id: { type: Number },
    name: { type: String },
    phone: { type: String, nullable: true },
    message: { type: String, nullable: true },
    joined_at: { type: String, default: () => 'CURRENT_TIMESTAMP' },
    status: { type: String, default: 'waiting' },
    token_hash: { type: String, unique: true },
    ended_at: { type: String, nullable: true },
    ended_reason: { type: String, nullable: true },
  },
  indices: [{ name: 'idx_customers_queue_status', columns: ['queue_id', 'status', 'id'] }],
});
