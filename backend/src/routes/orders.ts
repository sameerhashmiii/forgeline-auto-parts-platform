import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { 
  createOrderSchema, 
  updateOrderSchema,
  paginationSchema,
  dateRangeSchema,
  CreateOrderInput,
  UpdateOrderInput,
  PaginationInput,
  DateRangeInput
} from '../validators/index.js';
import { OrderStatus, PaymentStatus, Priority, Prisma } from '@prisma/client';
import { subDays, startOfDay, endOfDay } from 'date-fns';

const router = Router();

const generateOrderNumber = () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PO-${year}${month}${day}-${random}`;
};

const calculateOrderTotals = (items: CreateOrderInput['items']) => {
  const subtotal = items.reduce((sum, item) => {
    const lineTotal = item.quantityOrdered * item.unitPrice * (1 - item.discountPercent / 100);
    return sum + lineTotal;
  }, 0);
  return { subtotal };
};

router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createOrderSchema.parse(req.body) as CreateOrderInput;
  
  const plant = await prisma.plant.findUnique({ where: { id: data.plantId } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
  if (!supplier) throw new AppError('Supplier not found', 404);
  
  const plantSupplier = await prisma.plantSupplier.findUnique({
    where: { plantId_supplierId: { plantId: data.plantId, supplierId: data.supplierId } },
  });
  if (!plantSupplier) throw new AppError('Supplier not associated with this plant', 400);
  
  const parts = await prisma.part.findMany({
    where: { id: { in: data.items.map(i => i.partId) } },
    include: { supplier: true },
  });
  
  if (parts.length !== data.items.length) {
    throw new AppError('One or more parts not found', 404);
  }
  
  for (const item of data.items) {
    const part = parts.find(p => p.id === item.partId)!;
    if (part.supplierId !== data.supplierId) {
      throw new AppError(`Part ${part.sku} does not belong to selected supplier`, 400);
    }
    if (item.quantityOrdered < part.minOrderQty) {
      throw new AppError(`Part ${part.sku} minimum order quantity is ${part.minOrderQty}`, 400);
    }
    if (part.maxOrderQty && item.quantityOrdered > part.maxOrderQty) {
      throw new AppError(`Part ${part.sku} maximum order quantity is ${part.maxOrderQty}`, 400);
    }
  }
  
  const { subtotal } = calculateOrderTotals(data.items);
  const taxAmount = subtotal * 0;
  const shippingAmount = 0;
  const discountAmount = data.items.reduce((sum, item) => 
    sum + (item.quantityOrdered * item.unitPrice * item.discountPercent / 100), 0);
  const totalAmount = subtotal + taxAmount + shippingAmount;
  
  const order = await prisma.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      plantId: data.plantId,
      supplierId: data.supplierId,
      userId: req.user!.id,
      priority: data.priority,
      deliveryType: data.deliveryType,
      subtotal,
      taxAmount,
      shippingAmount,
      discountAmount,
      totalAmount,
      paymentTerms: data.paymentTerms,
      paymentMethod: data.paymentMethod,
      purchaseOrderNumber: data.purchaseOrderNumber,
      requestedDeliveryDate: data.requestedDeliveryDate ? new Date(data.requestedDeliveryDate) : null,
      shippingAddress: data.shippingAddress,
      billingAddress: data.billingAddress,
      notes: data.notes,
      internalNotes: data.internalNotes,
      status: 'DRAFT',
      paymentStatus: 'UNPAID',
      items: {
        create: data.items.map(item => ({
          partId: item.partId,
          quantityOrdered: item.quantityOrdered,
          unitPrice: item.unitPrice,
          discountPercent: item.discountPercent,
          lineTotal: item.quantityOrdered * item.unitPrice * (1 - item.discountPercent / 100),
          notes: item.notes,
        })),
      },
      statusHistory: {
        create: {
          fromStatus: null,
          toStatus: 'DRAFT',
          changedById: req.user!.id,
          reason: 'Order created',
        },
      },
    },
    include: {
      items: { include: { part: true } },
      plant: true,
      supplier: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  
  await prisma.notification.create({
    data: {
      userId: req.user!.id,
      type: 'ORDER_CREATED',
      title: 'Order Created',
      message: `Order ${order.orderNumber} has been created`,
      data: { orderId: order.id, orderNumber: order.orderNumber },
    },
  });
  
  res.status(201).json({ order });
}));

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { startDate, endDate } = dateRangeSchema.parse(req.query) as DateRangeInput;
  const { status, paymentStatus, priority, supplierId, plantId, search } = req.query;
  
  const where: Prisma.OrderWhereInput = {};
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.plantId = req.user!.plantId;
  } else if (plantId) {
    where.plantId = plantId as string;
  }
  
  if (status) where.status = status as OrderStatus;
  if (paymentStatus) where.paymentStatus = paymentStatus as PaymentStatus;
  if (priority) where.priority = priority as Priority;
  if (supplierId) where.supplierId = supplierId as string;
  
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }
  
  if (search) {
    where.OR = [
      { orderNumber: { contains: search as string, mode: 'insensitive' } },
      { purchaseOrderNumber: { contains: search as string, mode: 'insensitive' } },
      { supplier: { name: { contains: search as string, mode: 'insensitive' } } },
      { notes: { contains: search as string, mode: 'insensitive' } },
    ];
  }
  
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'createdAt']: sortOrder },
      include: {
        plant: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true, code: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        items: { include: { part: { select: { id: true, sku: true, name: true } } } },
        _count: { select: { payments: true, deliveries: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  
  res.json({
    orders,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

router.get('/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate } = dateRangeSchema.parse(req.query) as DateRangeInput;
  
  const where: Prisma.OrderWhereInput = {};
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.plantId = req.user!.plantId;
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }
  
  const [totalOrders, pendingOrders, completedOrders, cancelledOrders, totalRevenue, overduePayments] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.count({ where: { ...where, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION'] } } }),
    prisma.order.count({ where: { ...where, status: 'COMPLETED' } }),
    prisma.order.count({ where: { ...where, status: 'CANCELLED' } }),
    prisma.order.aggregate({ where: { ...where, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } }),
    prisma.payment.count({ 
      where: { 
        order: { ...where },
        paymentStatus: { in: ['OVERDUE', 'UNPAID'] },
        dueDate: { lt: new Date() },
      } 
    }),
  ]);
  
  const statusBreakdown = await prisma.order.groupBy({
    by: ['status'],
    where,
    _count: { id: true },
  });
  
  const priorityBreakdown = await prisma.order.groupBy({
    by: ['priority'],
    where,
    _count: { id: true },
  });
  
  res.json({
    stats: {
      totalOrders,
      pendingOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue: totalRevenue._sum.totalAmount || 0,
      overduePayments,
    },
    statusBreakdown: statusBreakdown.map(s => ({ status: s.status, count: s._count.id })),
    priorityBreakdown: priorityBreakdown.map(p => ({ priority: p.priority, count: p._count.id })),
  });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      plant: true,
      supplier: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      approvedBy: { select: { id: true, firstName: true, lastName: true } },
      items: {
        include: {
          part: true,
          receipts: { include: { delivery: true } },
        },
      },
      payments: { orderBy: { createdAt: 'desc' } },
      deliveries: { orderBy: { scheduledDate: 'asc' } },
      statusHistory: { include: { changedBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
      documents: { orderBy: { createdAt: 'desc' } },
    },
  });
  
  if (!order) throw new AppError('Order not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && order.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  res.json({ order });
}));

router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = updateOrderSchema.parse(req.body) as UpdateOrderInput;
  
  const existingOrder = await prisma.order.findUnique({
    where: { id: req.params.id },
  });
  
  if (!existingOrder) throw new AppError('Order not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && existingOrder.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  if (data.status && data.status !== existingOrder.status) {
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
      PENDING_APPROVAL: ['APPROVED', 'CANCELLED', 'DRAFT'],
      APPROVED: ['IN_PRODUCTION', 'ON_HOLD', 'CANCELLED'],
      IN_PRODUCTION: ['READY_FOR_PICKUP', 'ON_HOLD', 'CANCELLED'],
      READY_FOR_PICKUP: ['SHIPPED', 'ON_HOLD', 'CANCELLED'],
      SHIPPED: ['DELIVERED', 'PARTIALLY_DELIVERED', 'ON_HOLD'],
      DELIVERED: ['COMPLETED'],
      PARTIALLY_DELIVERED: ['DELIVERED', 'COMPLETED', 'ON_HOLD'],
      COMPLETED: [],
      CANCELLED: [],
      ON_HOLD: ['APPROVED', 'IN_PRODUCTION', 'CANCELLED'],
    };
    
    if (!validTransitions[existingOrder.status]?.includes(data.status)) {
      throw new AppError(`Cannot transition from ${existingOrder.status} to ${data.status}`, 400);
    }
  }
  
  const updateData: Prisma.OrderUpdateInput = { ...(data as any) };
  if (data.requestedDeliveryDate) updateData.requestedDeliveryDate = new Date(data.requestedDeliveryDate);
  if (data.promisedDeliveryDate) updateData.promisedDeliveryDate = new Date(data.promisedDeliveryDate);
  
  if (data.status && data.status !== existingOrder.status) {
    updateData.statusHistory = {
      create: {
        fromStatus: existingOrder.status,
        toStatus: data.status,
        changedById: req.user!.id,
        reason: `Status changed from ${existingOrder.status} to ${data.status}`,
      },
    };
    
    if (data.status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
      updateData.cancelledById = req.user!.id;
    }
  }
  
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: updateData,
    include: {
      plant: true,
      supplier: true,
      user: { select: { id: true, firstName: true, lastName: true } },
      items: { include: { part: true } },
    },
  });
  
  await prisma.notification.create({
    data: {
      userId: req.user!.id,
      type: 'ORDER_UPDATED',
      title: 'Order Updated',
      message: `Order ${order.orderNumber} has been updated`,
      data: { orderId: order.id, orderNumber: order.orderNumber },
    },
  });
  
  res.json({ order });
}));

router.post('/:id/submit', asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
  });
  
  if (!order) throw new AppError('Order not found', 404);
  if (order.status !== 'DRAFT') throw new AppError('Only draft orders can be submitted', 400);
  
  const updatedOrder = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status: 'PENDING_APPROVAL',
      statusHistory: {
        create: {
          fromStatus: 'DRAFT',
          toStatus: 'PENDING_APPROVAL',
          changedById: req.user!.id,
          reason: 'Submitted for approval',
        },
      },
    },
    include: { plant: true, supplier: true, items: { include: { part: true } } },
  });
  
  const managers = await prisma.user.findMany({
    where: { plantId: order.plantId, role: { in: ['ADMIN', 'PLANT_MANAGER'] }, isActive: true },
  });
  
  await Promise.all(managers.map(manager => 
    prisma.notification.create({
      data: {
        userId: manager.id,
        type: 'ORDER_CREATED',
        title: 'Order Requires Approval',
        message: `Order ${updatedOrder.orderNumber} requires your approval`,
        data: { orderId: updatedOrder.id, orderNumber: updatedOrder.orderNumber },
      },
    })
  ));
  
  res.json({ order: updatedOrder });
}));

router.post('/:id/approve', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
  });
  
  if (!order) throw new AppError('Order not found', 404);
  if (order.status !== 'PENDING_APPROVAL') throw new AppError('Order is not pending approval', 400);
  
  const updatedOrder = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status: 'APPROVED',
      approvedById: req.user!.id,
      statusHistory: {
        create: {
          fromStatus: 'PENDING_APPROVAL',
          toStatus: 'APPROVED',
          changedById: req.user!.id,
          reason: 'Approved by manager',
        },
      },
    },
    include: { plant: true, supplier: true, user: true },
  });
  
  await prisma.notification.create({
    data: {
      userId: order.userId,
      type: 'ORDER_APPROVED',
      title: 'Order Approved',
      message: `Your order ${updatedOrder.orderNumber} has been approved`,
      data: { orderId: updatedOrder.id, orderNumber: updatedOrder.orderNumber },
    },
  });
  
  await prisma.notification.create({
    data: {
      userId: req.user!.id,
      type: 'ORDER_APPROVED',
      title: 'Order Approved',
      message: `You approved order ${updatedOrder.orderNumber}`,
      data: { orderId: updatedOrder.id, orderNumber: updatedOrder.orderNumber },
    },
  });
  
  res.json({ order: updatedOrder });
}));

router.post('/:id/cancel', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { reason } = req.body;
  
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
  });
  
  if (!order) throw new AppError('Order not found', 404);
  if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
    throw new AppError(`Cannot cancel order in ${order.status} status`, 400);
  }
  
  const updatedOrder = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledById: req.user!.id,
      cancellationReason: reason,
      statusHistory: {
        create: {
          fromStatus: order.status,
          toStatus: 'CANCELLED',
          changedById: req.user!.id,
          reason: reason || 'Order cancelled',
        },
      },
    },
  });
  
  await prisma.notification.create({
    data: {
      userId: order.userId,
      type: 'ORDER_UPDATED',
      title: 'Order Cancelled',
      message: `Order ${order.orderNumber} has been cancelled`,
      data: { orderId: order.id, orderNumber: order.orderNumber },
    },
  });
  
  res.json({ order: updatedOrder });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw new AppError('Order not found', 404);
  
  await prisma.order.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

export { router as orderRoutes };
