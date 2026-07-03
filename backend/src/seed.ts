import { prisma } from './db';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('Seeding database...');

  // 1. Delete existing data in proper order to avoid foreign key violations
  await prisma.deadLetterQueue.deleteMany({});
  await prisma.jobLog.deleteMany({});
  await prisma.jobExecution.deleteMany({});
  await prisma.jobDependency.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.workerHeartbeat.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.retryPolicy.deleteMany({});
  await prisma.queue.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organization.deleteMany({});

  // 2. Create Organization
  const org = await prisma.organization.create({
    data: { name: 'Codity Corp' },
  });

  // 3. Create Users
  const passwordHash = bcrypt.hashSync('password123', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      name: 'Jane Doe (Admin)',
      passwordHash,
      role: 'ADMIN',
      organizationId: org.id,
    },
  });

  const dev = await prisma.user.create({
    data: {
      email: 'dev@example.com',
      name: 'Alice Smith (Dev)',
      passwordHash,
      role: 'DEVELOPER',
      organizationId: org.id,
    },
  });

  const viewer = await prisma.user.create({
    data: {
      email: 'viewer@example.com',
      name: 'Bob Johnson (Viewer)',
      passwordHash,
      role: 'VIEWER',
      organizationId: org.id,
    },
  });

  console.log('Users created:');
  console.log(`- Admin: admin@example.com (role: ADMIN)`);
  console.log(`- Developer: dev@example.com (role: DEVELOPER)`);
  console.log(`- Viewer: viewer@example.com (role: VIEWER)`);

  // 4. Create Project
  const project = await prisma.project.create({
    data: {
      name: 'Core Services Router',
      organizationId: org.id,
    },
  });

  // 5. Create Queues & Retry Policies
  const criticalQueue = await prisma.queue.create({
    data: {
      name: 'critical-ops',
      projectId: project.id,
      priority: 'HIGH',
      concurrencyLimit: 8,
      retryPolicy: {
        create: {
          strategy: 'FIXED',
          maxRetries: 5,
          baseDelayMs: 2000,
          maxDelayMs: 10000,
        },
      },
    },
  });

  const dataQueue = await prisma.queue.create({
    data: {
      name: 'data-processing',
      projectId: project.id,
      priority: 'MEDIUM',
      concurrencyLimit: 4,
      retryPolicy: {
        create: {
          strategy: 'EXPONENTIAL',
          maxRetries: 3,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
        },
      },
    },
  });

  const notificationQueue = await prisma.queue.create({
    data: {
      name: 'notification-dispatch',
      projectId: project.id,
      priority: 'LOW',
      concurrencyLimit: 12,
      retryPolicy: {
        create: {
          strategy: 'LINEAR',
          maxRetries: 2,
          baseDelayMs: 1500,
          maxDelayMs: 15000,
        },
      },
    },
  });

  console.log('Queues created: critical-ops, data-processing, notification-dispatch');

  // 6. Create Batches
  const batch1 = await prisma.batch.create({
    data: {
      name: 'End-of-Month Analytics Export',
      status: 'PENDING',
    },
  });

  // 7. Seed Jobs
  // Immediate Completed Job
  await prisma.job.create({
    data: {
      queueId: criticalQueue.id,
      status: 'COMPLETED',
      jobType: 'IMMEDIATE',
      payload: JSON.stringify({ taskName: 'verify_system_integrity', dryRun: false }),
      runCount: 1,
      completedAt: new Date(Date.now() - 3600000),
      executions: {
        create: {
          workerId: 'worker-node-1',
          status: 'COMPLETED',
          startedAt: new Date(Date.now() - 3600000 - 1500),
          finishedAt: new Date(Date.now() - 3600000),
          attemptNumber: 1,
          durationMs: 1500,
        },
      },
      logs: {
        create: [
          { logType: 'INFO', message: 'Job initialized by scheduler' },
          { logType: 'INFO', message: 'Worker worker-node-1 claimed job' },
          { logType: 'INFO', message: 'Executing verification procedures: CPU, Memory, Disk space.' },
          { logType: 'INFO', message: 'Integrity checks completed successfully.' },
        ],
      },
    },
  });

  // Immediate Failed & Dead Letter Queue Job
  const failedJob = await prisma.job.create({
    data: {
      queueId: dataQueue.id,
      status: 'FAILED',
      jobType: 'IMMEDIATE',
      payload: JSON.stringify({ datasetId: 'user_leads_2026', format: 'parquet' }),
      runCount: 4,
      failedAt: new Date(Date.now() - 1800000),
      executions: {
        create: [
          {
            workerId: 'worker-node-2',
            status: 'FAILED',
            startedAt: new Date(Date.now() - 1800000 - 2000),
            finishedAt: new Date(Date.now() - 1800000),
            errorDetails: 'TypeError: Cannot read properties of undefined (reading "rows")',
            attemptNumber: 4,
            durationMs: 2000,
          },
        ],
      },
      logs: {
        create: [
          { logType: 'INFO', message: 'Worker worker-node-2 claimed attempt #4' },
          { logType: 'ERROR', message: 'TypeError: Cannot read properties of undefined (reading "rows") at ParquetExporter.export (src/exporter.ts:42:15)' },
          { logType: 'WARN', message: 'Max retries (3) exceeded. Moving job to dead letter queue.' },
        ],
      },
    },
  });

  await prisma.deadLetterQueue.create({
    data: {
      jobId: failedJob.id,
      queueId: dataQueue.id,
      reason: 'TypeError: Cannot read properties of undefined (reading "rows")',
      originalPayload: failedJob.payload,
      failedAt: new Date(Date.now() - 1800000),
    },
  });

  // Delayed Job
  await prisma.job.create({
    data: {
      queueId: notificationQueue.id,
      status: 'SCHEDULED',
      jobType: 'DELAYED',
      payload: JSON.stringify({ userId: 'usr_8790', template: 'churn_alert_v2' }),
      nextRunAt: new Date(Date.now() + 600000), // 10 minutes in future
    },
  });

  // Cron Job (recurring)
  await prisma.job.create({
    data: {
      queueId: notificationQueue.id,
      status: 'SCHEDULED',
      jobType: 'RECURRING',
      payload: JSON.stringify({ cleanOrphans: true }),
      cronExpression: '*/5 * * * *', // every 5 minutes
      nextRunAt: new Date(), // run now
    },
  });

  // Batch Jobs
  await prisma.job.create({
    data: {
      queueId: dataQueue.id,
      status: 'QUEUED',
      jobType: 'BATCH',
      payload: JSON.stringify({ batchIndex: 1, totalItems: 200 }),
      batchId: batch1.id,
    },
  });

  await prisma.job.create({
    data: {
      queueId: dataQueue.id,
      status: 'QUEUED',
      jobType: 'BATCH',
      payload: JSON.stringify({ batchIndex: 2, totalItems: 200 }),
      batchId: batch1.id,
    },
  });

  // Workflow Dependency Jobs
  // Parent Job
  const parentJob = await prisma.job.create({
    data: {
      queueId: criticalQueue.id,
      status: 'QUEUED',
      jobType: 'IMMEDIATE',
      payload: JSON.stringify({ action: 'pull_latest_git_branch' }),
    },
  });

  // Child Job
  const childJob = await prisma.job.create({
    data: {
      queueId: criticalQueue.id,
      status: 'SCHEDULED', // waits on parent to complete
      jobType: 'IMMEDIATE',
      payload: JSON.stringify({ action: 'trigger_deploy_build' }),
    },
  });

  await prisma.jobDependency.create({
    data: {
      parentId: parentJob.id,
      childId: childJob.id,
    },
  });

  console.log('Seeded job workflows and lifecycle examples.');
  console.log('Database seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
