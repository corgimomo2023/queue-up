import { In, LessThanOrEqual } from 'typeorm';
import { CustomerStatus, type CustomerEndReason as EndReason } from '../../domain/constants';
import type { CustomerRow } from '../../types';
import { CustomerEntity } from '../database/entities/customer.entity';
import type { RepositoryProvider } from './repository-provider';

export function createCustomerRepository(provider: RepositoryProvider) {
  const repository = provider.getRepository(CustomerEntity);

  const findByTokenHash = (queueId: number, hash: string): Promise<CustomerRow | null> =>
    repository.findOneBy({
      queue_id: queueId,
      token_hash: hash,
      status: In([CustomerStatus.Waiting, CustomerStatus.Served]),
    });

  const waitingCount = (queueId: number): Promise<number> =>
    repository.countBy({ queue_id: queueId, status: CustomerStatus.Waiting });

  const create = async (input: {
    queueId: number;
    name: string;
    phone: string | null;
    message: string | null;
    tokenHash: string;
  }): Promise<CustomerRow> =>
    repository.save(
      repository.create({
        queue_id: input.queueId,
        name: input.name,
        phone: input.phone,
        message: input.message,
        token_hash: input.tokenHash,
        status: CustomerStatus.Waiting,
      }),
    );

  const listWaiting = async (queueId: number) =>
    (
      await repository.find({
        where: { queue_id: queueId, status: CustomerStatus.Waiting },
        order: { id: 'ASC' },
      })
    ).map(customer => ({
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      message: customer.message,
      joinedAt: customer.joined_at,
    }));

  const findNextWaiting = (queueId: number): Promise<CustomerRow | null> =>
    repository.findOne({
      where: { queue_id: queueId, status: CustomerStatus.Waiting },
      order: { id: 'ASC' },
    });

  const endCustomer = async (
    customerId: number,
    status: typeof CustomerStatus.Served | typeof CustomerStatus.Left,
    reason: EndReason,
    endedAt: string,
  ): Promise<boolean> =>
    (
      await repository.update(
        { id: customerId },
        { status, ended_at: endedAt, ended_reason: reason },
      )
    ).affected === 1;

  const removeWaiting = async (
    customerId: number,
    queueId: number,
    reason: EndReason,
    endedAt: string,
  ): Promise<boolean> =>
    (
      await repository.update(
        { id: customerId, queue_id: queueId, status: CustomerStatus.Waiting },
        { status: CustomerStatus.Removed, ended_at: endedAt, ended_reason: reason },
      )
    ).affected === 1;

  const removeAllWaiting = async (
    queueId: number,
    reason: EndReason,
    endedAt: string,
  ): Promise<number> =>
    (
      await repository.update(
        { queue_id: queueId, status: CustomerStatus.Waiting },
        { status: CustomerStatus.Removed, ended_at: endedAt, ended_reason: reason },
      )
    ).affected ?? 0;

  const waitingPosition = (queueId: number, customerId: number): Promise<number> =>
    repository.countBy({
      queue_id: queueId,
      status: CustomerStatus.Waiting,
      id: LessThanOrEqual(customerId),
    });

  const finalizeWaiting = (queueId: number, endedAt: string, reason: EndReason): Promise<number> =>
    removeAllWaiting(queueId, reason, endedAt);

  return {
    findByTokenHash,
    create,
    listWaiting,
    findNextWaiting,
    endCustomer,
    removeWaiting,
    removeAllWaiting,
    waitingCount,
    waitingPosition,
    finalizeWaiting,
  };
}

export type CustomerRepository = ReturnType<typeof createCustomerRepository>;
