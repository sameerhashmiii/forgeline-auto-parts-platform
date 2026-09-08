import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { paginationSchema, PaginationInput } from '../validators/index.js';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const upload = multer({
  dest: join(__dirname, '../../uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'));
  },
});

const router = Router();

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { orderId, type } = req.query;
  
  const where: Prisma.OrderDocumentWhereInput = {};
  if (orderId) where.orderId = orderId as string;
  if (type) where.type = type as string;
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.order = { plantId: req.user!.plantId };
  }
  
  const [documents, total] = await Promise.all([
    prisma.orderDocument.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'createdAt']: sortOrder },
      include: {
        order: { select: { id: true, orderNumber: true } },
        uploadedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.orderDocument.count({ where }),
  ]);
  
  res.json({ documents, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/upload', upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new AppError('No file uploaded', 400);
  
  const { orderId, type, name } = req.body;
  
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError('Order not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && order.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  const document = await prisma.orderDocument.create({
    data: {
      orderId,
      name: name || req.file.originalname,
      type: type || 'OTHER',
      url: `/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedById: req.user!.id,
    },
    include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
  });
  
  res.status(201).json({ document });
}));

router.delete('/:id', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const document = await prisma.orderDocument.findUnique({ where: { id: req.params.id } });
  if (!document) throw new AppError('Document not found', 404);
  
  await prisma.orderDocument.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

export { router as documentRoutes };