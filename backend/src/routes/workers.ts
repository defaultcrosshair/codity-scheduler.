import { Router } from 'express';
import { prisma } from '../db';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// List Workers
router.get('/', async (req, res) => {
  try {
    const workers = await prisma.worker.findMany({
      orderBy: { registeredAt: 'desc' },
    });
    return res.json(workers);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Get recent heartbeats for worker resource metrics
router.get('/:id/heartbeats', async (req, res) => {
  const { id } = req.params;
  try {
    const heartbeats = await prisma.workerHeartbeat.findMany({
      where: { workerId: id },
      orderBy: { timestamp: 'desc' },
      take: 30,
    });
    // Return chronological order for charts
    return res.json(heartbeats.reverse());
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
