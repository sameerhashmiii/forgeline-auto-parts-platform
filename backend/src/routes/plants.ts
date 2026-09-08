import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { 
  createPlantSchema, 
  paginationSchema,
  CreatePlantInput,
  PaginationInput
} from '../validators/index.js';
import { Prisma } from '@prisma/client';

const router = Router();

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { isActive, search } = req.query;
  
  const where: Prisma.PlantWhereInput = {};
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { code: { contains: search as string, mode: 'insensitive' } },
      { city: { contains: search as string, mode: 'insensitive' } },
    ];
  }
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.id = req.user!.plantId;
  }
  
  const [plants, total] = await Promise.all([
    prisma.plant.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'name']: sortOrder },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { users: true, orders: true, inventory: true } },
      },
    }),
    prisma.plant.count({ where }),
  ]);
  
  res.json({ plants, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const plant = await prisma.plant.findUnique({
    where: { id: req.params.id },
    include: {
      manager: { select: { id: true, firstName: true, lastName: true, email: true } },
      users: { select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true } },
      inventory: { include: { part: { select: { id: true, sku: true, name: true, category: true } } } },
      deliverySchedules: true,
      suppliers: { include: { supplier: true } },
      shareableLinks: { where: { isActive: true } },
    },
  });
  
  if (!plant) throw new AppError('Plant not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && plant.id !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  res.json({ plant });
}));

router.post('/', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createPlantSchema.parse(req.body) as CreatePlantInput;
  
  const existingPlant = await prisma.plant.findUnique({ where: { code: data.code } });
  if (existingPlant) throw new AppError('Plant code already exists', 409);
  
  const plant = await prisma.plant.create({
    data: {
      ...data,
      code: data.code.toUpperCase(),
    },
  });
  
  res.status(201).json({ plant });
}));

router.put('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const plant = await prisma.plant.findUnique({ where: { id: req.params.id } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const updateData = { ...req.body };
  if (updateData.code) updateData.code = updateData.code.toUpperCase();
  
  const updatedPlant = await prisma.plant.update({
    where: { id: req.params.id },
    data: updateData,
  });
  
  res.json({ plant: updatedPlant });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const plant = await prisma.plant.findUnique({ where: { id: req.params.id } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const ordersCount = await prisma.order.count({ where: { plantId: plant.id } });
  if (ordersCount > 0) {
    throw new AppError('Cannot delete plant with existing orders. Deactivate instead.', 400);
  }
  
  await prisma.plant.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

router.get('/:id/inventory', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { lowStock, search, category } = req.query;
  
  const plant = await prisma.plant.findUnique({ where: { id: req.params.id } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const where: Prisma.PlantInventoryWhereInput = { plantId: plant.id };
  
  if (search) {
    where.part = {
      OR: [
        { sku: { contains: search as string, mode: 'insensitive' } },
        { name: { contains: search as string, mode: 'insensitive' } },
      ],
    };
  }
  
  if (category) {
    where.part = { ...where.part, category: category as any };
  }
  
  const [inventory, total] = await Promise.all([
    prisma.plantInventory.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'part.name']: sortOrder },
      include: {
        part: { include: { supplier: { select: { id: true, name: true, code: true } } } },
      },
    }),
    prisma.plantInventory.count({ where }),
  ]);
  
  const filteredInventory = lowStock === 'true'
    ? inventory.filter(item => item.quantityOnHand <= item.reorderPoint)
    : inventory;
  res.json({ inventory: filteredInventory, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/:id/suppliers', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const plant = await prisma.plant.findUnique({ where: { id: req.params.id } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const { supplierId, isPreferred, leadTimeDays, minOrderValue } = req.body;
  
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new AppError('Supplier not found', 404);
  
  const plantSupplier = await prisma.plantSupplier.upsert({
    where: { plantId_supplierId: { plantId: plant.id, supplierId } },
    update: { isPreferred, leadTimeDays, minOrderValue },
    create: { plantId: plant.id, supplierId, isPreferred, leadTimeDays, minOrderValue },
    include: { supplier: true },
  });
  
  res.json({ plantSupplier });
}));

router.delete('/:id/suppliers/:supplierId', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.plantSupplier.delete({
    where: { plantId_supplierId: { plantId: req.params.id, supplierId: req.params.supplierId } },
  });
  res.json({ success: true });
}));

export { router as plantRoutes };
