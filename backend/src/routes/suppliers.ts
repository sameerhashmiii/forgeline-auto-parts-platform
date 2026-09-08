import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { 
  createSupplierSchema, 
  paginationSchema,
  CreateSupplierInput,
  PaginationInput
} from '../validators/index.js';
import { Prisma } from '@prisma/client';

const router = Router();

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { isActive, search, plantId } = req.query;
  
  const where: Prisma.SupplierWhereInput = {};
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { code: { contains: search as string, mode: 'insensitive' } },
      { contactName: { contains: search as string, mode: 'insensitive' } },
      { contactEmail: { contains: search as string, mode: 'insensitive' } },
    ];
  }
  
  if (plantId) {
    where.plantSuppliers = { some: { plantId: plantId as string } };
  }
  
  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'name']: sortOrder },
      include: {
        plantSuppliers: { include: { plant: { select: { id: true, name: true, code: true } } } },
        _count: { select: { parts: true, orders: true } },
      },
    }),
    prisma.supplier.count({ where }),
  ]);
  
  res.json({ suppliers, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const supplier = await prisma.supplier.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      parts: { where: { isActive: true }, orderBy: { name: 'asc' } },
      plantSuppliers: { include: { plant: { select: { id: true, name: true, code: true } } } },
      orders: { take: 10, orderBy: { createdAt: 'desc' } },
      _count: { select: { parts: true, orders: true, deliveries: true } },
    },
  });
  
  if (!supplier) throw new AppError('Supplier not found', 404);
  
  res.json({ supplier });
}));

router.post('/', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createSupplierSchema.parse(req.body) as CreateSupplierInput;
  
  const existingSupplier = await prisma.supplier.findUnique({ where: { code: data.code } });
  if (existingSupplier) throw new AppError('Supplier code already exists', 409);
  
  const supplier = await prisma.supplier.create({
    data: {
      ...data,
      code: data.code.toUpperCase(),
    },
  });
  
  res.status(201).json({ supplier });
}));

router.put('/:id', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!supplier) throw new AppError('Supplier not found', 404);
  
  const updateData = { ...req.body };
  if (updateData.code) updateData.code = updateData.code.toUpperCase();
  
  const updatedSupplier = await prisma.supplier.update({
    where: { id: req.params.id },
    data: updateData,
  });
  
  res.json({ supplier: updatedSupplier });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!supplier) throw new AppError('Supplier not found', 404);
  
  const ordersCount = await prisma.order.count({ where: { supplierId: supplier.id } });
  if (ordersCount > 0) {
    throw new AppError('Cannot delete supplier with existing orders. Deactivate instead.', 400);
  }
  
  await prisma.supplier.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

router.get('/:id/performance', asyncHandler(async (req: AuthRequest, res: Response) => {
  const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!supplier) throw new AppError('Supplier not found', 404);
  
  const { startDate, endDate } = req.query;
  const where: any = { supplierId: supplier.id };
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }
  
  const [orders, deliveries, onTimeDeliveries, totalOrders] = await Promise.all([
    prisma.order.findMany({
      where: { ...where, status: { not: 'CANCELLED' } },
      include: { items: true },
    }),
    prisma.delivery.findMany({ where: { supplierId: supplier.id } }),
    prisma.delivery.findMany({ where: { supplierId: supplier.id, status: 'COMPLETED', actualDate: { not: null } }, select: { actualDate: true, scheduledDate: true } }),
    prisma.order.count({ where: { ...where, status: { not: 'CANCELLED' } } }),
  ]);
  
  const totalValue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
  const avgLeadTime = deliveries
    .filter(d => d.actualDate && d.scheduledDate)
    .reduce((sum, d) => sum + (new Date(d.actualDate!).getTime() - new Date(d.scheduledDate).getTime()) / (1000 * 60 * 60 * 24), 0) 
    / Math.max(deliveries.filter(d => d.actualDate).length, 1);
  
  res.json({
    performance: {
      totalOrders,
      totalValue,
      onTimeDeliveryRate: deliveries.length > 0
        ? (onTimeDeliveries.filter(d => d.actualDate! <= d.scheduledDate).length / deliveries.length) * 100
        : 0,
      avgLeadTimeDays: Math.round(avgLeadTime * 10) / 10,
      defectRate: 0,
    },
  });
}));

export { router as supplierRoutes };
