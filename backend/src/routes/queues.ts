import { Router } from 'express';
import { prisma } from '../db';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// List Queues
router.get('/', async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId;
  try {
    const queues = await prisma.queue.findMany({
      where: {
        project: { organizationId },
      },
      include: {
        project: true,
        retryPolicy: true,
      },
      orderBy: { name: 'asc' },
    });
    return res.json(queues);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Create Queue
router.post('/', authorize(['ADMIN', 'DEVELOPER']) as any, async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId;
  const { projectId, name, priority, concurrencyLimit, retryPolicy } = req.body;

  if (!projectId || !name || !priority) {
    return res.status(400).json({ error: 'Project ID, queue name, and priority are required.' });
  }

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const queue = await prisma.queue.create({
      data: {
        projectId,
        name: name.trim(),
        priority,
        concurrencyLimit: concurrencyLimit ? parseInt(concurrencyLimit, 10) : 5,
        retryPolicy: {
          create: {
            strategy: retryPolicy?.strategy || 'FIXED',
            maxRetries: retryPolicy?.maxRetries ? parseInt(retryPolicy.maxRetries, 10) : 3,
            baseDelayMs: retryPolicy?.baseDelayMs ? parseInt(retryPolicy.baseDelayMs, 10) : 1000,
            maxDelayMs: retryPolicy?.maxDelayMs ? parseInt(retryPolicy.maxDelayMs, 10) : 60000,
          },
        },
      },
      include: { retryPolicy: true },
    });

    return res.status(201).json(queue);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A queue with this name already exists in this project.' });
    }
    return res.status(500).json({ error: error.message });
  }
});

// Update Queue
router.put('/:id', authorize(['ADMIN', 'DEVELOPER']) as any, async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId as string;
  const id = req.params.id as string;
  const { priority, concurrencyLimit, isPaused, retryPolicy } = req.body;

  try {
    const queue = await prisma.queue.findFirst({
      where: { id, project: { organizationId } },
    });
    if (!queue) return res.status(404).json({ error: 'Queue not found.' });

    const updatedQueue = await prisma.queue.update({
      where: { id: id as string },
      data: {
        priority: priority || queue.priority,
        concurrencyLimit: concurrencyLimit !== undefined ? parseInt(concurrencyLimit, 10) : queue.concurrencyLimit,
        isPaused: isPaused !== undefined ? !!isPaused : queue.isPaused,
        retryPolicy: retryPolicy
          ? {
              upsert: {
                create: {
                  strategy: retryPolicy.strategy || 'FIXED',
                  maxRetries: parseInt(retryPolicy.maxRetries, 10) || 3,
                  baseDelayMs: parseInt(retryPolicy.baseDelayMs, 10) || 1000,
                  maxDelayMs: parseInt(retryPolicy.maxDelayMs, 10) || 60000,
                },
                update: {
                  strategy: retryPolicy.strategy,
                  maxRetries: parseInt(retryPolicy.maxRetries, 10),
                  baseDelayMs: parseInt(retryPolicy.baseDelayMs, 10),
                  maxDelayMs: parseInt(retryPolicy.maxDelayMs, 10),
                },
              },
            }
          : undefined,
      },
      include: { retryPolicy: true },
    });

    return res.json(updatedQueue);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Toggle Pause Queue
router.post('/:id/toggle-pause', authorize(['ADMIN', 'DEVELOPER']) as any, async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId as string;
  const id = req.params.id as string;

  try {
    const queue = await prisma.queue.findFirst({
      where: { id, project: { organizationId } },
    });
    if (!queue) return res.status(404).json({ error: 'Queue not found.' });

    const updatedQueue = await prisma.queue.update({
      where: { id: id as string },
      data: { isPaused: !queue.isPaused },
      include: { retryPolicy: true },
    });

    return res.json(updatedQueue);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Queue Stats
router.get('/:id/stats', async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId as string;
  const id = req.params.id as string;

  try {
    const queue = await prisma.queue.findFirst({
      where: { id, project: { organizationId } },
    });
    if (!queue) return res.status(404).json({ error: 'Queue not found.' });

    const counts = await prisma.job.groupBy({
      by: ['status'],
      where: { queueId: id as string },
      _count: { id: true },
    });

    const statsMap: Record<string, number> = {
      QUEUED: 0,
      SCHEDULED: 0,
      CLAIMED: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
    };

    counts.forEach((c) => {
      statsMap[c.status] = (c as any)._count?.id || 0;
    });

    const dlqCount = await prisma.deadLetterQueue.count({
      where: { queueId: id as string },
    });

    return res.json({
      queueId: id,
      jobsCount: statsMap,
      deadLetterCount: dlqCount,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Delete Queue
router.delete('/:id', authorize(['ADMIN']) as any, async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId as string;
  const id = req.params.id as string;

  try {
    const queue = await prisma.queue.findFirst({
      where: { id, project: { organizationId } },
    });

    if (!queue) return res.status(404).json({ error: 'Queue not found.' });

    await prisma.queue.delete({ where: { id: id as string } });
    return res.json({ message: 'Queue deleted successfully.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
