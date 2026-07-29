import 'reflect-metadata';
import type Database from 'better-sqlite3';
import { DataSource } from 'typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';
import { CustomerEntity } from './entities/customer.entity';
import { QueueEntity } from './entities/queue.entity';
import { InitialSchema1785360000000 } from './migrations/1785360000000-initial-schema';

export interface PersistenceContext {
  dataSource: DataSource;
  database: Database.Database;
}

export async function initializePersistence(dbPath: string): Promise<PersistenceContext> {
  let database: Database.Database | undefined;
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: dbPath,
    enableWAL: true,
    synchronize: false,
    migrationsRun: true,
    migrations: [InitialSchema1785360000000],
    entities: [QueueEntity, CustomerEntity, AuditLogEntity],
    prepareDatabase(connection: Database.Database) {
      database = connection;
      connection.pragma('foreign_keys = ON');
    },
  });

  await dataSource.initialize();
  if (!database) throw new Error('TypeORM did not provide the SQLite connection');
  return { dataSource, database };
}
