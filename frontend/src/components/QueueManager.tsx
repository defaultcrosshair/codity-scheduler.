import React, { useState, useEffect } from 'react';
import { Layers, Plus, Pause, Play, Trash2, Edit2, ShieldAlert } from 'lucide-react';

interface RetryPolicy {
  strategy: string;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

interface Queue {
  id: string;
  name: string;
  priority: string;
  concurrencyLimit: number;
  isPaused: boolean;
  projectId: string;
  project: { name: string };
  retryPolicy?: RetryPolicy;
}

interface QueueManagerProps {
  token: string;
  userRole: string;
  selectedProjectId: string;
}

export default function QueueManager({ token, userRole, selectedProjectId }: QueueManagerProps) {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Form State
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [concurrencyLimit, setConcurrencyLimit] = useState(5);
  const [retryStrategy, setRetryStrategy] = useState('EXPONENTIAL');
  const [maxRetries, setMaxRetries] = useState(3);
  const [baseDelayMs, setBaseDelayMs] = useState(1000);
  const [maxDelayMs, setMaxDelayMs] = useState(30000);
  const [error, setError] = useState('');

  const isReadOnly = userRole === 'VIEWER';

  const fetchQueues = async () => {
    try {
      const res = await fetch('/api/queues', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        // Filter by selected project in frontend
        const filtered = data.filter((q: Queue) => q.projectId === selectedProjectId);
        setQueues(filtered);
      }
    } catch (err) {
      console.error('Error fetching queues:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueues();
  }, [selectedProjectId]);

  const handleTogglePause = async (queueId: string) => {
    if (isReadOnly) return;
    try {
      const res = await fetch(`/api/queues/${queueId}/toggle-pause`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchQueues();
      }
    } catch (err) {
      console.error('Error toggling queue pause:', err);
    }
  };

  const handleDelete = async (queueId: string) => {
    if (userRole !== 'ADMIN') return;
    if (!window.confirm('Are you sure you want to delete this queue? All jobs under this queue will be purged.')) return;
    
    try {
      const res = await fetch(`/api/queues/${queueId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchQueues();
      }
    } catch (err) {
      console.error('Error deleting queue:', err);
    }
  };

  const handleOpenCreateModal = () => {
    setEditingQueueId(null);
    setName('');
    setPriority('MEDIUM');
    setConcurrencyLimit(5);
    setRetryStrategy('EXPONENTIAL');
    setMaxRetries(3);
    setBaseDelayMs(1000);
    setMaxDelayMs(30000);
    setError('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (queue: Queue) => {
    setEditingQueueId(queue.id);
    setName(queue.name);
    setPriority(queue.priority);
    setConcurrencyLimit(queue.concurrencyLimit);
    setRetryStrategy(queue.retryPolicy?.strategy || 'FIXED');
    setMaxRetries(queue.retryPolicy?.maxRetries ?? 3);
    setBaseDelayMs(queue.retryPolicy?.baseDelayMs ?? 1000);
    setMaxDelayMs(queue.retryPolicy?.maxDelayMs ?? 30000);
    setError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setError('');

    const url = editingQueueId ? `/api/queues/${editingQueueId}` : '/api/queues';
    const method = editingQueueId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: selectedProjectId,
          name: name.trim(),
          priority,
          concurrencyLimit: parseInt(String(concurrencyLimit), 10),
          retryPolicy: {
            strategy: retryStrategy,
            maxRetries: parseInt(String(maxRetries), 10),
            baseDelayMs: parseInt(String(baseDelayMs), 10),
            maxDelayMs: parseInt(String(maxDelayMs), 10),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save queue.');
      }

      setIsModalOpen(false);
      fetchQueues();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getPriorityBadgeClass = (prio: string) => {
    switch (prio) {
      case 'HIGH': return 'badge badge-priority-high';
      case 'MEDIUM': return 'badge badge-priority-medium';
      default: return 'badge badge-priority-low';
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1>Queues Manager</h1>
          <p>Configure priorities, concurrency limits, and retry policies for worker dispatching.</p>
        </div>
        {!isReadOnly && (
          <button className="btn btn-primary" onClick={handleOpenCreateModal}>
            <Plus size={16} />
            <span>Create Queue</span>
          </button>
        )}
      </div>

      {isReadOnly && (
        <div style={styles.readOnlyNotice}>
          <ShieldAlert size={16} color="var(--warning)" />
          <span>You are logged in as a <strong>Viewer</strong>. Creating and editing queues is restricted.</span>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          <div className="skeleton" style={{ height: '220px' }}></div>
          <div className="skeleton" style={{ height: '220px' }}></div>
        </div>
      ) : queues.length === 0 ? (
        <div style={styles.emptyState}>
          <Layers size={48} color="var(--text-muted)" style={{ marginBottom: '16px' }} />
          <h3>No Queues Configured</h3>
          <p style={{ maxWidth: '380px', textAlign: 'center', marginTop: '4px' }}>
            Create a queue to start distributing jobs to the background workers.
          </p>
        </div>
      ) : (
        <div style={styles.grid}>
          {queues.map((queue) => (
            <div key={queue.id} className="card" style={{ ...styles.queueCard, opacity: queue.isPaused ? 0.75 : 1 }}>
              <div style={styles.cardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={18} color={queue.isPaused ? 'var(--text-muted)' : 'var(--primary)'} />
                  <span style={styles.queueName}>{queue.name}</span>
                </div>
                <span className={getPriorityBadgeClass(queue.priority)}>{queue.priority}</span>
              </div>

              <div style={styles.cardBody}>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Concurrency Limit:</span>
                  <span style={styles.metaVal}>{queue.concurrencyLimit} active jobs</span>
                </div>
                
                {queue.retryPolicy && (
                  <div style={styles.metaRow}>
                    <span style={styles.metaLabel}>Retry Strategy:</span>
                    <span style={styles.metaVal}>
                      {queue.retryPolicy.strategy.toLowerCase()} ({queue.retryPolicy.maxRetries}x, {queue.retryPolicy.baseDelayMs}ms)
                    </span>
                  </div>
                )}

                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Status:</span>
                  <span className={`badge ${queue.isPaused ? 'badge-cancelled' : 'badge-completed'}`}>
                    {queue.isPaused ? 'Paused' : 'Active'}
                  </span>
                </div>
              </div>

              <div style={styles.cardFooter}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {!isReadOnly && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleTogglePause(queue.id)}
                      title={queue.isPaused ? 'Resume execution' : 'Pause execution'}
                      style={{ padding: '6px 12px' }}
                    >
                      {queue.isPaused ? <Play size={14} /> : <Pause size={14} />}
                      <span>{queue.isPaused ? 'Resume' : 'Pause'}</span>
                    </button>
                  )}
                  {!isReadOnly && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleOpenEditModal(queue)}
                      title="Edit Configuration"
                      style={{ padding: '6px 12px' }}
                    >
                      <Edit2 size={14} />
                      <span>Edit</span>
                    </button>
                  )}
                </div>

                {userRole === 'ADMIN' && (
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDelete(queue.id)}
                    title="Delete Queue"
                    style={{ padding: '6px', minWidth: '32px' }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">{editingQueueId ? 'Edit Queue Settings' : 'Create New Queue'}</h2>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>×</button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {error && <div style={styles.errorText}>{error}</div>}

                <div className="form-group">
                  <label className="form-label">Queue Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    disabled={!!editingQueueId} // Can't change name once created for safety
                    placeholder="e.g. email-notifications"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Priority</label>
                    <select
                      className="form-input"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                    >
                      <option value="HIGH">HIGH</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="LOW">LOW</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Concurrency Limit</label>
                    <input
                      type="number"
                      className="form-input"
                      value={concurrencyLimit}
                      onChange={(e) => setConcurrencyLimit(Math.max(1, parseInt(e.target.value) || 1))}
                      min="1"
                      max="100"
                      required
                    />
                  </div>
                </div>

                <fieldset style={styles.fieldset}>
                  <legend style={styles.legend}>Retry Backoff Policy</legend>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Strategy</label>
                      <select
                        className="form-input"
                        value={retryStrategy}
                        onChange={(e) => setRetryStrategy(e.target.value)}
                      >
                        <option value="FIXED">Fixed Delay</option>
                        <option value="LINEAR">Linear Backoff</option>
                        <option value="EXPONENTIAL">Exponential Backoff</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Max Attempts</label>
                      <input
                        type="number"
                        className="form-input"
                        value={maxRetries}
                        onChange={(e) => setMaxRetries(Math.max(0, parseInt(e.target.value) || 0))}
                        min="0"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Base Delay (ms)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={baseDelayMs}
                        onChange={(e) => setBaseDelayMs(Math.max(100, parseInt(e.target.value) || 100))}
                        min="100"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Max Delay (ms)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={maxDelayMs}
                        onChange={(e) => setMaxDelayMs(Math.max(1000, parseInt(e.target.value) || 1000))}
                        min="1000"
                        required
                      />
                    </div>
                  </div>
                </fieldset>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingQueueId ? 'Save Changes' : 'Create Queue'}
                </button>
              </div>
            </form>
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
  readOnlyNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#fffbe6',
    border: '1px solid #ffe58f',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#ad7e18',
    marginBottom: '20px',
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
    marginTop: '20px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '24px',
  },
  queueCard: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '14px',
    marginBottom: '14px',
  },
  queueName: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  cardBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '18px',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
  },
  metaLabel: {
    color: 'var(--text-secondary)',
  },
  metaVal: {
    color: 'var(--text-primary)',
    fontWeight: 500,
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: '1px solid var(--border-color)',
    paddingTop: '14px',
  },
  fieldset: {
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    padding: '16px',
    marginTop: '16px',
    marginBottom: '8px',
  },
  legend: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    padding: '0 8px',
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
