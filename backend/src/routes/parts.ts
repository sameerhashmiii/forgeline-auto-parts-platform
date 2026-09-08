import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { 
  createPartSchema, 
  paginationSchema,
  CreatePartInput,
  PaginationInput
} from '../validators/index.js';
import { PartCategory, Prisma } from '@prisma/client';

const router = Router();

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { category, supplierId, isActive, search, minPrice, maxPrice } = req.query;
  
  const where: Prisma.PartWhereInput = {};
  
  if (category) where.category = category as PartCategory;
  if (supplierId) where.supplierId = supplierId as string;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  
  if (search) {
    where.OR = [
      { sku: { contains: search as string, mode: 'insensitive' } },
      { name: { contains: search as string, mode: 'insensitive' } },
      { description: { contains: search as string, mode: 'insensitive' } },
      { manufacturerPartNumber: { contains: search as string, mode: 'insensitive' } },
      { oemNumber: { contains: search as string, mode: 'insensitive' } },
      { tags: { has: search as string } },
    ];
  }
  
  if (minPrice || maxPrice) {
    where.listPrice = {};
    if (minPrice) where.listPrice.gte = Number(minPrice);
    if (maxPrice) where.listPrice.lte = Number(maxPrice);
  }
  
  const [parts, total] = await Promise.all([
    prisma.part.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'name']: sortOrder },
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        priceTiers: { orderBy: { minQty: 'asc' } },
        _count: { select: { orderItems: true } },
      },
    }),
    prisma.part.count({ where }),
  ]);
  
  res.json({
    parts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

router.get('/categories', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const categories = Object.values(PartCategory);
  res.json({ categories });
}));

router.get('/suppliers/:supplierId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { isActive, category, search } = req.query;
  
  const where: Prisma.PartWhereInput = { supplierId: req.params.supplierId };
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (category) where.category = category as PartCategory;
  if (search) {
    where.OR = [
      { sku: { contains: search as string, mode: 'insensitive' } },
      { name: { contains: search as string, mode: 'insensitive' } },
    ];
  }
  
  const [parts, total] = await Promise.all([
    prisma.part.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'name']: sortOrder },
      include: { priceTiers: { orderBy: { minQty: 'asc' } } },
    }),
    prisma.part.count({ where }),
  ]);
  
  res.json({ parts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/plant/:plantId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { category, search, inStock } = req.query;
  
  const plant = await prisma.plant.findUnique({ where: { id: req.params.plantId } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const plantSuppliers = await prisma.plantSupplier.findMany({
    where: { plantId: plant.id },
    select: { supplierId: true },
  });
  
  const supplierIds = plantSuppliers.map(ps => ps.supplierId);
  
  const where: Prisma.PartWhereInput = {
    supplierId: { in: supplierIds },
    isActive: true,
  };
  
  if (category) where.category = category as PartCategory;
  if (search) {
    where.OR = [
      { sku: { contains: search as string, mode: 'insensitive' } },
      { name: { contains: search as string, mode: 'insensitive' } },
    ];
  }
  
  const parts = await prisma.part.findMany({
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { [sortBy || 'name']: sortOrder },
    include: {
      supplier: { select: { id: true, name: true, code: true } },
      priceTiers: { orderBy: { minQty: 'asc' } },
      inventory: { where: { plantId: plant.id } },
    },
  });
  
  const total = await prisma.part.count({ where });
  
  const partsWithStock = parts.map(part => {
    const inventory = part.inventory[0];
    return {
      ...part,
      inventory: inventory ? {
        quantityOnHand: inventory.quantityOnHand,
        quantityReserved: inventory.quantityReserved,
        quantityAvailable: inventory.quantityOnHand - inventory.quantityReserved,
        reorderPoint: inventory.reorderPoint,
        location: inventory.location,
        binLocation: inventory.binLocation,
        isLowStock: inventory.quantityOnHand - inventory.quantityReserved <= inventory.reorderPoint,
      } : null,
    };
  });
  
  res.json({
    parts: partsWithStock,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const part = await prisma.part.findUnique({
    where: { id: req.params.id },
    include: {
      supplier: true,
      priceTiers: { orderBy: { minQty: 'asc' } },
      compatibilities: {
        include: {
          compatiblePart: { select: { id: true, sku: true, name: true, category: true } },
        },
      },
      compatibleWith: {
        include: {
          part: { select: { id: true, sku: true, name: true, category: true } },
        },
      },
      inventory: { include: { plant: { select: { id: true, name: true, code: true } } } },
    },
  });
  
  if (!part) throw new AppError('Part not found', 404);
  
  res.json({ part });
}));

router.post('/', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createPartSchema.parse(req.body) as CreatePartInput;
  
  const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
  if (!supplier) throw new AppError('Supplier not found', 404);
  
  const existingPart = await prisma.part.findUnique({ where: { sku: data.sku } });
  if (existingPart) throw new AppError('SKU already exists', 409);
  
  const part = await prisma.part.create({
    data: {
      ...data,
      standardCost: data.standardCost,
      listPrice: data.listPrice,
    },
    include: { supplier: true, priceTiers: true },
  });
  
  res.status(201).json({ part });
}));

router.put('/:id', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const part = await prisma.part.findUnique({ where: { id: req.params.id } });
  if (!part) throw new AppError('Part not found', 404);
  
  const updateData = { ...req.body };
  if (updateData.sku && updateData.sku !== part.sku) {
    const existing = await prisma.part.findUnique({ where: { sku: updateData.sku } });
    if (existing) throw new AppError('SKU already exists', 409);
  }
  
  const updatedPart = await prisma.part.update({
    where: { id: req.params.id },
    data: updateData,
    include: { supplier: true, priceTiers: true },
  });
  
  res.json({ part: updatedPart });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const part = await prisma.part.findUnique({ where: { id: req.params.id } });
  if (!part) throw new AppError('Part not found', 404);
  
  const orderItemsCount = await prisma.orderItem.count({ where: { partId: part.id } });
  if (orderItemsCount > 0) {
    throw new AppError('Cannot delete part with existing orders. Deactivate instead.', 400);
  }
  
  await prisma.part.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

router.post('/:id/price-tiers', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const part = await prisma.part.findUnique({ where: { id: req.params.id } });
  if (!part) throw new AppError('Part not found', 404);
  
  const { minQty, maxQty, price } = req.body;
  
  const priceTier = await prisma.priceTier.create({
    data: {
      partId: part.id,
      minQty: Number(minQty),
      maxQty: maxQty ? Number(maxQty) : null,
      price: Number(price),
    },
  });
  
  res.status(201).json({ priceTier });
}));

router.delete('/:id/price-tiers/:tierId', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.priceTier.delete({ where: { id: req.params.tierId } });
  res.json({ success: true });
}));

router.post('/:id/compatibility', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const part = await prisma.part.findUnique({ where: { id: req.params.id } });
  if (!part) throw new AppError('Part not found', 404);
  
  const { compatiblePartId, notes } = req.body;
  
  const compatiblePart = await prisma.part.findUnique({ where: { id: compatiblePartId } });
  if (!compatiblePart) throw new AppError('Compatible part not found', 404);
  
  const compatibility = await prisma.partCompatibility.create({
    data: {
      partId: part.id,
      compatiblePartId,
      notes,
    },
    include: {
      compatiblePart: { select: { id: true, sku: true, name: true, category: true } },
    },
  });
  
  res.status(201).json({ compatibility });
}));

router.delete('/:id/compatibility/:compatId', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.partCompatibility.delete({ where: { id: req.params.compatId } });
  res.json({ success: true });
}));

export { router as partRoutes };