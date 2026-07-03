import { useState, useEffect } from 'react';
import { Cpu, Radio, Activity } from 'lucide-react';

interface Worker {
  id: string;
  hostname: string;
  ipAddress: string;
  status: string;
  registeredAt: string;
  lastHeartbeatAt: string;
  version: string;
}

interface Heartbeat {
  id: string;
  workerId: string;
  cpuUsage: number;
  memoryUsage: number;
  activeJobsCount: number;
  timestamp: string;
}

interface WorkerMonitorProps {
  token: string;
  liveHeartbeats: Record<string, Heartbeat>; // Captured from WebSockets in App.tsx
}

export default function WorkerMonitor({ token, liveHeartbeats }: WorkerMonitorProps) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [history, setHistory] = useState<Heartbeat[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchWorkers = async () => {
    try {
      const res = await fetch('/api/workers', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setWorkers(data);
        if (data.length > 0 && !selectedWorkerId) {
          setSelectedWorkerId(data[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (workerId: string) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/workers/${workerId}/heartbeats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setHistory(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 5000); // refresh list every 5s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedWorkerId) {
      fetchHistory(selectedWorkerId);
    }
  }, [selectedWorkerId]);

  // Merge live WebSocket heartbeats into local history for smooth charts
  useEffect(() => {
    if (!selectedWorkerId) return;
    const liveUpdate = liveHeartbeats[selectedWorkerId];
    if (liveUpdate) {
      setHistory((prev) => {
        // Prevent duplicate logs by matching timestamps (simple check)
        const exists = prev.some(h => new Date(h.timestamp).getTime() === new Date(liveUpdate.timestamp).getTime());
        if (exists) return prev;

        const next = [...prev, liveUpdate];
        if (next.length > 30) {
          next.shift(); // keep last 30 readings
        }
        return next;
      });
    }
  }, [liveHeartbeats, selectedWorkerId]);

  const drawTelemetryChart = (dataValues: number[], color: string, maxLimit: number, label: string) => {
    const svgWidth = 350;
    const svgHeight = 120;
    const padding = 15;
    const chartWidth = svgWidth - padding * 2;
    const chartHeight = svgHeight - padding * 2;
    
    if (dataValues.length === 0) {
      return (
        <div style={styles.chartEmpty}>
          <span>Collecting telemetry...</span>
        </div>
      );
    }

    const minVal = 0;
    const maxVal = Math.max(...dataValues, maxLimit);

    const points = dataValues.map((val, idx) => {
      const x = padding + (idx / (dataValues.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((val - minVal) / (maxVal - minVal)) * chartHeight;
      return { x, y };
    });

    const pathD = points.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    const areaD = `${pathD} L ${points[points.length - 1].x} ${svgHeight - padding} L ${points[0].x} ${svgHeight - padding} Z`;

    return (
      <div style={{ flex: 1 }}>
        <h4 style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          {label} (Current: {dataValues[dataValues.length - 1].toFixed(1)})
        </h4>
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={styles.svg}>
          <defs>
            <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <line x1={padding} y1={padding} x2={svgWidth - padding} y2={padding} stroke="#f1f3f4" />
          <line x1={padding} y1={svgHeight - padding} x2={svgWidth - padding} y2={svgHeight - padding} stroke="#dadce0" />
          
          <path d={areaD} fill={`url(#grad-${label})`} />
          <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
          
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="4"
            fill={color}
          />
        </svg>
      </div>
    );
  };

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case 'ACTIVE': return <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}><Radio size={12} className="badge-running" /> Active</span>;
      case 'SHUTDOWN': return <span style={{ color: 'var(--text-muted)' }}>Shutdown</span>;
      default: return <span style={{ color: 'var(--text-secondary)' }}>Offline</span>;
    }
  };

  const calculateUptime = (registeredAt: string, lastHeartbeat: string) => {
    const start = new Date(registeredAt).getTime();
    const end = new Date(lastHeartbeat).getTime();
    const diffSec = Math.max(0, Math.floor((end - start) / 1000));
    
    if (diffSec < 60) return `${diffSec}s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h ${diffMin % 60}m`;
  };

  return (
    <div>
      <div style={styles.header}>
        <h1>Worker Monitor</h1>
        <p>Observe node processes registry, check cluster sizes, and inspect live resources performance.</p>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: '300px', width: '100%' }}></div>
      ) : workers.length === 0 ? (
        <div style={styles.emptyState}>
          <Cpu size={48} color="var(--text-muted)" style={{ marginBottom: '16px' }} />
          <h3>No Workers Registered</h3>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            Launch a worker process to connect to the scheduling node.
          </p>
        </div>
      ) : (
        <div style={styles.monitorLayout}>
          
          {/* Left Column: Workers list */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h3>Worker Node Clusters</h3>
            {workers.map((worker) => {
              const isSelected = selectedWorkerId === worker.id;
              const live = liveHeartbeats[worker.id];
              const cpu = live ? live.cpuUsage : 0;
              const activeJobs = live ? live.activeJobsCount : 0;

              return (
                <div
                  key={worker.id}
                  className="card"
                  onClick={() => setSelectedWorkerId(worker.id)}
                  style={{
                    ...styles.workerCard,
                    borderColor: isSelected ? 'var(--primary)' : 'var(--border-color)',
                    backgroundColor: isSelected ? 'var(--primary-bg)' : 'var(--bg-card)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Cpu size={18} color={isSelected ? 'var(--primary)' : 'var(--text-secondary)'} />
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>{worker.hostname}</span>
                    </div>
                    {getStatusIndicator(worker.status)}
                  </div>
                  
                  <div style={styles.workerMeta}>
                    <div><span>ID:</span> <code>{worker.id}</code></div>
                    <div><span>IP Address:</span> {worker.ipAddress}</div>
                    <div><span>Uptime:</span> {calculateUptime(worker.registeredAt, worker.lastHeartbeatAt)}</div>
                    <div>
                      <span>Load Parameters:</span> {activeJobs} active jobs {cpu > 0 ? `(${cpu}% CPU)` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Column: Telemetry graphs */}
          <div className="card" style={{ flex: 1.5, marginBottom: 0, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {selectedWorkerId ? (
              <>
                <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={18} color="var(--primary)" />
                    <span>Real-time Diagnostics: {workers.find(w => w.id === selectedWorkerId)?.hostname}</span>
                  </h3>
                  <small style={{ color: 'var(--text-muted)' }}>Daemon version: 1.0.0. Monitoring interval: 5s.</small>
                </div>

                {historyLoading ? (
                  <div className="skeleton" style={{ height: '200px', width: '100%' }}></div>
                ) : (
                  <>
                    <div style={styles.chartsContainer}>
                      {drawTelemetryChart(
                        history.map((h) => h.cpuUsage),
                        '#1a73e8',
                        100,
                        'CPU Utilization (%)'
                      )}
                      {drawTelemetryChart(
                        history.map((h) => h.memoryUsage),
                        '#1e8e3e',
                        256,
                        'Memory Usage (MB)'
                      )}
                    </div>

                    <div>
                      <h4 style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        Heartbeat Telemetry Feed
                      </h4>
                      <div style={styles.consoleLog}>
                        {history.slice().reverse().map((h) => (
                          <div key={h.id} style={{ marginBottom: '4px', display: 'flex', gap: '10px' }}>
                            <span style={{ color: '#80868b' }}>[{new Date(h.timestamp).toLocaleTimeString()}]</span>
                            <span style={{ color: 'var(--success)' }}>[HEARTBEAT]</span>
                            <span>CPU: {h.cpuUsage}%. RAM: {h.memoryUsage}MB. Active Load: {h.activeJobsCount} jobs.</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div style={styles.chartEmpty}>
                <span>Select a worker node to view resource telemetry.</span>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    marginBottom: '24px',
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
  monitorLayout: {
    display: 'flex',
    flexDirection: 'row',
    gap: '24px',
    flexWrap: 'wrap',
  },
  workerCard: {
    cursor: 'pointer',
    padding: '16px',
    marginBottom: 0,
    transition: 'var(--transition-normal)',
  },
  workerMeta: {
    marginTop: '12px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  chartsContainer: {
    display: 'flex',
    gap: '20px',
    flexWrap: 'wrap',
  },
  svg: {
    width: '100%',
    maxHeight: '120px',
    backgroundColor: 'var(--bg-page)',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
  },
  chartEmpty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '120px',
    backgroundColor: 'var(--bg-page)',
    borderRadius: '8px',
    color: 'var(--text-muted)',
    fontSize: '13px',
  },
  consoleLog: {
    backgroundColor: '#202124',
    color: '#f1f3f4',
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: '12px',
    borderRadius: '8px',
    maxHeight: '140px',
    overflowY: 'auto',
    border: '1px solid #3c4043',
    lineHeight: 1.5,
  },
};
