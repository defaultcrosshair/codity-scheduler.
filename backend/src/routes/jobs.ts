import { Router } from 'express';
import parser from 'cron-parser';
import { prisma } from '../db';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { broadcast } from '../ws';

const router = Router();

router.use(authenticate as any);

// Create Job
router.post('/', authorize(['ADMIN', 'DEVELOPER']) as any, async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId;
  const {
    queueId,
    jobType, // IMMEDIATE, DELAYED, SCHEDULED, RECURRING, BATCH
    payload,
    cronExpression,
    nextRunAt,
    delayMs,
    batchId,
    batchName,
    dependencies, // Array of job IDs
  } = req.body;

  if (!queueId || !jobType) {
    return res.status(400).json({ error: 'Queue ID and Job Type are required.' });
  }

  try {
    const queue = await prisma.queue.findFirst({
      where: { id: queueId, project: { organizationId } },
      include: { retryPolicy: true },
    });
    if (!queue) return res.status(404).json({ error: 'Queue not found.' });

    let finalPayloadStr = '';
    if (typeof payload === 'string') {
      finalPayloadStr = payload;
    } else {
      finalPayloadStr = JSON.stringify(payload || {});
    }

    let status = 'QUEUED';
    let runAtDate: Date | null = null;

    if (jobType === 'DELAYED') {
      status = 'SCHEDULED';
      if (delayMs) {
        runAtDate = new Date(Date.now() + parseInt(delayMs, 10));
      } else if (nextRunAt) {
        runAtDate = new Date(nextRunAt);
      } else {
        return res.status(400).json({ error: 'Delayed jobs require delayMs or nextRunAt.' });
      }
    } else if (jobType === 'SCHEDULED') {
      status = 'SCHEDULED';
      if (!nextRunAt) {
        return res.status(400).json({ error: 'Scheduled jobs require nextRunAt timestamp.' });
      }
      runAtDate = new Date(nextRunAt);
    } else if (jobType === 'RECURRING') {
      status = 'SCHEDULED';
      if (!cronExpression) {
        return res.status(400).json({ error: 'Recurring jobs require a cronExpression.' });
      }
      try {
        const interval = parser.parseExpression(cronExpression);
        runAtDate = interval.next().toDate();
      } catch (err) {
        return res.status(400).json({ error: 'Invalid cron expression.' });
      }
    }

    // If job has dependencies, set state to SCHEDULED initially
    const hasDeps = dependencies && Array.isArray(dependencies) && dependencies.length > 0;
    if (hasDeps) {
      status = 'SCHEDULED';
    }

    // Resolve Batch
    let finalBatchId = batchId;
    if (!finalBatchId && batchName && batchName.trim() !== '') {
      const newBatch = await prisma.batch.create({
        data: { name: batchName.trim(), status: 'PENDING' },
      });
      finalBatchId = newBatch.id;
    }

    const maxRetries = queue.retryPolicy?.maxRetries ?? 3;

    // Create Job
    const job = await prisma.job.create({
      data: {
        queueId,
        status,
        jobType,
        payload: finalPayloadStr,
        cronExpression: jobType === 'RECURRING' ? cronExpression : null,
        nextRunAt: runAtDate,
        maxRetries,
        batchId: finalBatchId || null,
      },
    });

    // Create Dependencies
    if (hasDeps) {
      for (const parentId of dependencies) {
        const parentJob = await prisma.job.findUnique({ where: { id: parentId } });
        if (parentJob) {
          await prisma.jobDependency.create({
            data: {
              parentId,
              childId: job.id,
            },
          });
        }
      }
    }

    // Log Creation
    await prisma.jobLog.create({
      data: {
        jobId: job.id,
        logType: 'INFO',
        message: `Job initialized [Type: ${jobType}, State: ${status}].`,
      },
    });

    broadcast('job_updated', job);
    return res.status(201).json(job);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// List Jobs (Explorer)
router.get('/', async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId;
  const { queueId, status, jobType, search, page = '1', limit = '10' } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;

  try {
    const whereClause: any = {
      queue: {
        project: { organizationId },
      },
    };

    if (queueId) {
      whereClause.queueId = queueId as string;
    }

    if (status) {
      whereClause.status = status as string;
    }

    if (jobType) {
      whereClause.jobType = jobType as string;
    }

    if (search) {
      whereClause.OR = [
        { id: { contains: search as string } },
        { payload: { contains: search as string } },
      ];
    }

    const [jobs, totalCount] = await Promise.all([
      prisma.job.findMany({
        where: whereClause,
        include: {
          queue: {
            select: { name: true, priority: true },
          },
          batch: true,
          dependencies: {
            include: {
              parent: {
                select: { id: true, status: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.job.count({ where: whereClause }),
    ]);

    return res.json({
      jobs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get Stats (Global metrics)
router.get('/stats', async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId;

  try {
    const totalJobs = await prisma.job.count({
      where: { queue: { project: { organizationId } } },
    });

    const statusCounts = await prisma.job.groupBy({
      by: ['status'],
      where: { queue: { project: { organizationId } } },
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

    statusCounts.forEach((c) => {
      statsMap[c.status] = c._count.id;
    });

    const dlqCount = await prisma.deadLetterQueue.count({
      where: { queue: { project: { organizationId } } },
    });

    const activeWorkersCount = await prisma.worker.count({
      where: { status: 'ACTIVE' },
    });

    const past24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const completed24h = await prisma.job.count({
      where: {
        queue: { project: { organizationId } },
        status: 'COMPLETED',
        completedAt: { gte: past24h },
      },
    });

    return res.json({
      totalJobs,
      statusCounts: statsMap,
      deadLetterCount: dlqCount,
      activeWorkersCount,
      completed24h,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get Job Details
router.get('/:id', async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId as string;
  const id = req.params.id as string;

  try {
    const job = await prisma.job.findFirst({
      where: { id, queue: { project: { organizationId } } },
      include: {
        queue: {
          include: { project: true },
        },
        executions: {
          orderBy: { startedAt: 'desc' },
        },
        logs: {
          orderBy: { timestamp: 'desc' },
        },
        batch: true,
        dependencies: {
          include: { parent: true },
        },
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    return res.json(job);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Cancel Job
router.post('/:id/cancel', authorize(['ADMIN', 'DEVELOPER']) as any, async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId as string;
  const id = req.params.id as string;

  try {
    const job = await prisma.job.findFirst({
      where: {
        id,
        queue: { project: { organizationId } },
        status: { in: ['QUEUED', 'SCHEDULED'] },
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found or cannot be cancelled in its current state.' });
    }

    const cancelledJob = await prisma.job.update({
      where: { id: id as string },
      data: { status: 'CANCELLED' },
    });

    await prisma.jobLog.create({
      data: {
        jobId: id as string,
        logType: 'INFO',
        message: 'Job was manually CANCELLED by user request.',
      },
    });

    broadcast('job_updated', cancelledJob);
    return res.json(cancelledJob);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Retry Job (Manual retry)
router.post('/:id/retry', authorize(['ADMIN', 'DEVELOPER']) as any, async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId as string;
  const id = req.params.id as string;

  try {
    const job = await prisma.job.findFirst({
      where: {
        id,
        queue: { project: { organizationId } },
        status: 'FAILED',
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Failed job not found.' });
    }

    // Delete from DLQ if present
    await prisma.deadLetterQueue.deleteMany({
      where: { jobId: id as string },
    });

    // Reset job stats and transition back to QUEUED
    const retriedJob = await prisma.job.update({
      where: { id: id as string },
      data: {
        status: 'QUEUED',
        runCount: 0,
        failedAt: null,
        nextRunAt: null,
      },
    });

    await prisma.jobLog.create({
      data: {
        jobId: id as string,
        logType: 'INFO',
        message: 'Manual retry initiated by user. State reset to QUEUED.',
      },
    });

    broadcast('job_updated', retriedJob);
    return res.json(retriedJob);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
