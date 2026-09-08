import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = Router();

const publicOrderSchema = z.object({
  supplierId: z.string().cuid(),
  requester: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().max(40).optional(),
    company: z.string().max(160).optional(),
  }),
  requestedDeliveryDate: z.string().datetime(),
  deliveryType: z.enum(['PICKUP', 'DELIVERY', 'JUST_IN_TIME', 'SCHEDULED']).default('DELIVERY'),
  purchaseOrderNumber: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(z.object({
    partId: z.string().cuid(),
    quantity: z.number().int().positive(),
  })).min(1),
});

async function getActiveLink(code: string) {
  const link = await prisma.shareableLink.findUnique({
    where: { code },
    include: { plant: true },
  });

  if (!link || !link.isActive) throw new AppError('Ordering link not found', 404);
  if (link.expiresAt && link.expiresAt < new Date()) throw new AppError('Ordering link has expired', 410);
  if (link.maxUses && link.currentUses >= link.maxUses) throw new AppError('Ordering link usage limit reached', 410);
  return link;
}

router.get('/:code', asyncHandler(async (req: any, res: Response) => {
  const link = await getActiveLink(req.params.code);
  const supplierIds = link.allowedSuppliers.length
    ? link.allowedSuppliers
    : (await prisma.plantSupplier.findMany({ where: { plantId: link.plantId }, select: { supplierId: true } }))
      .map(({ supplierId }) => supplierId);

  const parts = await prisma.part.findMany({
    where: {
      isActive: true,
      supplierId: { in: supplierIds },
      ...(link.allowedParts.length ? { id: { in: link.allowedParts } } : {}),
    },
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      category: true,
      unitOfMeasure: true,
      manufacturer: true,
      manufacturerPartNumber: true,
      minOrderQty: true,
      maxOrderQty: true,
      leadTimeDays: true,
      listPrice: true,
      currency: true,
      supplier: { select: { id: true, name: true, code: true } },
      priceTiers: { orderBy: { minQty: 'asc' } },
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  res.json({
    link: { id: link.id, code: link.code, name: link.name, description: link.description },
    plant: { name: link.plant.name, code: link.plant.code, city: link.plant.city, state: link.plant.state },
    parts,
  });
}));

router.post('/:code/orders', asyncHandler(async (req: any, res: Response) => {
  const link = await getActiveLink(req.params.code);
  const data = publicOrderSchema.parse(req.body);
  const allowedSupplierIds = link.allowedSuppliers.length
    ? link.allowedSuppliers
    : (await prisma.plantSupplier.findMany({ where: { plantId: link.plantId }, select: { supplierId: true } }))
      .map(({ supplierId }) => supplierId);

  if (!allowedSupplierIds.includes(data.supplierId)) throw new AppError('Supplier is not available through this link', 400);

  const partIds = data.items.map(({ partId }) => partId);
  const parts = await prisma.part.findMany({
    where: { id: { in: partIds }, supplierId: data.supplierId, isActive: true },
    include: { priceTiers: { orderBy: { minQty: 'desc' } } },
  });
  if (parts.length !== new Set(partIds).size) throw new AppError('One or more selected parts are unavailable', 400);

  const items = data.items.map(item => {
    const part = parts.find(({ id }) => id === item.partId)!;
    if (link.allowedParts.length && !link.allowedParts.includes(part.id)) throw new AppError(`${part.sku} is not available through this link`, 400);
    if (item.quantity < part.minOrderQty || (part.maxOrderQty && item.quantity > part.maxOrderQty)) {
      throw new AppError(`Quantity for ${part.sku} is outside its order limits`, 400);
    }
    const tier = part.priceTiers.find(({ minQty, maxQty }) => minQty <= item.quantity && (!maxQty || item.quantity <= maxQty));
    const unitPrice = tier?.price ?? part.listPrice;
    return { partId: part.id, quantityOrdered: item.quantity, unitPrice, lineTotal: Number(unitPrice) * item.quantity };
  });
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);

  const order = await prisma.$transaction(async tx => {
    const created = await tx.order.create({
      data: {
        orderNumber: `WEB-${Date.now().toString(36).toUpperCase()}`,
        plantId: link.plantId,
        supplierId: data.supplierId,
        userId: link.createdById,
        shareableLinkId: link.id,
        requesterName: data.requester.name,
        requesterEmail: data.requester.email,
        requesterPhone: data.requester.phone,
        requesterCompany: data.requester.company,
        requestedDeliveryDate: new Date(data.requestedDeliveryDate),
        deliveryType: data.deliveryType,
        purchaseOrderNumber: data.purchaseOrderNumber,
        notes: data.notes,
        subtotal,
        totalAmount: subtotal,
        status: 'PENDING_APPROVAL',
        items: { create: items },
        statusHistory: { create: { toStatus: 'PENDING_APPROVAL', changedById: link.createdById, reason: 'Submitted through ordering link' } },
      },
      select: { id: true, orderNumber: true, status: true, totalAmount: true, requestedDeliveryDate: true },
    });
    await tx.shareableLink.update({ where: { id: link.id }, data: { currentUses: { increment: 1 } } });
    return created;
  });

  res.status(201).json({ order });
}));

export { router as publicOrderingRoutes };
