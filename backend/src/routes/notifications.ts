import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { paginationSchema, PaginationInput } from '../validators/index.js';

const router = Router();

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { isRead, type } = req.query;
  
  const where: any = { userId: req.user!.id };
  if (isRead !== undefined) where.isRead = isRead === 'true';
  if (type) where.type = type;
  
  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'createdAt']: sortOrder },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
  ]);
  
  res.json({ notifications, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, unreadCount });
}));

router.get('/unread-count', asyncHandler(async (req: AuthRequest, res: Response) => {
  const count = await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } });
  res.json({ count });
}));

router.put('/:id/read', asyncHandler(async (req: AuthRequest, res: Response) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification) throw new AppError('Notification not found', 404);
  if (notification.userId !== req.user!.id) throw new AppError('Access denied', 403);
  
  const updated = await prisma.notification.update({
    where: { id: req.params.id },
    data: { isRead: true, readAt: new Date() },
  });
  
  res.json({ notification: updated });
}));

router.put('/read-all', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  
  res.json({ success: true });
}));

router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification) throw new AppError('Notification not found', 404);
  if (notification.userId !== req.user!.id) throw new AppError('Access denied', 403);
  
  await prisma.notification.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

export { router as notificationRoutes };