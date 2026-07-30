import type express from 'express';
import type Database from 'better-sqlite3';
import type {
  CustomerActorType,
  CustomerEndReason as CustomerEndReasonValue,
  CustomerStatus as CustomerStatusValue,
  StaffAdminActorType,
  VendorAdminActorType,
} from './domain/constants';

export interface AppOptions {
  dbPath: string;
  sessionSecret: string;
  superAdminKey?: string;
  seedEmail?: string;
  seedPhone?: string;
  secureCookie?: boolean;
  rateLimit?: boolean;
  staticDir?: string;
  publicOrigin?: string;
  assetDir?: string;
  now?: () => Date;
}

export interface AppContext {
  app: express.Express;
  db: Database.Database;
  close(): Promise<void>;
}

export type QueueRow = {
  id: number;
  slug: string;
  name: string;
  email_hash: string | null;
  phone_hash: string | null;
  password_hash: string | null;
  created_at: string;
  start_at: string;
  end_at: string | null;
  removed_at: string | null;
  description: string | null;
  logo_path: string | null;
};

export type CustomerRow = {
  id: number;
  queue_id: number;
  name: string;
  phone: string | null;
  message: string | null;
  joined_at: string;
  status: CustomerStatusValue;
  token_hash: string;
  ended_at: string | null;
  ended_reason: CustomerEndReasonValue | null;
};

export type Actor =
  | { type: VendorAdminActorType }
  | { type: StaffAdminActorType; queue: QueueRow }
  | { type: CustomerActorType; queue: QueueRow; customer: CustomerRow };
