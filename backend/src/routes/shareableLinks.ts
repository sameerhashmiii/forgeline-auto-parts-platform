import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { 
  createShareableLinkSchema, 
  paginationSchema,
  CreateShareableLinkInput,
  PaginationInput
} from '../validators/index.js';
import QRCode from 'qrcode';
import { Prisma } from '@prisma/client';

const router = Router();

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { plantId, isActive } = req.query;
  
  const where: Prisma.ShareableLinkWhereInput = {};
  if (plantId) where.plantId = plantId as string;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.plantId = req.user!.plantId;
  }
  
  const [links, total] = await Promise.all([
    prisma.shareableLink.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'createdAt']: sortOrder },
      include: {
        plant: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { orders: true } },
      },
    }),
    prisma.shareableLink.count({ where }),
  ]);
  
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  
  const linksWithUrls = links.map(link => ({
    ...link,
    url: `${baseUrl}/order/${link.code}`,
    qrCodeUrl: `${baseUrl}/api/shareable-links/${link.id}/qr`,
  }));
  
  res.json({ links: linksWithUrls, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const link = await prisma.shareableLink.findUnique({
    where: { id: req.params.id },
    include: {
      plant: true,
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      orders: { take: 20, orderBy: { createdAt: 'desc' } },
    },
  });
  
  if (!link) throw new AppError('Shareable link not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && link.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const qrCodeDataUrl = await QRCode.toDataURL(`${baseUrl}/order/${link.code}`);
  
  res.json({ link: { ...link, url: `${baseUrl}/order/${link.code}`, qrCodeDataUrl } });
}));

router.post('/', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createShareableLinkSchema.parse(req.body) as CreateShareableLinkInput;
  
  const plant = await prisma.plant.findUnique({ where: { id: data.plantId } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const code = generateUniqueCode();
  
  const link = await prisma.shareableLink.create({
    data: {
      ...data,
      code,
      createdById: req.user!.id,
    },
    include: { plant: true },
  });
  
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const qrCodeDataUrl = await QRCode.toDataURL(`${baseUrl}/order/${link.code}`);
  
  res.status(201).json({ link: { ...link, url: `${baseUrl}/order/${link.code}`, qrCodeDataUrl } });
}));

router.put('/:id', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const link = await prisma.shareableLink.findUnique({ where: { id: req.params.id } });
  if (!link) throw new AppError('Shareable link not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && link.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  const updated = await prisma.shareableLink.update({
    where: { id: req.params.id },
    data: req.body,
  });
  
  res.json({ link: updated });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const link = await prisma.shareableLink.findUnique({ where: { id: req.params.id } });
  if (!link) throw new AppError('Shareable link not found', 404);
  
  await prisma.shareableLink.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

router.get('/:id/qr', asyncHandler(async (req: AuthRequest, res: Response) => {
  const link = await prisma.shareableLink.findUnique({ where: { id: req.params.id } });
  if (!link) throw new AppError('Shareable link not found', 404);
  
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const qrCodeDataUrl = await QRCode.toDataURL(`${baseUrl}/order/${link.code}`);
  
  res.json({ qrCodeDataUrl });
}));

function generateUniqueCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export { router as shareableLinkRoutes };
