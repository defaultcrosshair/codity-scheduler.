import { prisma } from '../db';
import { broadcast } from '../ws';
import { generateFailureSummary } from './ai';
import os from 'os';

export class WorkerDaemon {
  public id: string;
  private hostname: string;
  private ipAddress: string;
  private isRunning: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private activeJobs: Map<string, Promise<void>> = new Map();
  private concurrencyLimit: number = 3; // Max concurrent jobs this worker instance will run

  constructor(id: string = `worker-${Math.random().toString(36).substring(2, 9)}`) {
    this.id = id;
    this.hostname = os.hostname();
    this.ipAddress = this.getIpAddress();
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Register worker in DB (upsert to handle restarts gracefully)
    await prisma.worker.upsert({
      where: { id: this.id },
      update: {
        status: 'ACTIVE',
        lastHeartbeatAt: new Date(),
      },
      create: {
        id: this.id,
        hostname: this.hostname,
        ipAddress: this.ipAddress,
        status: 'ACTIVE',
        version: '1.0.0',
      },
    });

    console.log(`[Worker-${this.id}] Worker daemon registered and started.`);
    broadcast('worker_status', { workerId: this.id, status: 'ACTIVE' });

    // Start polling and heartbeat loops
    this.poll();
    this.sendHeartbeat();
  }

  public async shutdown() {
    if (!this.isRunning) return;
    this.isRunning = false;

    console.log(`[Worker-${this.id}] Initiating graceful shutdown. Waiting for active jobs...`);

    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);

    // Update status in DB to SHUTDOWN
    await prisma.worker.update({
      where: { id: this.id },
      data: { status: 'SHUTDOWN' },
    });

    // Wait for active jobs to finish
    if (this.activeJobs.size > 0) {
      console.log(`[Worker-${this.id}] Waiting for ${this.activeJobs.size} active jobs to finish...`);
      await Promise.all(Array.from(this.activeJobs.values()));
    }

