import type { DataSource } from 'typeorm';
import { ActorType, AuditAction, CustomerEndReason, CustomerStatus } from '../../domain/constants';
import {
  createAuditRepository,
  type AuditRequestFields,
} from '../../infrastructure/repositories/audit-repository';
import { createCustomerRepository } from '../../infrastructure/repositories/customer-repository';
import type { CustomerRow } from '../../types';

export interface JoinQueueCommand {
  queueId: number;
  name: string;
  phone: string | null;
  message: string | null;
  tokenHash: string;
  audit: AuditRequestFields;
}

export function createCustomerCommandService(dataSource: DataSource) {
  const joinQueue = (command: JoinQueueCommand): Promise<CustomerRow> =>
    dataSource.transaction(async manager => {
      const customers = createCustomerRepository(manager);
      const audit = createAuditRepository(manager);
      const customer = await customers.create({
        queueId: command.queueId,
        name: command.name,
        phone: command.phone,
        message: command.message,
        tokenHash: command.tokenHash,
      });
      await audit.record({
        actorType: ActorType.Customer,
        action: AuditAction.CustomerJoined,
        queueId: command.queueId,
        customerId: customer.id,
        metadata: { name: customer.name },
        ...command.audit,
      });
      return customer;
    });

  const leaveQueue = (
    queueId: number,
    customerId: number,
    endedAt: string,
    auditFields: AuditRequestFields,
  ): Promise<boolean> =>
    dataSource.transaction(async manager => {
      const customers = createCustomerRepository(manager);
      const audit = createAuditRepository(manager);
      const changed = await customers.endCustomer(
        customerId,
        CustomerStatus.Left,
        CustomerEndReason.CustomerLeft,
        endedAt,
      );
      if (changed) {
        await audit.record({
          actorType: ActorType.Customer,
          action: AuditAction.CustomerLeft,
          queueId,
          customerId,
          ...auditFields,
        });
      }
      return changed;
    });

  const serveNext = (
    queueId: number,
    endedAt: string,
    auditFields: AuditRequestFields,
  ): Promise<CustomerRow | null> =>
    dataSource.transaction(async manager => {
      const customers = createCustomerRepository(manager);
      const audit = createAuditRepository(manager);
      const customer = await customers.findNextWaiting(queueId);
      if (!customer) return null;
      const changed = await customers.endCustomer(
        customer.id,
        CustomerStatus.Served,
        CustomerEndReason.Served,
        endedAt,
      );
      if (!changed) return null;
      await audit.record({
        actorType: ActorType.ClientAdmin,
        action: AuditAction.CustomerServed,
        queueId,
        customerId: customer.id,
        metadata: { name: customer.name },
        ...auditFields,
      });
      return customer;
    });

  const removeWaiting = (
    queueId: number,
    customerId: number,
    endedAt: string,
    auditFields: AuditRequestFields,
  ): Promise<boolean> =>
    dataSource.transaction(async manager => {
      const customers = createCustomerRepository(manager);
      const audit = createAuditRepository(manager);
      const removed = await customers.removeWaiting(
        customerId,
        queueId,
        CustomerEndReason.VendorRemoved,
        endedAt,
      );
      if (removed) {
        await audit.record({
          actorType: ActorType.ClientAdmin,
          action: AuditAction.CustomerRemoved,
          queueId,
          customerId,
          ...auditFields,
        });
      }
      return removed;
    });

  const clearWaiting = (
    queueId: number,
    endedAt: string,
    auditFields: AuditRequestFields,
  ): Promise<number> =>
    dataSource.transaction(async manager => {
      const customers = createCustomerRepository(manager);
      const audit = createAuditRepository(manager);
      const removed = await customers.removeAllWaiting(
        queueId,
        CustomerEndReason.QueueCleared,
        endedAt,
      );
      await audit.record({
        actorType: ActorType.ClientAdmin,
        action: AuditAction.QueueCleared,
        queueId,
        metadata: { removed },
        ...auditFields,
      });
      return removed;
    });

  const finalizeWaiting = (
    queueId: number,
    endedAt: string,
    reason: typeof CustomerEndReason.QueuePeriodEnded | typeof CustomerEndReason.QueueSoftRemoved,
    auditFields: AuditRequestFields,
  ): Promise<number> =>
    dataSource.transaction(async manager => {
      const customers = createCustomerRepository(manager);
      const audit = createAuditRepository(manager);
      const removed = await customers.finalizeWaiting(queueId, endedAt, reason);
      if (removed) {
        await audit.record({
          actorType: ActorType.System,
          action:
            reason === CustomerEndReason.QueuePeriodEnded
              ? AuditAction.QueuePeriodEnded
              : AuditAction.QueueSoftRemoved,
          queueId,
          metadata: { removed },
          ...auditFields,
        });
      }
      return removed;
    });

  return { joinQueue, leaveQueue, serveNext, removeWaiting, clearWaiting, finalizeWaiting };
}

export type CustomerCommandService = ReturnType<typeof createCustomerCommandService>;
