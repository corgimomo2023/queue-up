import type Database from 'better-sqlite3';
import type { DataSource } from 'typeorm';
import {
  ActorType,
  ApiErrorCode,
  AuditAction,
  CustomerEndReason,
  CustomerStatus,
} from '../../domain/constants';
import { EventAssetError } from '../../event-assets';
import {
  createAuditRepository,
  type AuditRequestFields,
} from '../../infrastructure/repositories/audit-repository';
import { createCustomerRepository } from '../../infrastructure/repositories/customer-repository';
import {
  createQueueRepository,
  type CreateQueueRecord,
} from '../../infrastructure/repositories/queue-repository';
import type { QueueRow } from '../../types';

export interface EditableEventValues {
  name: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  passwordHash: string | null;
}

export interface UpdateEventCommand {
  queue: QueueRow;
  values: EditableEventValues;
  finalizeEndedAt?: string;
  audit: AuditRequestFields;
}

export interface UpdateEventResult {
  queue: QueueRow;
  finalizedWaiting: number;
}

async function updateEditableOrThrow(
  queues: ReturnType<typeof createQueueRepository>,
  queue: QueueRow,
  values: EditableEventValues,
): Promise<void> {
  if (await queues.updateEditable(queue.id, values)) return;
  const latest = await queues.findRemovalState(queue.id);
  if (latest?.removed_at) {
    throw new EventAssetError(409, ApiErrorCode.EventArchived, 'Archived events cannot be edited');
  }
  throw new EventAssetError(
    409,
    ApiErrorCode.EventUpdateConflict,
    'Event changed; reload and retry',
  );
}

export function createEventManagementService(dataSource: DataSource) {
  const create = (record: CreateQueueRecord, auditFields: AuditRequestFields): Promise<QueueRow> =>
    dataSource.transaction(async manager => {
      const queues = createQueueRepository(manager);
      const audit = createAuditRepository(manager);
      const queue = await queues.create(record);
      await audit.record({
        actorType: ActorType.VendorAdmin,
        action: AuditAction.EventCreated,
        queueId: queue.id,
        metadata: {
          queueId: queue.slug,
          name: queue.name,
          startAt: queue.start_at,
          endAt: queue.end_at,
        },
        ...auditFields,
      });
      return queue;
    });

  const update = (command: UpdateEventCommand): Promise<UpdateEventResult> =>
    dataSource.transaction(async manager => {
      const queues = createQueueRepository(manager);
      const customers = createCustomerRepository(manager);
      const audit = createAuditRepository(manager);
      await updateEditableOrThrow(queues, command.queue, command.values);
      await audit.record({
        actorType: ActorType.VendorAdmin,
        action: AuditAction.EventUpdated,
        queueId: command.queue.id,
        metadata: {
          name: command.values.name,
          description: command.values.description,
          startAt: command.values.startAt,
          endAt: command.values.endAt,
        },
        ...command.audit,
      });
      let finalizedWaiting = 0;
      if (command.finalizeEndedAt) {
        finalizedWaiting = await customers.finalizeWaiting(
          command.queue.id,
          command.finalizeEndedAt,
          CustomerEndReason.QueuePeriodEnded,
        );
        if (finalizedWaiting) {
          await audit.record({
            actorType: ActorType.System,
            action: AuditAction.QueuePeriodEnded,
            queueId: command.queue.id,
            metadata: { removed: finalizedWaiting },
            ...command.audit,
          });
        }
      }
      const updated = await queues.findBySlug(command.queue.slug);
      if (!updated) throw new Error('Updated event could not be loaded');
      return { queue: updated, finalizedWaiting };
    });

  const archive = async (
    queueId: number,
    removedAt: string,
    auditFields: AuditRequestFields,
  ): Promise<number> =>
    dataSource.transaction(async manager => {
      const queues = createQueueRepository(manager);
      const customers = createCustomerRepository(manager);
      const audit = createAuditRepository(manager);
      if (!(await queues.archive(queueId, removedAt))) {
        throw new EventAssetError(
          409,
          ApiErrorCode.EventAlreadyArchived,
          'Event is already archived',
        );
      }
      const removedWaiting = await customers.finalizeWaiting(
        queueId,
        removedAt,
        CustomerEndReason.QueueSoftRemoved,
      );
      await audit.record({
        actorType: ActorType.VendorAdmin,
        action: AuditAction.EventArchived,
        queueId,
        metadata: { removedWaiting, removedAt },
        ...auditFields,
      });
      return removedWaiting;
    });

  const restore = (queue: QueueRow, auditFields: AuditRequestFields): Promise<QueueRow> =>
    dataSource.transaction(async manager => {
      const queues = createQueueRepository(manager);
      const audit = createAuditRepository(manager);
      if (!(await queues.restore(queue.id))) {
        throw new EventAssetError(409, ApiErrorCode.EventNotArchived, 'Event is not archived');
      }
      await audit.record({
        actorType: ActorType.VendorAdmin,
        action: AuditAction.EventRestored,
        queueId: queue.id,
        metadata: { previousRemovedAt: queue.removed_at },
        ...auditFields,
      });
      const restored = await queues.findBySlug(queue.slug);
      if (!restored) throw new Error('Restored event could not be loaded');
      return restored;
    });

  return { create, update, archive, restore };
}

export type EventManagementService = ReturnType<typeof createEventManagementService>;

export function updateEditableEvent(
  db: Database.Database,
  queue: QueueRow,
  values: EditableEventValues,
): void {
  const result = db
    .prepare(
      `UPDATE queues SET name=?,description=?,start_at=?,end_at=?,password_hash=COALESCE(?,password_hash)
      WHERE id=? AND removed_at IS NULL`,
    )
    .run(
      values.name,
      values.description,
      values.startAt,
      values.endAt,
      values.passwordHash,
      queue.id,
    );
  if (result.changes === 1) return;

  const latest = db.prepare('SELECT removed_at FROM queues WHERE id=?').get(queue.id) as
    { removed_at: string | null } | undefined;
  if (latest?.removed_at) {
    throw new EventAssetError(409, ApiErrorCode.EventArchived, 'Archived events cannot be edited');
  }
  throw new EventAssetError(
    409,
    ApiErrorCode.EventUpdateConflict,
    'Event changed; reload and retry',
  );
}

export function archiveEvent(
  db: Database.Database,
  queueId: number,
  removedAt: string,
  writeAudit: (removedWaiting: number) => void,
): number {
  return db.transaction(() => {
    const archived = db
      .prepare('UPDATE queues SET removed_at=? WHERE id=? AND removed_at IS NULL')
      .run(removedAt, queueId);
    if (archived.changes !== 1) {
      throw new EventAssetError(
        409,
        ApiErrorCode.EventAlreadyArchived,
        'Event is already archived',
      );
    }
    const tickets = db
      .prepare(
        'UPDATE customers SET status=?,ended_at=?,ended_reason=? WHERE queue_id=? AND status=?',
      )
      .run(
        CustomerStatus.Removed,
        removedAt,
        CustomerEndReason.QueueSoftRemoved,
        queueId,
        CustomerStatus.Waiting,
      );
    writeAudit(tickets.changes);
    return tickets.changes;
  })();
}
