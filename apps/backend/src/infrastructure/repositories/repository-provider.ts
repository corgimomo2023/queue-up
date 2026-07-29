import type { DataSource, EntityManager } from 'typeorm';

export type RepositoryProvider = DataSource | EntityManager;
