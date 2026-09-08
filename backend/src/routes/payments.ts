import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { 
  createPaymentSchema, 
  paginationSchema,
  CreatePaymentInput,
  PaginationInput
} from '../validators/index.js';
import { PaymentStatus, PaymentMethod, Prisma } from '@prisma/client';
import Stripe from 'stripe';

const router = Router();

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' }) : null;

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { status, paymentMethod, orderId, startDate, endDate } = req.query;
  
  const where: Prisma.PaymentWhereInput = {};
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.order = { plantId: req.user!.plantId };
  }
  
  if (status) where.paymentStatus = status as PaymentStatus;
  if (paymentMethod) where.paymentMethod = paymentMethod as PaymentMethod;
  if (orderId) where.orderId = orderId as string;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }
  
  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'createdAt']: sortOrder },
      include: {
        order: { select: { id: true, orderNumber: true, plant: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);
  
  res.json({ payments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/stats', asyncHandler(async (req: AuthRequest, res: Response) => {
  const where: Prisma.PaymentWhereInput = {};
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.order = { plantId: req.user!.plantId };
  }
  
  const [totalPaid, totalOutstanding, overduePayments, byStatus, byMethod] = await Promise.all([
    prisma.payment.aggregate({ where: { ...where, paymentStatus: 'PAID' }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { ...where, paymentStatus: { in: ['UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'OVERDUE'] } }, _sum: { amount: true } }),
    prisma.payment.count({ where: { ...where, paymentStatus: { in: ['OVERDUE', 'UNPAID'] }, dueDate: { lt: new Date() } } }),
    prisma.payment.groupBy({ by: ['paymentStatus'], where, _sum: { amount: true }, _count: { id: true } }),
    prisma.payment.groupBy({ by: ['paymentMethod'], where, _sum: { amount: true }, _count: { id: true } }),
  ]);
  
  res.json({
    stats: {
      totalPaid: totalPaid._sum.amount || 0,
      totalOutstanding: totalOutstanding._sum.amount || 0,
      overdueCount: overduePayments,
      byStatus: byStatus.map(s => ({ status: s.paymentStatus, amount: s._sum.amount || 0, count: s._count.id })),
      byMethod: byMethod.map(m => ({ method: m.paymentMethod, amount: m._sum.amount || 0, count: m._count.id })),
    },
  });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: {
      order: { include: { plant: true, supplier: true, items: { include: { part: true } } } },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  
  if (!payment) throw new AppError('Payment not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && payment.order.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  res.json({ payment });
}));

router.post('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createPaymentSchema.parse(req.body) as CreatePaymentInput;
  
  const order = await prisma.order.findUnique({ where: { id: data.orderId } });
  if (!order) throw new AppError('Order not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && order.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  const existingPayments = await prisma.payment.aggregate({
    where: { orderId: order.id, paymentStatus: { not: 'REFUNDED' } },
    _sum: { amount: true },
  });
  
  const paidAmount = Number(existingPayments._sum.amount || 0);
  const newTotal = paidAmount + data.amount;
  
  if (newTotal > Number(order.totalAmount) + 0.01) {
    throw new AppError('Payment amount exceeds order total', 400);
  }
  
  let paymentStatus = data.paymentStatus;
  if (newTotal >= Number(order.totalAmount) - 0.01) paymentStatus = 'PAID';
  else if (newTotal > 0) paymentStatus = 'PARTIALLY_PAID';
  
  const payment = await prisma.payment.create({
    data: {
      ...data,
      amount: data.amount,
      userId: req.user!.id,
      paymentStatus,
      paidAt: paymentStatus === 'PAID' ? new Date() : null,
    },
    include: { order: { select: { id: true, orderNumber: true } } },
  });
  
  await prisma.order.update({
    where: { id: order.id },
    data: { paymentStatus },
  });
  
  await prisma.notification.create({
    data: {
      userId: order.userId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment Received',
      message: `Payment of $${data.amount} received for order ${order.orderNumber}`,
      data: { paymentId: payment.id, orderId: order.id },
    },
  });
  
  res.status(201).json({ payment });
}));

router.put('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { order: true },
  });
  
  if (!payment) throw new AppError('Payment not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && payment.order.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  const { paymentStatus, transactionId, referenceNumber, notes } = req.body;
  
  const updatedPayment = await prisma.payment.update({
    where: { id: req.params.id },
    data: {
      paymentStatus,
      transactionId,
      referenceNumber,
      notes,
      paidAt: paymentStatus === 'PAID' && !payment.paidAt ? new Date() : payment.paidAt,
    },
  });
  
  if (paymentStatus) {
    const allPayments = await prisma.payment.aggregate({
      where: { orderId: payment.orderId, paymentStatus: { not: 'REFUNDED' } },
      _sum: { amount: true },
    });
    
    const totalPaid = Number(allPayments._sum.amount || 0);
    let newOrderPaymentStatus = PaymentStatus.UNPAID;
    if (totalPaid >= Number(payment.order.totalAmount) - 0.01) newOrderPaymentStatus = 'PAID';
    else if (totalPaid > 0) newOrderPaymentStatus = 'PARTIALLY_PAID';
    
    await prisma.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: newOrderPaymentStatus },
    });
  }
  
  res.json({ payment: updatedPayment });
}));

router.post('/:id/refund', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { order: true },
  });
  
  if (!payment) throw new AppError('Payment not found', 404);
  if (payment.paymentStatus === 'REFUNDED') throw new AppError('Payment already refunded', 400);
  if (payment.paymentStatus !== 'PAID') throw new AppError('Can only refund paid payments', 400);
  
  const { amount, reason } = req.body;
  const refundAmount = amount || Number(payment.amount);
  
  if (stripe && payment.paymentMethod === 'CREDIT_CARD' && payment.transactionId) {
    await stripe.refunds.create({ payment_intent: payment.transactionId, amount: Math.round(refundAmount * 100) });
  }
  
  await prisma.payment.update({
    where: { id: payment.id },
    data: { paymentStatus: 'REFUNDED', notes: `${payment.notes || ''}\nRefund: ${reason}`.trim() },
  });
  
  await prisma.payment.create({
    data: {
      orderId: payment.orderId,
      userId: req.user!.id,
      amount: -refundAmount,
      paymentMethod: payment.paymentMethod,
      paymentStatus: 'REFUNDED',
      referenceNumber: `REFUND-${payment.id}`,
      notes: `Refund for payment ${payment.id}: ${reason}`,
    },
  });
  
  const allPayments = await prisma.payment.aggregate({
    where: { orderId: payment.orderId, paymentStatus: { not: 'REFUNDED' } },
    _sum: { amount: true },
  });
  
  const totalPaid = Number(allPayments._sum.amount || 0);
  let newOrderPaymentStatus = PaymentStatus.UNPAID;
  if (totalPaid >= Number(payment.order.totalAmount) - 0.01) newOrderPaymentStatus = 'PAID';
  else if (totalPaid > 0) newOrderPaymentStatus = 'PARTIALLY_PAID';
  
  await prisma.order.update({
    where: { id: payment.orderId },
    data: { paymentStatus: newOrderPaymentStatus },
  });
  
  res.json({ success: true });
}));

router.post('/stripe/create-intent', asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!stripe) throw new AppError('Stripe not configured', 500);
  
  const { orderId, amount } = req.body;
  
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError('Order not found', 404);
  
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: order.currency.toLowerCase(),
    metadata: { orderId: order.id, orderNumber: order.orderNumber },
  });
  
  res.json({ clientSecret: paymentIntent.client_secret });
}));

export { router as paymentRoutes };