    console.log(`[Worker-${this.id}] Shutdown complete.`);
    broadcast('worker_status', { workerId: this.id, status: 'INACTIVE' });
  }

  private async poll() {
    if (!this.isRunning) return;

    // If worker capacity is full, skip this polling cycle
    if (this.activeJobs.size >= this.concurrencyLimit) {
      this.pollTimer = setTimeout(() => this.poll(), 500);
      return;
    }

    try {
      const claimResult = await this.claimJob();
      if (claimResult) {
        const { job, queue } = claimResult;
        const jobPromise = this.executeJob(job, queue);
        this.activeJobs.set(job.id, jobPromise);
        jobPromise.finally(() => {
          this.activeJobs.delete(job.id);
          // Trigger immediate poll after a job finishes to check for more work
          this.poll();
        });
      }
    } catch (error) {
      console.error(`[Worker-${this.id}] Error in poll loop:`, error);
    }

    // Schedule next poll cycle
    if (this.isRunning) {
      this.pollTimer = setTimeout(() => this.poll(), 1000);
    }
  }

  private async claimJob() {
    // Atomic claiming logic inside a transaction
    return await prisma.$transaction(async (tx) => {
      const activeQueues = await tx.queue.findMany({
        where: { isPaused: false },
        include: { retryPolicy: true },
      });

      // Sort queues by priority: HIGH -> MEDIUM -> LOW
      const priorityOrder: Record<string, number> = { HIGH: 1, MEDIUM: 2, LOW: 3 };
      activeQueues.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

      for (const queue of activeQueues) {
        // Count running or claimed jobs in this queue
        const activeQueueJobs = await tx.job.count({
          where: {
            queueId: queue.id,
            status: { in: ['CLAIMED', 'RUNNING'] },
          },
        });

        if (activeQueueJobs >= queue.concurrencyLimit) {
          continue; // Concurrency limit exceeded
        }

        // Find the oldest QUEUED job in this queue (FIFO)
        const jobToClaim = await tx.job.findFirst({
          where: {
            queueId: queue.id,
            status: 'QUEUED',
          },
          orderBy: {
            createdAt: 'asc',
          },
        });

        if (jobToClaim) {
          // Lock the job to this worker
          const updatedJob = await tx.job.update({
            where: { id: jobToClaim.id },
            data: {
              status: 'CLAIMED',
              lockedByWorkerId: this.id,
              lockedAt: new Date(),
              claimedAt: new Date(),
              runCount: { increment: 1 },
            },
          });

          return { job: updatedJob, queue };
        }
      }

      return null; // No jobs ready
    });
  }

  private async executeJob(job: any, queue: any) {
    console.log(`[Worker-${this.id}] Executing Job ID: ${job.id} (${job.jobType})`);

    // Create execution entry
    const execution = await prisma.jobExecution.create({
      data: {
        jobId: job.id,
        workerId: this.id,
        status: 'RUNNING',
        startedAt: new Date(),
        attemptNumber: job.runCount,
      },
    });

    // Update job status to RUNNING
    const runningJob = await prisma.job.update({
      where: { id: job.id },
      data: { status: 'RUNNING' },
    });
    broadcast('job_updated', runningJob);

    await prisma.jobLog.create({
      data: {
        jobId: job.id,
        logType: 'INFO',
        message: `Execution attempt #${job.runCount} started by worker ${this.id}.`,
      },
    });

    const startTime = Date.now();
    let errorOccurred = false;
    let errorMessage = '';

    try {
      const payload = JSON.parse(job.payload || '{}');
      await this.runTaskLogic(payload, job.id);
    } catch (error: any) {
      errorOccurred = true;
      errorMessage = error.message || 'Unknown runtime error during execution.';
    }

    const durationMs = Date.now() - startTime;

    if (!errorOccurred) {
      // 1. Success transition
      const completedJob = await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          lockedByWorkerId: null,
          lockedAt: null,
        },
      });

      await prisma.jobExecution.update({
        where: { id: execution.id },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          durationMs,
        },
      });

      await prisma.jobLog.create({
        data: {
          jobId: job.id,
          logType: 'INFO',
          message: `Execution attempt #${job.runCount} completed successfully in ${durationMs}ms.`,
        },
      });

      broadcast('job_updated', completedJob);
    } else {
      // 2. Failure & Retry Transition
      await prisma.jobExecution.update({
        where: { id: execution.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorDetails: errorMessage,
          durationMs,
        },
      });

      await prisma.jobLog.create({
        data: {
          jobId: job.id,
          logType: 'ERROR',
          message: `Execution attempt #${job.runCount} failed in ${durationMs}ms: ${errorMessage}`,
        },
      });

      const maxRetries = queue.retryPolicy?.maxRetries ?? 3;

      if (job.runCount <= maxRetries) {
        // Compute backoff delay
        const retryPolicy = queue.retryPolicy || {
          strategy: 'FIXED',
          baseDelayMs: 2000,
          maxDelayMs: 30000,
        };

        const delay = this.calculateBackoff(
          retryPolicy.strategy,
          job.runCount,
          retryPolicy.baseDelayMs,
          retryPolicy.maxDelayMs
        );

        const nextRunAt = new Date(Date.now() + delay);

        const retryingJob = await prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'SCHEDULED', // set back to SCHEDULED for next run
            nextRunAt,
            lockedByWorkerId: null,
            lockedAt: null,
          },
        });

        await prisma.jobLog.create({
          data: {
            jobId: job.id,
            logType: 'WARN',
            message: `Scheduled retry attempt #${job.runCount + 1} in ${delay}ms at ${nextRunAt.toISOString()}`,
          },
        });

        broadcast('job_updated', retryingJob);
      } else {
        // Max retries exceeded, push to Dead Letter Queue (DLQ)
        const failedJob = await prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            lockedByWorkerId: null,
            lockedAt: null,
          },
        });

        await prisma.deadLetterQueue.create({
          data: {
            jobId: job.id,
            queueId: job.queueId,
            reason: errorMessage,
            originalPayload: job.payload,
          },
        });

        await prisma.jobLog.create({
          data: {
            jobId: job.id,
            logType: 'ERROR',
            message: `Max retries (${maxRetries}) exceeded. Job moved to Dead Letter Queue.`,
          },
        });

        // Trigger AI Diagnosis summary
        const aiSummary = generateFailureSummary(errorMessage);
        await prisma.jobLog.create({
          data: {
            jobId: job.id,
            logType: 'INFO',
            message: `[AI DIAGNOSTICS] Analysis Category: ${aiSummary.category}. Reason: ${aiSummary.reason} Recommendation: ${aiSummary.suggestedAction} (Confidence: ${Math.round(aiSummary.confidence * 100)}%)`,
          },
        });

        broadcast('job_updated', failedJob);
      }
    }
  }

  private calculateBackoff(strategy: string, attempt: number, baseDelay: number, maxDelay: number): number {
    let delay = baseDelay;
    if (strategy === 'LINEAR') {
      delay = baseDelay * attempt;
    } else if (strategy === 'EXPONENTIAL') {
      delay = baseDelay * Math.pow(2, attempt - 1);
    }
    return Math.min(delay, maxDelay);
  }

  private async runTaskLogic(payload: any, jobId: string) {
    const taskName = payload.taskName || payload.action || 'generic_task';
    const shouldFail = payload.shouldFail === true || payload.shouldFail === 'true';

    // Simulated task runner
    if (taskName === 'verify_system_integrity') {
      await this.delay(1000);
      await this.writeJobTaskLog(jobId, 'Polling worker operating parameters: CPU temp 48C, RAM load 54%');
      await this.delay(500);
      if (shouldFail) throw new Error('SystemIntegrityException: Disk block corruption detected at partition /dev/sda1');
    } else if (taskName === 'pull_latest_git_branch') {
      await this.delay(800);
      await this.writeJobTaskLog(jobId, 'Fetching origin branch "main"...');
      await this.delay(700);
      await this.writeJobTaskLog(jobId, 'Unpacking objects: 100% (24/24), done.');
      await this.delay(500);
      if (shouldFail) throw new Error('GitFetchException: Remote repository credentials expired or connection refused');
    } else if (taskName === 'trigger_deploy_build') {
      await this.delay(1000);
      await this.writeJobTaskLog(jobId, 'Transpiling source: compiler targets ESNext');
      await this.delay(1000);
      await this.writeJobTaskLog(jobId, 'Running asset optimizations...');
      await this.delay(1000);
      if (shouldFail) throw new Error('SyntaxError: Unexpected token "export" in vendor-bundle.js:84:10');
    } else if (taskName === 'db_contention_test') {
      await this.delay(1200);
      throw new Error('PrismaClientKnownRequestError: SQLite database file is locked (SQLITE_BUSY)');
    } else if (taskName === 'network_failure_test') {
      await this.delay(800);
      throw new Error('FetchError: request to https://api.crm-sync.internal/sync failed, reason: connect ECONNREFUSED 10.0.12.8:443');
    } else if (taskName === 'out_of_memory_test') {
      await this.delay(600);
      throw new Error('Fatal error: JavaScript heap out of memory (OOM crash)');
    } else {
      // Generic Task execution
      const duration = 500 + Math.random() * 1500;
      await this.delay(duration);
      if (shouldFail || Math.random() < 0.1) {
        throw new Error(`ExecutionException: Failed to process payload chunk. Object reference is undefined.`);
      }
    }
  }

  private async writeJobTaskLog(jobId: string, message: string) {
    await prisma.jobLog.create({
      data: {
        jobId,
        logType: 'INFO',
        message: `[TaskStdout] ${message}`,
      },
    });
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async sendHeartbeat() {
    if (!this.isRunning) return;

    try {
      const activeJobsCount = this.activeJobs.size;

      // Mock resource stats
      const cpuUsage = Number((5 + Math.random() * 35).toFixed(1));
      const memoryUsage = Number((100 + Math.random() * 150).toFixed(1)); // MBs

      // Update worker heartbeat timestamp
      await prisma.worker.update({
        where: { id: this.id },
        data: { lastHeartbeatAt: new Date() },
      });

      // Log stats history
      const heartbeat = await prisma.workerHeartbeat.create({
        data: {
          workerId: this.id,
          cpuUsage,
          memoryUsage,
          activeJobsCount,
        },
      });

      broadcast('worker_heartbeat', {
        workerId: this.id,
        hostname: this.hostname,
        ipAddress: this.ipAddress,
        cpuUsage,
        memoryUsage,
        activeJobsCount,
        timestamp: heartbeat.timestamp,
      });
    } catch (error) {
      console.error(`[Worker-${this.id}] Failed to dispatch heartbeat:`, error);
    }

    if (this.isRunning) {
      this.heartbeatTimer = setTimeout(() => this.sendHeartbeat(), 5000);
    }
  }

  private getIpAddress(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }
}
