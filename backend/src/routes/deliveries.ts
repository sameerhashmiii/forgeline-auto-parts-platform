import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { 
  createDeliverySchema, 
  createDeliveryScheduleSchema,
  paginationSchema,
  CreateDeliveryInput,
  CreateDeliveryScheduleInput,
  PaginationInput
} from '../validators/index.js';
import { DeliveryStatus, Prisma } from '@prisma/client';

const router = Router();

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { status, supplierId, orderId, startDate, endDate } = req.query;
  
  const where: Prisma.DeliveryWhereInput = {};
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.order = { plantId: req.user!.plantId };
  }
  
  if (status) where.status = status as DeliveryStatus;
  if (supplierId) where.supplierId = supplierId as string;
  if (orderId) where.orderId = orderId as string;
  if (startDate || endDate) {
    where.scheduledDate = {};
    if (startDate) where.scheduledDate.gte = new Date(startDate as string);
    if (endDate) where.scheduledDate.lte = new Date(endDate as string);
  }
  
  const [deliveries, total] = await Promise.all([
    prisma.delivery.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'scheduledDate']: sortOrder },
      include: {
        order: { select: { id: true, orderNumber: true, plant: { select: { id: true, name: true } } } },
        supplier: { select: { id: true, name: true, code: true } },
        receipts: { include: { orderItem: { include: { part: true } } } },
      },
    }),
    prisma.delivery.count({ where }),
  ]);
  
  res.json({ deliveries, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/upcoming', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { days = 7 } = req.query;
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + Number(days));
  
  const where: Prisma.DeliveryWhereInput = {
    scheduledDate: { gte: startDate, lte: endDate },
    status: { in: ['SCHEDULED', 'IN_TRANSIT'] },
  };
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.order = { plantId: req.user!.plantId };
  }
  
  const deliveries = await prisma.delivery.findMany({
    where,
    orderBy: { scheduledDate: 'asc' },
    include: {
      order: { select: { id: true, orderNumber: true, plant: { select: { id: true, name: true } } } },
      supplier: { select: { id: true, name: true, code: true } },
    },
  });
  
  res.json({ deliveries });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const delivery = await prisma.delivery.findUnique({
    where: { id: req.params.id },
    include: {
      order: { include: { plant: true, supplier: true, items: { include: { part: true } } } },
      supplier: true,
      receipts: { include: { orderItem: { include: { part: true } }, receivedBy: { select: { id: true, firstName: true, lastName: true } } } },
    },
  });
  
  if (!delivery) throw new AppError('Delivery not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && delivery.order.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  res.json({ delivery });
}));

router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createDeliverySchema.parse(req.body) as CreateDeliveryInput;
  
  const order = await prisma.order.findUnique({ where: { id: data.orderId } });
  if (!order) throw new AppError('Order not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && order.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  const delivery = await prisma.delivery.create({
    data: {
      ...data,
      scheduledDate: new Date(data.scheduledDate),
      deliveryNumber: `DEL-${Date.now().toString(36).toUpperCase()}`,
      status: 'SCHEDULED',
    },
    include: { order: { select: { id: true, orderNumber: true } }, supplier: true },
  });
  
  await prisma.notification.create({
    data: {
      userId: order.userId,
      type: 'DELIVERY_SCHEDULED',
      title: 'Delivery Scheduled',
      message: `Delivery ${delivery.deliveryNumber} scheduled for order ${order.orderNumber}`,
      data: { deliveryId: delivery.id, orderId: order.id },
    },
  });
  
  res.status(201).json({ delivery });
}));

router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const delivery = await prisma.delivery.findUnique({
    where: { id: req.params.id },
    include: { order: true },
  });
  
  if (!delivery) throw new AppError('Delivery not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && delivery.order.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  const updateData = { ...req.body };
  if (updateData.scheduledDate) updateData.scheduledDate = new Date(updateData.scheduledDate);
  if (updateData.actualDate) updateData.actualDate = new Date(updateData.actualDate);
  
  const updatedDelivery = await prisma.delivery.update({
    where: { id: req.params.id },
    data: updateData,
  });
  
  if (updateData.status && updateData.status !== delivery.status) {
    await prisma.notification.create({
      data: {
        userId: delivery.order.userId,
        type: 'ORDER_UPDATED',
        title: 'Delivery Status Updated',
        message: `Delivery ${delivery.deliveryNumber} status changed to ${updateData.status}`,
        data: { deliveryId: delivery.id, status: updateData.status },
      },
    });
  }
  
  res.json({ delivery: updatedDelivery });
}));

