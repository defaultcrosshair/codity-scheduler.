import { Router } from 'express';
import { prisma } from '../db';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authenticate as any);

// List Projects
router.get('/', async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) return res.status(400).json({ error: 'Missing organization context.' });

  try {
    const projects = await prisma.project.findMany({
      where: { organizationId },
      include: {
        queues: {
          select: {
            id: true,
            name: true,
            priority: true,
            isPaused: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return res.json(projects);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Create Project
router.post('/', authorize(['ADMIN', 'DEVELOPER']) as any, async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) return res.status(400).json({ error: 'Missing organization context.' });

  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Project name is required.' });
  }

  try {
    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        organizationId,
      },
    });
    return res.status(201).json(project);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Project name must be unique within your organization.' });
    }
    return res.status(500).json({ error: error.message });
  }
});

// Get Project Detail
router.get('/:id', async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId as string;
  const id = req.params.id as string;

  try {
    const project = await prisma.project.findFirst({
      where: { id, organizationId },
      include: {
        queues: {
          include: {
            retryPolicy: true,
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    return res.json(project);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Delete Project
router.delete('/:id', authorize(['ADMIN']) as any, async (req: AuthRequest, res) => {
  const organizationId = req.user?.organizationId as string;
  const id = req.params.id as string;

  try {
    const project = await prisma.project.findFirst({
      where: { id, organizationId },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    await prisma.project.delete({ where: { id: id as string } });
    return res.json({ message: 'Project successfully deleted.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
