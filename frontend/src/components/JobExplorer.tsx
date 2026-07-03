import { useState, useEffect } from 'react';
import { Play, RotateCcw, XCircle, Search, Info, Terminal, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

interface Job {
  id: string;
  queueId: string;
  queue: { name: string; priority: string };
  status: string;
  jobType: string;
  payload: string;
  cronExpression?: string;
  nextRunAt?: string;
  completedAt?: string;
  failedAt?: string;
  runCount: number;
  maxRetries: number;
  batchId?: string;
  batch?: { name: string };
  createdAt: string;
}

interface JobDetail extends Job {
  executions: Array<{
    id: string;
    workerId: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
    errorDetails?: string;
    attemptNumber: number;
    durationMs?: number;
  }>;
  logs: Array<{
    id: string;
    logType: string;
    message: string;
    timestamp: string;
  }>;
  dependencies: Array<{
    id: string;
    parent: { id: string; status: string };
  }>;
}

interface Queue {
  id: string;
  name: string;
}

interface JobExplorerProps {
  token: string;
  userRole: string;
  selectedProjectId: string;
}

export default function JobExplorer({ token, userRole, selectedProjectId }: JobExplorerProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering & Pagination
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [queueFilter, setQueueFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Modal States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Creation Form State
  const [createQueueId, setCreateQueueId] = useState('');
  const [createType, setCreateType] = useState('IMMEDIATE');
  const [createPayload, setCreatePayload] = useState('{\n  "taskName": "verify_system_integrity",\n  "dryRun": false\n}');
  const [createDelayMs, setCreateDelayMs] = useState('5000');
  const [createNextRunAt, setCreateNextRunAt] = useState('');
  const [createCron, setCreateCron] = useState('*/5 * * * *');
  const [createBatchName, setCreateBatchName] = useState('');
  const [createParentJobId, setCreateParentJobId] = useState('');
  const [formError, setFormError] = useState('');

  const isReadOnly = userRole === 'VIEWER';

  const fetchQueues = async () => {
    try {
      const res = await fetch('/api/queues', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        const filtered = data.filter((q: any) => q.projectId === selectedProjectId);
        setQueues(filtered);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: '8',
      });
      if (statusFilter) queryParams.append('status', statusFilter);
      if (typeFilter) queryParams.append('jobType', typeFilter);
      if (queueFilter) queryParams.append('queueId', queueFilter);
      if (search) queryParams.append('search', search);

      const res = await fetch(`/api/jobs?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setJobs(data.jobs);
        setTotalPages(data.pagination.totalPages || 1);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchJobDetail = async (jobId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setJobDetail(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    fetchQueues();
    setPage(1);
  }, [selectedProjectId]);

  useEffect(() => {
    fetchJobs();
  }, [selectedProjectId, page, statusFilter, typeFilter, queueFilter, search]);

  useEffect(() => {
    let interval: any = null;
    if (selectedJobId) {
      fetchJobDetail(selectedJobId);
      // Set interval to poll log updates if the job is running or claimed
      interval = setInterval(() => {
        if (jobDetail && ['RUNNING', 'CLAIMED'].includes(jobDetail.status)) {
          fetchJobDetail(selectedJobId);
        }
      }, 2000);
    } else {
      setJobDetail(null);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedJobId, jobDetail?.status]);

  const handleCancelJob = async (jobId: string) => {
    if (isReadOnly) return;
    if (!window.confirm('Cancel this pending job?')) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchJobs();
        if (selectedJobId === jobId) fetchJobDetail(jobId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    if (isReadOnly) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchJobs();
        if (selectedJobId === jobId) fetchJobDetail(jobId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setFormError('');

    // Payload validation
    try {
      JSON.parse(createPayload);
    } catch (err) {
      setFormError('Payload must be a valid JSON string.');
      return;
    }

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          queueId: createQueueId,
          jobType: createType,
          payload: createPayload,
          cronExpression: createType === 'RECURRING' ? createCron : undefined,
          delayMs: createType === 'DELAYED' ? createDelayMs : undefined,
          nextRunAt: createType === 'SCHEDULED' ? createNextRunAt : undefined,
          batchName: createBatchName || undefined,
          dependencies: createParentJobId.trim() ? [createParentJobId.trim()] : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch job.');
      }

      setIsCreateOpen(false);
      fetchJobs();
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  const handleOpenCreateModal = () => {
    if (queues.length === 0) {
      alert('Configure at least one Queue in Queue Manager first.');
      return;
    }
    setCreateQueueId(queues[0].id);
    setCreateType('IMMEDIATE');
    setCreatePayload('{\n  "taskName": "verify_system_integrity",\n  "dryRun": false\n}');
    setCreateDelayMs('5000');
    setCreateNextRunAt(new Date(Date.now() + 600000).toISOString().slice(0, 16));
    setCreateCron('*/5 * * * *');
    setCreateBatchName('');
    setCreateParentJobId('');
    setFormError('');
    setIsCreateOpen(true);
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'QUEUED': return 'badge badge-queued';
      case 'SCHEDULED': return 'badge badge-scheduled';
      case 'CLAIMED': return 'badge badge-claimed';
      case 'RUNNING': return 'badge badge-running';
      case 'COMPLETED': return 'badge badge-completed';
      case 'FAILED': return 'badge badge-failed';
      case 'CANCELLED': return 'badge badge-cancelled';
      default: return 'badge';
    }
  };

  // Helper to extract AI Diagnostics block from execution logs
  const parseAIDiagnostics = (logs: any[]) => {
    const aiLog = logs.find(l => l.logType === 'INFO' && l.message.includes('[AI DIAGNOSTICS]'));
    if (!aiLog) return null;

    const msg = aiLog.message;
    const catMatch = msg.match(/Category:\s*([A-Z_]+)/);
    const reasonMatch = msg.match(/Reason:\s*([^.]+\.)/);
    const recMatch = msg.match(/Recommendation:\s*([^(]+)/);
    const confMatch = msg.match(/Confidence:\s*(\d+)%/);

    return {
      category: catMatch ? catMatch[1] : 'UNKNOWN',
      reason: reasonMatch ? reasonMatch[1] : 'N/A',
      recommendation: recMatch ? recMatch[1] : 'N/A',
      confidence: confMatch ? confMatch[1] : 'N/A',
    };
  };

  const aiDiagnostics = jobDetail ? parseAIDiagnostics(jobDetail.logs) : null;

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1>Job Explorer</h1>
          <p>Inspect backgrounds jobs pipeline, execute new tasks, and view execution consoles.</p>
        </div>
        {!isReadOnly && (
          <button className="btn btn-primary" onClick={handleOpenCreateModal}>
            <Play size={16} fill="white" />
            <span>Create Job</span>
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="card" style={styles.filterToolbar}>
        <div style={styles.searchContainer}>
          <Search size={18} color="var(--text-muted)" />
          <input
            type="text"
            className="form-input"
            style={{ border: 'none', padding: '6px' }}
            placeholder="Search payload elements (e.g. verify_system_integrity)..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <div style={styles.dropdownFilters}>
          <div style={styles.filterGroup}>
            <span style={styles.filterLabel}>Status</span>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={styles.select}>
              <option value="">All Statuses</option>
              <option value="QUEUED">Queued</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="CLAIMED">Claimed</option>
              <option value="RUNNING">Running</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <span style={styles.filterLabel}>Type</span>
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} style={styles.select}>
              <option value="">All Types</option>
              <option value="IMMEDIATE">Immediate</option>
              <option value="DELAYED">Delayed</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="RECURRING">Recurring</option>
              <option value="BATCH">Batch</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <span style={styles.filterLabel}>Queue</span>
            <select value={queueFilter} onChange={(e) => { setQueueFilter(e.target.value); setPage(1); }} style={styles.select}>
              <option value="">All Queues</option>
              {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Jobs Table */}
      {loading ? (
        <div className="skeleton" style={{ height: '360px', width: '100%', borderRadius: '8px' }}></div>
      ) : jobs.length === 0 ? (
        <div style={styles.emptyState}>
          <Terminal size={48} color="var(--text-muted)" style={{ marginBottom: '16px' }} />
          <h3>No Jobs Match Filter</h3>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            Try tweaking your filters or dispatching a new job.
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Queue</th>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Created At</th>
                <th>Trigger Time / Done</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                    <span title={job.id}>{job.id.substring(0, 8)}...</span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{job.queue.name}</span>
                  </td>
                  <td style={{ fontSize: '13px', fontWeight: 500 }}>{job.jobType}</td>
                  <td>
                    <span className={getStatusBadgeClass(job.status)}>{job.status}</span>
                  </td>
                  <td>{job.runCount} / {job.maxRetries}</td>
                  <td>{new Date(job.createdAt).toLocaleTimeString()}</td>
                  <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {job.status === 'COMPLETED' && job.completedAt
                      ? `Completed at ${new Date(job.completedAt).toLocaleTimeString()}`
                      : job.status === 'FAILED' && job.failedAt
                      ? `Failed at ${new Date(job.failedAt).toLocaleTimeString()}`
                      : job.nextRunAt
                      ? `Scheduled: ${new Date(job.nextRunAt).toLocaleTimeString()}`
                      : 'Immediate'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                        onClick={() => setSelectedJobId(job.id)}
                        title="Inspect logs and execution timeline"
                      >
                        <Info size={14} />
                        <span>Inspect</span>
                      </button>

                      {['QUEUED', 'SCHEDULED'].includes(job.status) && !isReadOnly && (
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px', minWidth: '24px' }}
                          onClick={() => handleCancelJob(job.id)}
                          title="Cancel Job"
                        >
                          <XCircle size={14} />
                        </button>
                      )}

                      {job.status === 'FAILED' && !isReadOnly && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px', minWidth: '24px', borderColor: 'var(--success)', color: 'var(--success)' }}
                          onClick={() => handleRetryJob(job.id)}
                          title="Manual Retry Job"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div style={styles.pagination}>
              <button
                className="btn btn-secondary"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                style={{ padding: '6px' }}
              >
                <ChevronLeft size={16} />
              </button>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-secondary"
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                style={{ padding: '6px' }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* CREATE JOB FORM MODAL */}
      {isCreateOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Create Background Job</h2>
              <button className="modal-close" onClick={() => setIsCreateOpen(false)}>×</button>
            </div>
            
            <form onSubmit={handleCreateJob}>
              <div className="modal-body">
                {formError && <div style={styles.errorText}>{formError}</div>}

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Target Queue</label>
                    <select
                      className="form-input"
                      value={createQueueId}
                      onChange={(e) => setCreateQueueId(e.target.value)}
                      required
                    >
                      {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Job Dispatch Method</label>
                    <select
                      className="form-input"
                      value={createType}
                      onChange={(e) => setCreateType(e.target.value)}
                      required
                    >
                      <option value="IMMEDIATE">Immediate (Run now)</option>
                      <option value="DELAYED">Delayed (Wait duration)</option>
                      <option value="SCHEDULED">Scheduled (Specific time)</option>
                      <option value="RECURRING">Recurring (Cron schedule)</option>
                    </select>
                  </div>
                </div>

                {createType === 'DELAYED' && (
                  <div className="form-group">
                    <label className="form-label">Delay Time (milliseconds)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={createDelayMs}
                      onChange={(e) => setCreateDelayMs(e.target.value)}
                      min="1"
                      required
                    />
                  </div>
                )}

                {createType === 'SCHEDULED' && (
                  <div className="form-group">
                    <label className="form-label">Target Execution Timestamp</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={createNextRunAt}
                      onChange={(e) => setCreateNextRunAt(e.target.value)}
                      required
                    />
                  </div>
                )}

                {createType === 'RECURRING' && (
                  <div className="form-group">
                    <label className="form-label">Cron Expression</label>
                    <input
                      type="text"
                      className="form-input"
                      value={createCron}
                      onChange={(e) => setCreateCron(e.target.value)}
                      placeholder="*/5 * * * *"
                      required
                    />
                    <small style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Standard 5-field cron. E.g., <code>*/5 * * * *</code> (every 5m) or <code>0 * * * *</code> (every hour)
                    </small>
                  </div>
                )}

                <div className="form-row" style={{ marginTop: '10px' }}>
                  <div className="form-group">
                    <label className="form-label">Workflow: Depends On Job ID (Optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={createParentJobId}
                      onChange={(e) => setCreateParentJobId(e.target.value)}
                      placeholder="Paste parent job UUID"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Batch Group Name (Optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={createBatchName}
                      onChange={(e) => setCreateBatchName(e.target.value)}
                      placeholder="e.g. user-sync-batch"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Job Payload (JSON format)</label>
                  <textarea
                    className="form-input"
                    value={createPayload}
                    onChange={(e) => setCreatePayload(e.target.value)}
                    style={{ fontFamily: 'monospace', height: '120px', resize: 'vertical' }}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Queue Job
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* JOB INSPECT & TIMELINE MODAL */}
      {selectedJobId && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '850px', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Job Inspector</h2>
                <small style={{ color: 'var(--text-muted)' }}>ID: {selectedJobId}</small>
              </div>
              <button className="modal-close" onClick={() => setSelectedJobId(null)}>×</button>
            </div>

            {detailLoading || !jobDetail ? (
              <div className="modal-body" style={{ textAlign: 'center', padding: '60px 0' }}>
                <div className="skeleton" style={{ height: '30px', width: '30%', margin: '0 auto 12px' }}></div>
                <div className="skeleton" style={{ height: '200px', width: '90%', margin: '0 auto' }}></div>
              </div>
            ) : (
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
                
                {/* AI DIAGNOSTICS IF FAILED */}
                {jobDetail.status === 'FAILED' && aiDiagnostics && (
                  <div style={styles.aiDiagCard}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <AlertTriangle size={24} color="var(--danger)" style={{ flexShrink: 0, marginTop: '2px' }} />
                      <div>
                        <h3 style={{ color: 'var(--danger)', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>AI Failure Diagnostic Analysis</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', backgroundColor: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                            Confidence: {aiDiagnostics.confidence}%
                          </span>
                        </h3>
                        <p style={{ color: 'var(--text-primary)', marginTop: '6px', fontSize: '13px' }}>
                          <strong>Reason identified:</strong> {aiDiagnostics.reason}
                        </p>
                        <p style={{ color: 'var(--text-primary)', marginTop: '4px', fontSize: '13px' }}>
                          <strong>Recommended resolution:</strong> {aiDiagnostics.recommendation}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div style={styles.inspectorGrid}>
                  {/* Left Column: Properties */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <h3>Properties</h3>
                    <div style={styles.detailRow}><span style={styles.detailLabel}>Type</span><span style={styles.detailValue}>{jobDetail.jobType}</span></div>
                    <div style={styles.detailRow}><span style={styles.detailLabel}>Status</span><span className={getStatusBadgeClass(jobDetail.status)}>{jobDetail.status}</span></div>
                    <div style={styles.detailRow}><span style={styles.detailLabel}>Queue</span><span style={styles.detailValue}>{jobDetail.queue.name}</span></div>
                    <div style={styles.detailRow}><span style={styles.detailLabel}>Priority</span><span style={styles.detailValue}>{jobDetail.queue.priority}</span></div>
                    <div style={styles.detailRow}><span style={styles.detailLabel}>Attempts</span><span style={styles.detailValue}>{jobDetail.runCount} / {jobDetail.maxRetries}</span></div>
                    {jobDetail.cronExpression && (
                      <div style={styles.detailRow}><span style={styles.detailLabel}>Cron Expression</span><span style={styles.detailValue}>{jobDetail.cronExpression}</span></div>
                    )}
                    {jobDetail.batch && (
                      <div style={styles.detailRow}><span style={styles.detailLabel}>Batch Cluster</span><span style={styles.detailValue}>{jobDetail.batch.name}</span></div>
                    )}

                    {jobDetail.dependencies.length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <h4 style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Dependencies (Parents)</h4>
                        {jobDetail.dependencies.map(d => (
                          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '4px 6px', backgroundColor: 'var(--bg-page)', borderRadius: '4px', marginBottom: '4px' }}>
                            <span style={{ fontFamily: 'monospace' }}>{d.parent.id.substring(0, 8)}...</span>
                            <span className={getStatusBadgeClass(d.parent.status)} style={{ fontSize: '10px', padding: '1px 4px' }}>{d.parent.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Payload & timeline */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h3>Execution Parameter Payload</h3>
                    <pre style={styles.pre}>{JSON.stringify(JSON.parse(jobDetail.payload), null, 2)}</pre>
                  </div>
                </div>

                {/* TIMELINE OF WORKER ATTEMPTS */}
                <div>
                  <h3 style={{ marginBottom: '8px' }}>Attempt Execution Ledger</h3>
                  {jobDetail.executions.length === 0 ? (
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No execution attempts recorded yet.</p>
                  ) : (
                    <div className="table-container" style={{ border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                      <table className="table" style={{ fontSize: '13px' }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--bg-page)' }}>
                            <th>Attempt</th>
                            <th>Worker ID</th>
                            <th>Status</th>
                            <th>Duration (ms)</th>
                            <th>Timestamp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {jobDetail.executions.map(exec => (
                            <tr key={exec.id}>
                              <td>#{exec.attemptNumber}</td>
                              <td style={{ fontFamily: 'monospace' }}>{exec.workerId}</td>
                              <td><span className={getStatusBadgeClass(exec.status)} style={{ fontSize: '11px' }}>{exec.status}</span></td>
                              <td>{exec.durationMs ? `${exec.durationMs}ms` : 'Running...'}</td>
                              <td>{new Date(exec.startedAt).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* STDOUT LOG CONSOLE */}
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Terminal size={16} />
                    <span>Real-time Stdout Log Feed</span>
                  </h3>
                  <div style={styles.consoleBox}>
                    {jobDetail.logs.length === 0 ? (
                      <div style={{ color: '#888', fontStyle: 'italic' }}>System waiting for execution...</div>
                    ) : (
                      jobDetail.logs.map(log => {
                        const getLogColor = (type: string) => {
                          if (type === 'ERROR') return '#f28b82'; // soft red
                          if (type === 'WARN') return '#fdd663'; // soft yellow
                          return '#81c995'; // soft green
                        };
                        return (
                          <div key={log.id} style={{ marginBottom: '4px', display: 'flex', gap: '8px' }}>
                            <span style={{ color: '#80868b' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                            <span style={{ color: getLogColor(log.logType), fontWeight: 600 }}>[{log.logType}]</span>
                            <span>{log.message}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>
            )}

            <div className="modal-footer" style={{ borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                {jobDetail && jobDetail.status === 'FAILED' && !isReadOnly && (
                  <button className="btn btn-primary" onClick={() => handleRetryJob(jobDetail.id)}>
                    <RotateCcw size={14} />
                    <span>Manual Retry Now</span>
                  </button>
                )}
                {jobDetail && ['QUEUED', 'SCHEDULED'].includes(jobDetail.status) && !isReadOnly && (
                  <button className="btn btn-danger" onClick={() => handleCancelJob(jobDetail.id)}>
                    <XCircle size={14} />
                    <span>Cancel Job</span>
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => setSelectedJobId(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  filterToolbar: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '24px',
    padding: '16px 20px',
    flexWrap: 'wrap',
    marginBottom: '20px',
  },
  searchContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--border-radius-md)',
    padding: '2px 10px',
    flex: 1,
    minWidth: '260px',
  },
  dropdownFilters: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
  },
  filterLabel: {
    color: 'var(--text-secondary)',
    fontWeight: 500,
  },
  select: {
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--border-radius-md)',
    padding: '6px 12px',
    outline: 'none',
    fontSize: '13px',
    backgroundColor: '#fff',
    cursor: 'pointer',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px',
    backgroundColor: 'var(--bg-card)',
    borderRadius: 'var(--border-radius-md)',
    border: '1px dashed var(--border-color)',
  },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    padding: '16px',
    backgroundColor: 'var(--bg-card)',
    borderTop: '1px solid var(--border-color)',
  },
  inspectorGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.3fr',
    gap: '24px',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    borderBottom: '1px solid var(--bg-page)',
    paddingBottom: '6px',
  },
  detailLabel: {
    color: 'var(--text-secondary)',
  },
  detailValue: {
    color: 'var(--text-primary)',
    fontWeight: 500,
  },
  pre: {
    margin: 0,
    padding: '14px',
    borderRadius: '8px',
    backgroundColor: 'var(--bg-page)',
    border: '1px solid var(--border-color)',
    fontSize: '12px',
    fontFamily: 'monospace',
    overflowX: 'auto',
    maxHeight: '180px',
  },
  consoleBox: {
    backgroundColor: '#202124',
    color: '#f1f3f4',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '16px',
    borderRadius: '8px',
    maxHeight: '180px',
    overflowY: 'auto',
    border: '1px solid #3c4043',
    lineHeight: 1.6,
  },
  aiDiagCard: {
    backgroundColor: '#fce8e6',
    border: '1px solid #f5c2c2',
    borderRadius: '8px',
    padding: '16px',
  },
  errorText: {
    backgroundColor: 'var(--danger-bg)',
    color: 'var(--danger)',
    padding: '10px',
    borderRadius: '4px',
    fontSize: '13px',
    marginBottom: '16px',
    textAlign: 'center',
  },
};