router.post('/:id/receive', asyncHandler(async (req: AuthRequest, res: Response) => {
  const delivery = await prisma.delivery.findUnique({
    where: { id: req.params.id },
    include: { order: { include: { items: true } } },
  });
  
  if (!delivery) throw new AppError('Delivery not found', 404);
  if (delivery.status === 'COMPLETED' || delivery.status === 'CANCELLED') {
    throw new AppError(`Cannot receive delivery in ${delivery.status} status`, 400);
  }
  
  const { receipts, proofOfDelivery, notes } = req.body;
  
  let totalReceived = 0;
  let totalAccepted = 0;
  
  for (const receipt of receipts) {
    const orderItem = delivery.order.items.find(i => i.id === receipt.orderItemId);
    if (!orderItem) throw new AppError(`Order item ${receipt.orderItemId} not found`, 404);
    
    const qtyReceived = Number(receipt.quantityReceived);
    const qtyAccepted = Number(receipt.quantityAccepted);
    const qtyRejected = qtyReceived - qtyAccepted;
    
    if (qtyReceived > orderItem.quantityOrdered - orderItem.quantityReceived) {
      throw new AppError(`Received quantity exceeds ordered quantity for item ${orderItem.partId}`, 400);
    }
    
    await prisma.receipt.create({
      data: {
        orderItemId: orderItem.id,
        deliveryId: delivery.id,
        quantityReceived: qtyReceived,
        quantityAccepted: qtyAccepted,
        quantityRejected: qtyRejected,
        lotNumber: receipt.lotNumber,
        serialNumbers: receipt.serialNumbers || [],
        condition: receipt.condition,
        notes: receipt.notes,
        receivedById: req.user!.id,
      },
    });
    
    await prisma.orderItem.update({
      where: { id: orderItem.id },
      data: {
        quantityReceived: { increment: qtyReceived },
        quantityRejected: { increment: qtyRejected },
      },
    });
    
    totalReceived += qtyReceived;
    totalAccepted += qtyAccepted;
  }
  
  const allItemsReceived = delivery.order.items.every(
    i => i.quantityReceived + (receipts.find((r: any) => r.orderItemId === i.id)?.quantityReceived || 0) >= i.quantityOrdered
  );
  
  const allItemsPartiallyReceived = delivery.order.items.some(
    i => i.quantityReceived + (receipts.find((r: any) => r.orderItemId === i.id)?.quantityReceived || 0) > 0
  );
  
  let newDeliveryStatus = delivery.status;
  if (allItemsReceived) newDeliveryStatus = 'COMPLETED';
  else if (allItemsPartiallyReceived) newDeliveryStatus = 'PARTIAL';
  
  await prisma.delivery.update({
    where: { id: delivery.id },
    data: {
      status: newDeliveryStatus,
      actualDate: new Date(),
      proofOfDelivery,
      notes: notes || delivery.notes,
    },
  });
  
  if (allItemsReceived) {
    await prisma.order.update({
      where: { id: delivery.orderId },
      data: { status: 'DELIVERED', actualDeliveryDate: new Date() },
    });
  } else if (allItemsPartiallyReceived) {
    await prisma.order.update({
      where: { id: delivery.orderId },
      data: { status: 'PARTIALLY_DELIVERED' },
    });
  }
  
  await prisma.notification.create({
    data: {
      userId: delivery.order.userId,
      type: 'ORDER_DELIVERED',
      title: 'Delivery Received',
      message: `Delivery ${delivery.deliveryNumber} has been received`,
      data: { deliveryId: delivery.id, orderId: delivery.orderId },
    },
  });
  
  res.json({ success: true });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id } });
  if (!delivery) throw new AppError('Delivery not found', 404);
  
  await prisma.delivery.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

router.get('/schedules/all', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { plantId, isActive } = req.query;
  
  const where: Prisma.DeliveryScheduleWhereInput = {};
  if (plantId) where.plantId = plantId as string;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.plantId = req.user!.plantId;
  }
  
  const [schedules, total] = await Promise.all([
    prisma.deliverySchedule.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'name']: sortOrder },
      include: { plant: { select: { id: true, name: true, code: true } } },
    }),
    prisma.deliverySchedule.count({ where }),
  ]);
  
  res.json({ schedules, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/schedules', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createDeliveryScheduleSchema.parse(req.body) as CreateDeliveryScheduleInput;
  
  const plant = await prisma.plant.findUnique({ where: { id: data.plantId } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const schedule = await prisma.deliverySchedule.create({ data });
  res.status(201).json({ schedule });
}));

router.put('/schedules/:id', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const schedule = await prisma.deliverySchedule.update({
    where: { id: req.params.id },
    data: req.body,
  });
  res.json({ schedule });
}));

router.delete('/schedules/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.deliverySchedule.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

export { router as deliveryRoutes };
