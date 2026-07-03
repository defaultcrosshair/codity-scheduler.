import { prisma } from '../db';
import parser from 'cron-parser';
import { broadcast } from '../ws';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private intervalMs: number;

  constructor(intervalMs: number = 1000) {
    this.intervalMs = intervalMs;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Scheduler] Scheduler engine started.');
    this.tick();
  }

  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Scheduler engine stopped.');
  }

  private async tick() {
    if (!this.isRunning) return;

    try {
      await this.processRecurringTemplates();
      await this.processDelayedAndDependencies();
    } catch (error) {
      console.error('[Scheduler] Error during scheduler tick:', error);
    }

    if (this.isRunning) {
      this.timer = setTimeout(() => this.tick(), this.intervalMs);
    }
  }

  /**
   * Evaluates recurring jobs (templates) and spawns immediate executions
   */
  private async processRecurringTemplates() {
    const now = new Date();

    // Find recurring template jobs that are scheduled to run now or in the past
    const templates = await prisma.job.findMany({
      where: {
        jobType: 'RECURRING',
        status: 'SCHEDULED',
        cronExpression: { not: null },
        OR: [
          { nextRunAt: null },
          { nextRunAt: { lte: now } },
        ],
      },
    });

    for (const template of templates) {
      try {
        if (!template.cronExpression) continue;

        // 1. Calculate the next execution time
        const interval = parser.parseExpression(template.cronExpression);
        const nextRunAt = interval.next().toDate();

        // 2. Update the template's nextRunAt in transaction
        await prisma.job.update({
          where: { id: template.id },
          data: { nextRunAt },
        });

        // 3. Spawn a new IMMEDIATE execution job
        const spawnedJob = await prisma.job.create({
          data: {
            queueId: template.queueId,
            status: 'QUEUED',
            jobType: 'IMMEDIATE',
            payload: template.payload,
            maxRetries: template.maxRetries,
          },
        });

        // Write log for the spawned job
        await prisma.jobLog.create({
          data: {
            jobId: spawnedJob.id,
            logType: 'INFO',
            message: `Job execution spawned from recurring template (ID: ${template.id}).`,
          },
        });

        // Broadcast to clients
        broadcast('job_spawned', { templateId: template.id, spawnedJobId: spawnedJob.id });
        broadcast('job_updated', spawnedJob);
      } catch (error: any) {
        console.error(`[Scheduler] Failed to process cron template ${template.id}:`, error.message);
      }
    }
  }

  /**
   * Promotes scheduled/delayed jobs to QUEUED if they are ready and dependencies are complete
   */
  private async processDelayedAndDependencies() {
    const now = new Date();

    // Find scheduled/delayed/batch jobs that are still SCHEDULED and due to run
    const pendingJobs = await prisma.job.findMany({
      where: {
        status: 'SCHEDULED',
        jobType: { in: ['DELAYED', 'SCHEDULED', 'IMMEDIATE', 'BATCH'] },
        OR: [
          { nextRunAt: null },
          { nextRunAt: { lte: now } },
        ],
      },
      include: {
        dependencies: {
          include: {
            parent: true,
          },
        },
      },
    });

    for (const job of pendingJobs) {
      try {
        // Check if all parent dependencies are completed
        const hasUnresolvedDependencies = job.dependencies.some(
          (dep) => dep.parent.status !== 'COMPLETED'
        );

        if (hasUnresolvedDependencies) {
          // Keep waiting
          continue;
        }

        // Transition job to QUEUED state
        const updatedJob = await prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'QUEUED',
            // If it had nextRunAt, clear it or leave it as history. Let's keep it.
          },
        });

        // Write log entry
        await prisma.jobLog.create({
          data: {
            jobId: job.id,
            logType: 'INFO',
            message: 'All dependencies resolved. Job promoted to QUEUED.',
          },
        });

        // Broadcast
        broadcast('job_updated', updatedJob);
      } catch (error: any) {
        console.error(`[Scheduler] Failed to queue job ${job.id}:`, error.message);
      }
    }
  }
}
