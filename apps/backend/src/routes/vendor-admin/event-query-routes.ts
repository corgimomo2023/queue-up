import { Router } from 'express';
import { CustomerEndReason, QueueLifecycleStatus } from '../../domain/constants';
import { queueLifecycle } from '../../queue-period';
import type { AccessGuards } from '../../access-guards';
import type { AppRuntime } from '../../runtime';

const CUSTOMER_HISTORY_LIMIT = 500;

export function vendorAdminEventQueryRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();

  router.get('/api/super-admin/overview', guards.vendorAdmin, async (req, res) => {
    const allLive = await runtime.repositories.queues.findAllLive();
    for (const queue of allLive) {
      if (
        queueLifecycle({ startAt: queue.start_at, endAt: queue.end_at }, runtime.now()) ===
        QueueLifecycleStatus.Ended
      ) {
        await runtime.finalizeWaiting(queue, req, CustomerEndReason.QueuePeriodEnded);
      }
    }
    const showRemoved = req.query.status === 'removed';
    const rows = await runtime.readModels.admin.listQueueOverview(showRemoved);
    const queues = rows.map(row => ({
      ...row,
      ...runtime.brandingFor(row),
      ...runtime.periodFor(row),
    }));
    const summary = await runtime.readModels.admin.getSummary();
    const lifecycleCounts = { scheduledQueues: 0, activeQueues: 0, endedQueues: 0 };
    for (const queue of allLive) {
      const key =
        `${queueLifecycle({ startAt: queue.start_at, endAt: queue.end_at }, runtime.now())}Queues` as keyof typeof lifecycleCounts;
      lifecycleCounts[key] += 1;
    }
    res.json({
      summary: {
        ...summary,
        ...lifecycleCounts,
        waiting: summary.waiting,
        served: summary.served,
      },
      queues,
    });
  });

  router.get('/api/super-admin/queues/:queueId', guards.vendorAdmin, async (req, res) => {
    const queue = await runtime.getQueue(req.params.queueId as string);
    if (!queue) {
      res.status(404).json({ error: 'Queue not found' });
      return;
    }
    const customers = (
      await runtime.readModels.admin.listCustomerHistory(queue.id, CUSTOMER_HISTORY_LIMIT)
    ).map(customer => ({
      ...customer,
      phoneMasked: runtime.maskPhone(customer.phone),
      phone: undefined,
    }));
    const counts = await runtime.readModels.admin.getCustomerHistoryCounts(queue.id);
    res.json({
      queue: {
        queueId: queue.slug,
        name: queue.name,
        vendorUrl: `/vendor/${queue.slug}`,
        customerUrl: `/q/${queue.slug}`,
        ...runtime.brandingFor(queue),
        ...runtime.periodFor(queue),
      },
      counts: {
        ...counts,
        waiting: counts.waiting,
        served: counts.served,
        ended: counts.ended,
      },
      customers,
    });
  });

  return router;
}
