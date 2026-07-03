import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { initWebSocketServer } from './ws';
import { Scheduler } from './engine/scheduler';
import { WorkerDaemon } from './engine/worker';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import queueRoutes from './routes/queues';
import jobRoutes from './routes/jobs';
import workerRoutes from './routes/workers';

const app = express();
const port = process.env.PORT || 4000;
const server = createServer(app);

app.use(cors({
  origin: '*',
}));

app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/queues', queueRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/workers', workerRoutes);

// Static client builds
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

app.get('*', (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'), (err: any) => {
    if (err) {
      res.status(200).send('Distributed Job Scheduler Core is online. Open dashboard via client server.');
    }
  });
});

// Initialize engines
const scheduler = new Scheduler(1000);
const workerAlpha = new WorkerDaemon('worker-node-alpha');
const workerBeta = new WorkerDaemon('worker-node-beta');

async function startSystem() {
  // Setup WebSocket server
  initWebSocketServer(server);

  scheduler.start();
  await workerAlpha.start();
  await workerBeta.start();

  server.listen(port, () => {
    console.log(`[System] HTTP & WS Server running on port ${port}`);
  });
}

async function shutdownSystem(signal: string) {
  console.log(`\n[System] Graceful shutdown triggered by ${signal}.`);
  scheduler.stop();
  
  // Disable console warnings from Prisma disconnects
  await Promise.all([
    workerAlpha.shutdown(),
    workerBeta.shutdown()
  ]);
  
  server.close(() => {
    console.log('[System] Process terminated safely.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdownSystem('SIGINT'));
process.on('SIGTERM', () => shutdownSystem('SIGTERM'));

if (process.env.NODE_ENV !== 'test') {
  startSystem().catch((err) => {
    console.error('[System] Failure during initialization:', err);
    process.exit(1);
  });
}
export { app, server };
