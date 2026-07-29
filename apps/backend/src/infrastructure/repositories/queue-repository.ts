import { IsNull } from 'typeorm';
import { QueueEntity } from '../database/entities/queue.entity';
import type { QueueRow } from '../../types';
import type { RepositoryProvider } from './repository-provider';

export interface CreateQueueRecord {
  slug: string;
  name: string;
  passwordHash: string;
  startAt: string;
  endAt: string | null;
  description: string | null;
}

export interface UpdateQueueRecord {
  name: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  passwordHash: string | null;
}

export interface SeedQueueRecord {
  slug: string;
  name: string;
  emailHash: string | null;
  phoneHash: string | null;
}

export function createQueueRepository(provider: RepositoryProvider) {
  const repository = provider.getRepository(QueueEntity);

  const findBySlug = (slug: string): Promise<QueueRow | null> => repository.findOneBy({ slug });

  const findAllLive = (): Promise<QueueRow[]> =>
    repository.find({ where: { removed_at: IsNull() } });

  const findRemovalState = async (id: number): Promise<{ removed_at: string | null } | null> => {
    const queue = await repository.findOne({ select: { removed_at: true }, where: { id } });
    return queue ? { removed_at: queue.removed_at } : null;
  };

  const create = async (record: CreateQueueRecord): Promise<QueueRow> =>
    repository.save(
      repository.create({
        slug: record.slug,
        name: record.name,
        password_hash: record.passwordHash,
        start_at: record.startAt,
        end_at: record.endAt,
        description: record.description,
      }),
    );

  const insertSeedIfMissing = async (record: SeedQueueRecord): Promise<void> => {
    await repository
      .createQueryBuilder()
      .insert()
      .values({
        slug: record.slug,
        name: record.name,
        email_hash: record.emailHash,
        phone_hash: record.phoneHash,
      })
      .orIgnore()
      .updateEntity(false)
      .execute();
  };

  const restore = async (id: number): Promise<boolean> =>
    (await repository.update({ id }, { removed_at: null })).affected === 1;

  const updateEditable = async (id: number, record: UpdateQueueRecord): Promise<boolean> => {
    const changes: Partial<QueueRow> = {
      name: record.name,
      description: record.description,
      start_at: record.startAt,
      end_at: record.endAt,
    };
    if (record.passwordHash) changes.password_hash = record.passwordHash;
    return (await repository.update({ id, removed_at: IsNull() }, changes)).affected === 1;
  };

  const archive = async (id: number, removedAt: string): Promise<boolean> =>
    (await repository.update({ id, removed_at: IsNull() }, { removed_at: removedAt })).affected ===
    1;

  return {
    findBySlug,
    findAllLive,
    findRemovalState,
    create,
    insertSeedIfMissing,
    updateEditable,
    archive,
    restore,
  };
}

export type QueueRepository = ReturnType<typeof createQueueRepository>;
