import { useState, useEffect, useRef } from 'react';
import Login from './components/Login';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import QueueManager from './components/QueueManager';
import JobExplorer from './components/JobExplorer';
import WorkerMonitor from './components/WorkerMonitor';
import InteractiveGrid from './components/InteractiveGrid';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  organizationName: string;
}



interface Heartbeat {
  id: string;
  workerId: string;
  cpuUsage: number;
  memoryUsage: number;
  activeJobsCount: number;
  timestamp: string;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<User | null>(
    localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Global Audio Feedback via Web Audio API (No external assets required)
  useEffect(() => {
    let sharedCtx: AudioContext | null = null;

    const getSharedCtx = () => {
      if (!sharedCtx) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          sharedCtx = new AudioCtx();
        }
      }
      if (sharedCtx && sharedCtx.state === 'suspended') {
        sharedCtx.resume().catch(() => {});
      }
      return sharedCtx;
    };

    let decodedBuffer: AudioBuffer | null = null;

    const loadClickSound = async (ctx: AudioContext) => {
      if (decodedBuffer) return decodedBuffer;
      try {
        const response = await fetch('/click.mp3');
        const arrayBuffer = await response.arrayBuffer();
        decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
        return decodedBuffer;
      } catch (e) {
        console.warn('Failed to load click sound:', e);
        return null;
      }
    };

    const playClickClack = async () => {
      try {
        const ctx = getSharedCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        
        const buffer = await loadClickSound(ctx);
        if (!buffer) return;
        
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        
        source.buffer = buffer;
        
        // Pitch adjustment: slightly lower pitched (0.85 playbackRate slows down the sample and lowers its pitch)
        source.playbackRate.setValueAtTime(0.85, ctx.currentTime);
        
        // Volume adjustment: very subtle click feedback
        gain.gain.setValueAtTime(0.20, ctx.currentTime);
        
        source.connect(gain);
        gain.connect(ctx.destination);
        
        source.start(0);
      } catch (e) {}
    };

    // User interaction listener to resume/unlock context (bypasses browser autoplay restrictions)
    const unlockAudio = () => {
      getSharedCtx();
      document.removeEventListener('mousedown', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
    };
    document.addEventListener('mousedown', unlockAudio);
    document.addEventListener('keydown', unlockAudio);

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const interactiveEl = target.closest('button, select, input, textarea, .card, [role="button"]');
      if (interactiveEl) {
        playClickClack();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mousedown', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  // Real-time state from WebSockets
  const [liveHeartbeats, setLiveHeartbeats] = useState<Record<string, Heartbeat>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const handleLoginSuccess = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setSelectedProjectId('');
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  // Fetch projects when logged in
  useEffect(() => {
    if (!token) return;

    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/projects', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && data.length > 0) {
          setSelectedProjectId(data[0].id);
        }
      } catch (err) {
        console.error('Failed to load projects:', err);
      }
    };

    fetchProjects();
  }, [token]);

  // Setup WebSocket connection
  useEffect(() => {
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let mockSimInterval: any = null;
    
    const connectWS = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connection established.');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'worker_heartbeat') {
            const hb = message.data as Heartbeat;
            setLiveHeartbeats((prev) => ({
              ...prev,
              [hb.workerId]: hb,
            }));
          }
        } catch (err) {
          console.error('[WebSocket] Error parsing socket payload:', err);
        }
      };

      ws.onclose = () => {
        console.log('[WebSocket] Connection severed. Retrying...');
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          if (!mockSimInterval) {
            console.log('[WebSocket] Initiating Standalone Mock simulation.');
            mockSimInterval = setInterval(() => {
              const workers = ['worker-node-alpha', 'worker-node-beta'];
              workers.forEach(wId => {
                setLiveHeartbeats((prev) => ({
                  ...prev,
                  [wId]: {
                    id: 'hb-' + Math.random().toString(36).substring(2, 9),
                    workerId: wId,
                    cpuUsage: Math.floor(Math.random() * 30 + 10),
                    memoryUsage: Math.floor(Math.random() * 20 + 115),
                    activeJobsCount: Math.floor(Math.random() * 2),
                    timestamp: new Date().toISOString()
                  }
                }));
              });
            }, 2000);
          }
        } else {
          setTimeout(() => {
            if (token) connectWS(); // Reconnect if still logged in
          }, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[WebSocket] Socket error occurred:', err);
        ws.close();
      };
    };

    connectWS();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (mockSimInterval) {
        clearInterval(mockSimInterval);
      }
    };
  }, [token]);

  if (!token || !user) {
    return (
      <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <InteractiveGrid />
        <Login onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard token={token} selectedProjectId={selectedProjectId} />;
      case 'queues':
        return <QueueManager token={token} userRole={user.role} selectedProjectId={selectedProjectId} />;
      case 'jobs':
        return <JobExplorer token={token} userRole={user.role} selectedProjectId={selectedProjectId} />;
      case 'workers':
        return <WorkerMonitor token={token} liveHeartbeats={liveHeartbeats} />;
      default:
        return <Dashboard token={token} selectedProjectId={selectedProjectId} />;
    }
  };

  return (
    <div className="app-container" style={{ flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Interactive technical background grid */}
      <InteractiveGrid />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column', position: 'relative' }}>
        {/* Floating top hover-reveal menu */}
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
        
        {/* Main scrollable viewport */}
        <main className="scrollable-area" style={{ flex: 1, paddingTop: '48px' }}>
          {renderActiveTab()}
        </main>
      </div>

      {/* Bottom control ribbon */}
      <Navbar
        user={user}
        onLogout={handleLogout}
      />
    </div>
  );
}
