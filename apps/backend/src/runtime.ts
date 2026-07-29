import type { Request, Response } from 'express';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCustomerCommandService } from './application/customers/customer-command-service';
import { createEventManagementService } from './application/events/event-management-service';
import { Realtime, RequestLimit } from './config/http-constants';
import {
  ApiErrorCode,
  CustomerEndReason,
  CustomerStatus,
  QueueLifecycleStatus,
  RealtimeEvent,
  type ActorType as ActorTypeValue,
  type AuditAction as AuditActionValue,
} from './domain/constants';
import { reconcileEventAssets } from './event-assets';
import { initializePersistence } from './infrastructure/database/data-source';
import { createAdminReadRepository } from './infrastructure/read-models/admin-read-repository';
import { createAuditRepository } from './infrastructure/repositories/audit-repository';
import { createCustomerRepository } from './infrastructure/repositories/customer-repository';
import { createQueueRepository } from './infrastructure/repositories/queue-repository';
import { BUSINESS_TIME_ZONE, queueLifecycle } from './queue-period';
import { slowHash, tokenHash } from './security';
import type { AppOptions, CustomerRow, QueueRow } from './types';

export async function createRuntime(options: AppOptions) {
  const now = options.now ?? (() => new Date());
  const ownsAssetDir = !options.assetDir && options.dbPath === ':memory:';
  const assetDir =
    options.assetDir ??
    (ownsAssetDir
      ? mkdtempSync(path.join(tmpdir(), 'nextq-event-assets-'))
      : path.join(path.dirname(options.dbPath), 'event-assets'));
  mkdirSync(assetDir, { recursive: true });
  const { dataSource, database: db } = await initializePersistence(options.dbPath);
  const queueRepository = createQueueRepository(dataSource);
  const customerRepository = createCustomerRepository(dataSource);
  const auditRepository = createAuditRepository(dataSource);
  const adminReadRepository = createAdminReadRepository(dataSource);
  const customerCommandService = createCustomerCommandService(dataSource);
  const eventManagementService = createEventManagementService(dataSource);
  reconcileEventAssets({ assetDir, db });

  const seedEmailHash = options.seedEmail ? slowHash(options.seedEmail) : null;
  const seedPhoneHash = options.seedPhone ? slowHash(options.seedPhone) : null;
  if (seedEmailHash || seedPhoneHash) {
    await queueRepository.insertSeedIfMissing({
      slug: 'test-demo-t7dn',
      name: 'Test Demo',
      emailHash: seedEmailHash,
      phoneHash: seedPhoneHash,
    });
  }

  const clients = new Map<string, Map<number, Set<Response>>>();
  const getQueue = queueRepository.findBySlug;
  const customerByToken = (queueId: number, token: string | undefined) =>
    token ? customerRepository.findByTokenHash(queueId, tokenHash(token)) : undefined;
  const periodFor = (queue: QueueRow) => ({
    startAt: queue.start_at,
    endAt: queue.end_at,
    lifecycleStatus: queueLifecycle({ startAt: queue.start_at, endAt: queue.end_at }, now()),
    timeZone: BUSINESS_TIME_ZONE,
    isRemoved: Boolean(queue.removed_at),
    removedAt: queue.removed_at,
  });
  const brandingFor = (queue: QueueRow) => ({
    description: queue.description,
    logoUrl: queue.logo_path ? `/event-assets/${encodeURIComponent(queue.logo_path)}` : null,
  });
  const auditFields = (req: Request) => ({
    ipAddress: req.ip || undefined,
    userAgent:
      req.get('user-agent')?.slice(0, RequestLimit.AuditMetadataUserAgentLength) || undefined,
  });
  const writeAudit = async (
    req: Request,
    actorType: ActorTypeValue,
    action: AuditActionValue,
    queueId?: number,
    customerId?: number,
    metadata: Record<string, unknown> = {},
  ): Promise<void> => {
    await auditRepository.record({
      actorType,
      action,
      queueId,
      customerId,
      metadata,
      ...auditFields(req),
    });
  };
  const maskPhone = (phone: string | null) => {
    if (!phone) return null;
    const compact = phone.replace(/\s+/g, '');
    return compact.length <= 4 ? '****' : `${compact.slice(0, 3)}****${compact.slice(-2)}`;
  };
  const statusFor = async (customer: CustomerRow) => {
    const position =
      customer.status === CustomerStatus.Waiting
        ? await customerRepository.waitingPosition(customer.queue_id, customer.id)
        : 0;
    const waitingCount = await customerRepository.waitingCount(customer.queue_id);
    const peopleAhead = customer.status === CustomerStatus.Waiting ? Math.max(0, position - 1) : 0;
    return {
      customerId: customer.id,
      name: customer.name,
      status: customer.status,
      position,
      peopleAhead,
      waitingCount,
      isNext: position === 1,
    };
  };
  const emit = async (slug: string, excludeCustomerId?: number): Promise<void> => {
    const queue = await getQueue(slug);
    if (!queue) return;
    const waitingCount = await customerRepository.waitingCount(queue.id);
    for (const [customerId, responses] of clients.get(slug) ?? []) {
      if (customerId === excludeCustomerId) continue;
      for (const response of responses)
        response.write(
          `event: ${RealtimeEvent.Update}\ndata: ${JSON.stringify({ waitingCount })}\n\n`,
        );
    }
  };
  const callCustomer = (slug: string, customerId: number) => {
    const eventClients = clients.get(slug);
    const group = eventClients?.get(customerId);
    if (!eventClients || !group) return;
    const data = JSON.stringify({ message: Realtime.CalledCustomerMessage });
    for (const response of group) {
      response.write(`event: ${RealtimeEvent.QueueCalled}\ndata: ${data}\n\n`);
      response.end();
    }
    eventClients.delete(customerId);
    if (!eventClients.size && clients.get(slug) === eventClients) clients.delete(slug);
  };
  const closeQueueClients = (slug: string, event: string, data: Record<string, unknown>) => {
    const eventClients = clients.get(slug);
    for (const responses of eventClients?.values() ?? []) {
      for (const response of responses) {
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        response.end();
      }
    }
    if (clients.get(slug) === eventClients) clients.delete(slug);
  };
  const finalizeWaiting = async (
    queue: QueueRow,
    req: Request,
    reason: typeof CustomerEndReason.QueuePeriodEnded | typeof CustomerEndReason.QueueSoftRemoved,
  ): Promise<number> => {
    const changes = await customerCommandService.finalizeWaiting(
      queue.id,
      now().toISOString(),
      reason,
      auditFields(req),
    );
    if (changes) await emit(queue.slug);
    return changes;
  };
  const requireActive = async (req: Request, res: Response, queue: QueueRow): Promise<boolean> => {
    const state = queueLifecycle({ startAt: queue.start_at, endAt: queue.end_at }, now());
    if (state === QueueLifecycleStatus.Active) return true;
    if (state === QueueLifecycleStatus.Ended) {
      await finalizeWaiting(queue, req, CustomerEndReason.QueuePeriodEnded);
    }
    res.status(409).json({
      error: 'Queue is not active',
      code:
        state === QueueLifecycleStatus.Scheduled
          ? ApiErrorCode.QueueScheduled
          : ApiErrorCode.QueueEnded,
      startAt: queue.start_at,
      endAt: queue.end_at,
    });
    return false;
  };
  const addClient = (queue: QueueRow, customer: CustomerRow, req: Request, res: Response) => {
    const eventClients = clients.get(queue.slug) ?? new Map<number, Set<Response>>();
    const responses = eventClients.get(customer.id) ?? new Set<Response>();
    responses.add(res);
    eventClients.set(customer.id, responses);
    clients.set(queue.slug, eventClients);
    const heartbeat = setInterval(() => {
      void (async () => {
        const latest = await getQueue(queue.slug);
        if (!latest || latest.removed_at) {
          res.write(
            `event: ${RealtimeEvent.QueueArchived}\ndata: ${JSON.stringify({ code: ApiErrorCode.EventArchived })}\n\n`,
          );
          res.end();
          return;
        }
        const state = queueLifecycle({ startAt: latest.start_at, endAt: latest.end_at }, now());
        if (state === QueueLifecycleStatus.Ended) {
          await finalizeWaiting(latest, req, CustomerEndReason.QueuePeriodEnded);
          res.write(
            `event: ${RealtimeEvent.QueueEnded}\ndata: ${JSON.stringify({ code: ApiErrorCode.QueueEnded })}\n\n`,
          );
          res.end();
          return;
        }
        res.write(': heartbeat\n\n');
      })();
    }, Realtime.HeartbeatMilliseconds);
    req.on('close', () => {
      clearInterval(heartbeat);
      responses.delete(res);
      if (!responses.size) eventClients.delete(customer.id);
      if (!eventClients.size && clients.get(queue.slug) === eventClients)
        clients.delete(queue.slug);
    });
  };
  const close = async (): Promise<void> => {
    for (const eventClients of clients.values()) {
      for (const responses of eventClients.values()) for (const client of responses) client.end();
    }
    clients.clear();
    if (dataSource.isInitialized) await dataSource.destroy();
    if (ownsAssetDir) rmSync(assetDir, { recursive: true, force: true });
  };

  return {
    options,
    now,
    db,
    dataSource,
    repositories: {
      queues: queueRepository,
      customers: customerRepository,
      audit: auditRepository,
    },
    readModels: { admin: adminReadRepository },
    services: { customers: customerCommandService, events: eventManagementService },
    assetDir,
    clients,
    getQueue,
    customerByToken,
    periodFor,
    brandingFor,
    auditFields,
    writeAudit,
    maskPhone,
    statusFor,
    emit,
    callCustomer,
    closeQueueClients,
    finalizeWaiting,
    requireActive,
    addClient,
    close,
  };
}

export type AppRuntime = Awaited<ReturnType<typeof createRuntime>>;
