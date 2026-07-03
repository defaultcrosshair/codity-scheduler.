// Global Fetch Interceptor for Standalone Client-Side Mock Mode
// Automatically active when running on live Firebase domains to enable serverless interactive demos.

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

if (!isLocal) {
  console.log('[Mock API] Standalone client-side mode active.');

  // Mock memory state
  let mockQueues = [
    { id: "q-1", name: "critical-ops", priority: "HIGH", concurrencyLimit: 8, isPaused: false, paused: false, projectId: "proj-1", project: { name: "Core Services Router" } },
    { id: "q-2", name: "data-processing", priority: "MEDIUM", concurrencyLimit: 4, isPaused: false, paused: false, projectId: "proj-1", project: { name: "Core Services Router" } },
    { id: "q-3", name: "notification-dispatch", priority: "LOW", concurrencyLimit: 12, isPaused: true, paused: true, projectId: "proj-1", project: { name: "Core Services Router" } }
  ];

  let mockJobs: any[] = [
    { id: "job-1", queueId: "q-1", queue: { name: "critical-ops", priority: "HIGH" }, status: "COMPLETED", jobType: "IMMEDIATE", runCount: 1, maxRetries: 3, payload: '{"taskName":"verify_system_integrity","dryRun":false}', completedAt: new Date(Date.now() - 60000).toISOString(), createdAt: new Date(Date.now() - 65000).toISOString() },
    { id: "job-2", queueId: "q-1", queue: { name: "critical-ops", priority: "HIGH" }, status: "RUNNING", jobType: "IMMEDIATE", runCount: 1, maxRetries: 3, payload: '{"taskName":"cache_refresh_indexes"}', startedAt: new Date(Date.now() - 5000).toISOString(), createdAt: new Date(Date.now() - 6000).toISOString() },
    { id: "job-3", queueId: "q-2", queue: { name: "data-processing", priority: "MEDIUM" }, status: "QUEUED", jobType: "DELAYED", runCount: 0, maxRetries: 3, payload: '{"taskName":"sync_ledger_records"}', runAt: new Date(Date.now() + 30000).toISOString(), createdAt: new Date().toISOString() },
    { id: "job-4", queueId: "q-3", queue: { name: "notification-dispatch", priority: "LOW" }, status: "FAILED", jobType: "IMMEDIATE", runCount: 3, maxRetries: 3, payload: '{"taskName":"email_blast_alerts"}', failedAt: new Date(Date.now() - 120000).toISOString(), createdAt: new Date(Date.now() - 150000).toISOString(), errorMessage: "Connection Timeout on SMTP Relay", suggestedAction: "Check SMTP relay configuration and ensure firewall rules allow outbound traffic on port 587." }
  ];

  const mockWorkers = [
    { id: "worker-node-alpha", name: "worker-node-alpha", status: "ACTIVE", cpuUsage: 12.5, memoryUsage: 142.1, activeJobsCount: 1, lastHeartbeat: new Date().toISOString() },
    { id: "worker-node-beta", name: "worker-node-beta", status: "ACTIVE", cpuUsage: 8.2, memoryUsage: 118.4, activeJobsCount: 0, lastHeartbeat: new Date().toISOString() }
  ];

  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    
    // Auth login
    if (url.includes('/api/auth/login')) {
      const body = JSON.parse(init?.body as string || '{}');
      if (body.email && body.password === 'password123') {
        return new Response(JSON.stringify({
          token: 'mock-jwt-token',
          user: {
            id: 'admin-1',
            email: body.email,
            name: body.email.split('@')[0].toUpperCase() + ' (Mock)',
            role: 'ADMIN',
            organizationId: 'org-1',
            organizationName: 'Codity Corp'
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } else {
        return new Response(JSON.stringify({ error: 'Invalid credentials.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // Projects
    if (url.includes('/api/projects')) {
      return new Response(JSON.stringify([{ id: 'proj-1', name: 'Core Services Router' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Queues
    if (url.includes('/api/queues')) {
      // Toggle queue pause state
      const toggleMatch = url.match(/\/api\/queues\/([^/]+)\/toggle-pause/);
      if (toggleMatch) {
        const queueId = toggleMatch[1];
        mockQueues = mockQueues.map(q => q.id === queueId ? { ...q, isPaused: !q.isPaused, paused: !q.paused } : q);
        const updated = mockQueues.find(q => q.id === queueId);
        return new Response(JSON.stringify(updated), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(mockQueues), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Dashboard stats
    if (url.includes('/api/jobs/stats')) {
      return new Response(JSON.stringify({
        totalJobs: mockJobs.length + 1582,
        statusCounts: {
          COMPLETED: 1582,
          FAILED: mockJobs.filter(j => j.status === 'FAILED').length,
          RUNNING: mockJobs.filter(j => j.status === 'RUNNING').length,
          QUEUED: mockJobs.filter(j => j.status === 'QUEUED').length
        },
        deadLetterCount: mockJobs.filter(j => j.status === 'FAILED').length,
        activeWorkersCount: mockWorkers.length,
        completed24h: 582
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Workers
    if (url.includes('/api/workers')) {
      return new Response(JSON.stringify(mockWorkers), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Jobs Detail request
    const detailMatch = url.match(/\/api\/jobs\/([a-zA-Z0-9-]+)$/);
    if (detailMatch) {
      const jobId = detailMatch[1];
      const job = mockJobs.find(j => j.id === jobId);
      if (job) {
        return new Response(JSON.stringify({
          ...job,
          executions: [
            { id: 'exec-1', workerId: 'worker-node-alpha', status: job.status, startedAt: job.startedAt || new Date().toISOString(), finishedAt: job.completedAt || job.failedAt, attemptNumber: 1 }
          ],
          logs: [
            { id: 'log-1', logType: 'INFO', message: 'Job registered in database.', timestamp: job.createdAt },
            { id: 'log-2', logType: 'INFO', message: `Pulled by worker node worker-node-alpha.`, timestamp: job.startedAt || job.createdAt }
          ],
          dependencies: []
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // Jobs Listing or Posting
    if (url.includes('/api/jobs')) {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string || '{}');
        const newJob = {
          id: 'job-' + Math.random().toString(36).substring(2, 9),
          queueId: body.queueId || 'q-1',
          queue: {
            name: mockQueues.find(q => q.id === (body.queueId || 'q-1'))?.name || 'critical-ops',
            priority: mockQueues.find(q => q.id === (body.queueId || 'q-1'))?.priority || 'HIGH'
          },
          status: 'QUEUED',
          jobType: body.jobType || 'IMMEDIATE',
          runCount: 0,
          maxRetries: 3,
          payload: body.payload || '{}',
          runAt: body.runAt || new Date().toISOString(),
          createdAt: new Date().toISOString()
        };
        mockJobs = [newJob, ...mockJobs];
        
        // Simulate execution background loop client-side
        if (newJob.jobType === 'IMMEDIATE') {
          setTimeout(() => {
            mockJobs = mockJobs.map(j => j.id === newJob.id ? { ...j, status: 'RUNNING', startedAt: new Date().toISOString() } : j);
            setTimeout(() => {
              mockJobs = mockJobs.map(j => j.id === newJob.id ? { ...j, status: 'COMPLETED', completedAt: new Date().toISOString() } : j);
            }, 3000);
          }, 1500);
        }

        return new Response(JSON.stringify(newJob), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }

      // Return paginated jobs wrapper format expected by JobExplorer
      return new Response(JSON.stringify({
        jobs: mockJobs,
        pagination: {
          totalPages: 1,
          totalJobs: mockJobs.length,
          page: 1,
          limit: 8
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return originalFetch(input, init);
  };
}
