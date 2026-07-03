import { app } from './index';
import { prisma } from './db';
import request from 'supertest';
import { WorkerDaemon } from './engine/worker';

describe('Job Scheduler Test Suite', () => {
  let token: string;
  let orgId: string;
  let projId: string;
  let queueId: string;

  beforeAll(async () => {
    // Flush test records (isolated schema setup)
    await prisma.deadLetterQueue.deleteMany({});
    await prisma.jobLog.deleteMany({});
    await prisma.jobExecution.deleteMany({});
    await prisma.jobDependency.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.queue.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});

    // Setup Test Org and User
    const signupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test Engineer',
        role: 'ADMIN',
        organizationName: 'Test Lab Inc'
      });

    token = signupRes.body.token;
    orgId = signupRes.body.user.organizationId;

    // Create Test Project
    const projRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Integrations Lab' });

    projId = projRes.body.id;

    // Create Test Queue with policies
    const queueRes = await request(app)
      .post('/api/queues')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId: projId,
        name: 'test-queue',
        priority: 'HIGH',
        concurrencyLimit: 2,
        retryPolicy: {
          strategy: 'EXPONENTIAL',
          maxRetries: 3,
          baseDelayMs: 1000,
          maxDelayMs: 8000
        }
      });

    queueId = queueRes.body.id;
  });

  afterAll(async () => {
    // Gracefully clean connections to avoid dangling handles
    await prisma.$disconnect();
  });

  describe('1. Backoff Policy Calculations', () => {
    const worker = new WorkerDaemon('test-worker-calc');

    it('should calculate FIXED delays correctly', () => {
      // Accessing private method via bracket notation for testing
      const calc = (worker as any).calculateBackoff.bind(worker);
      expect(calc('FIXED', 1, 2000, 10000)).toBe(2000);
      expect(calc('FIXED', 3, 2000, 10000)).toBe(2000);
    });

    it('should calculate LINEAR backoffs correctly', () => {
      const calc = (worker as any).calculateBackoff.bind(worker);
      expect(calc('LINEAR', 1, 1000, 10000)).toBe(1000);
      expect(calc('LINEAR', 2, 1000, 10000)).toBe(2000);
      expect(calc('LINEAR', 3, 1000, 10000)).toBe(3000);
    });

    it('should calculate EXPONENTIAL backoffs correctly', () => {
      const calc = (worker as any).calculateBackoff.bind(worker);
      expect(calc('EXPONENTIAL', 1, 1000, 10000)).toBe(1000); // 1000 * 2^0
      expect(calc('EXPONENTIAL', 2, 1000, 10000)).toBe(2000); // 1000 * 2^1
      expect(calc('EXPONENTIAL', 3, 1000, 10000)).toBe(4000); // 1000 * 2^2
    });

    it('should enforce max delay thresholds', () => {
      const calc = (worker as any).calculateBackoff.bind(worker);
      expect(calc('EXPONENTIAL', 5, 2000, 10000)).toBe(10000); // 2000 * 2^4 = 32000 -> capped at 10000
    });
  });

  describe('2. Authentication & REST Integrity', () => {
    it('should reject requests lacking JWT bearer token', async () => {
      const res = await request(app).get('/api/projects');
      expect(res.status).toBe(401);
    });

    it('should allow authenticating logged-in user profiles', async () => {
      const res = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('test@example.com');
      expect(res.body.role).toBe('ADMIN');
    });

    it('should create immediate job queue entries', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({
          queueId,
          jobType: 'IMMEDIATE',
          payload: { action: 'pull_latest_git_branch' }
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('QUEUED');
      expect(JSON.parse(res.body.payload).action).toBe('pull_latest_git_branch');
    });
  });

  describe('3. Concurrency Lock & Claims', () => {
    beforeEach(async () => {
      await prisma.jobExecution.deleteMany({});
      await prisma.deadLetterQueue.deleteMany({});
      await prisma.jobLog.deleteMany({});
      await prisma.job.deleteMany({});
    });

    it('should atomically transition a queued job to claimed state', async () => {
      const job = await prisma.job.create({
        data: {
          queueId,
          status: 'QUEUED',
          jobType: 'IMMEDIATE',
          payload: JSON.stringify({ action: 'verify_system_integrity' })
        }
      });

      const workerInstance = new WorkerDaemon('worker-test-concurrency');
      const claimResult = await (workerInstance as any).claimJob();

      expect(claimResult).not.toBeNull();
      expect(claimResult.job.id).toBe(job.id);
      expect(claimResult.job.status).toBe('CLAIMED');
      expect(claimResult.job.lockedByWorkerId).toBe('worker-test-concurrency');
    });

    it('should block claiming if queue is paused', async () => {
      // Pause queue
      await prisma.queue.update({
        where: { id: queueId },
        data: { isPaused: true }
      });

      // Create new job
      await prisma.job.create({
        data: {
          queueId,
          status: 'QUEUED',
          jobType: 'IMMEDIATE',
          payload: JSON.stringify({ action: 'should_not_claim' })
        }
      });

      const workerInstance = new WorkerDaemon('worker-test-paused');
      const claimResult = await (workerInstance as any).claimJob();

      expect(claimResult).toBeNull(); // Should skip paused queue

      // Restore queue
      await prisma.queue.update({
        where: { id: queueId },
        data: { isPaused: false }
      });
    });

    it('should enforce queue concurrency limits', async () => {
      // Set concurrency to 1
      await prisma.queue.update({
        where: { id: queueId },
        data: { concurrencyLimit: 1 }
      });

      // Lock one job as CLAIMED
      await prisma.job.create({
        data: {
          queueId,
          status: 'CLAIMED',
          jobType: 'IMMEDIATE',
          payload: JSON.stringify({ action: 'active_lock' }),
          lockedByWorkerId: 'worker-busy-1'
        }
      });

      // Create a queued job that wants to be claimed
      await prisma.job.create({
        data: {
          queueId,
          status: 'QUEUED',
          jobType: 'IMMEDIATE',
          payload: JSON.stringify({ action: 'pending_run' })
        }
      });

      const workerInstance = new WorkerDaemon('worker-claim-concurrency');
      const claimResult = await (workerInstance as any).claimJob();

      expect(claimResult).toBeNull(); // Concurrency full, skip queue
    });
  });
});
