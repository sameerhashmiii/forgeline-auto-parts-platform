import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { 
  createCustomerSchema, 
  paginationSchema,
  CreateCustomerInput,
  PaginationInput
} from '../validators/index.js';
import { Prisma } from '@prisma/client';

const router = Router();

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { isActive, search } = req.query;
  
  const where: Prisma.CustomerWhereInput = {};
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { code: { contains: search as string, mode: 'insensitive' } },
      { contactName: { contains: search as string, mode: 'insensitive' } },
      { contactEmail: { contains: search as string, mode: 'insensitive' } },
    ];
  }
  
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'name']: sortOrder },
      include: {
        _count: { select: { orders: true, notes: true } },
      },
    }),
    prisma.customer.count({ where }),
  ]);
  
  res.json({ customers, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      orders: { take: 20, orderBy: { createdAt: 'desc' }, include: { items: { include: { part: true } } } },
      customerNotes: { include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
    },
  });
  
  if (!customer) throw new AppError('Customer not found', 404);
  
  const totalOrders = await prisma.order.count({ where: { customerId: customer.id } });
  const totalSpent = await prisma.order.aggregate({
    where: { customerId: customer.id, status: { not: 'CANCELLED' } },
    _sum: { totalAmount: true },
  });
  
  res.json({ customer, stats: { totalOrders, totalSpent: totalSpent._sum.totalAmount || 0 } });
}));

router.post('/', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = createCustomerSchema.parse(req.body) as CreateCustomerInput;
  
  const existingCustomer = await prisma.customer.findUnique({ where: { code: data.code } });
  if (existingCustomer) throw new AppError('Customer code already exists', 409);
  
  const customer = await prisma.customer.create({
    data: { ...data, code: data.code.toUpperCase() },
  });
  
  res.status(201).json({ customer });
}));

router.put('/:id', requireRole('ADMIN', 'PLANT_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!customer) throw new AppError('Customer not found', 404);
  
  const updateData = { ...req.body };
  if (updateData.code) updateData.code = updateData.code.toUpperCase();
  
  const updatedCustomer = await prisma.customer.update({
    where: { id: req.params.id },
    data: updateData,
  });
  
  res.json({ customer: updatedCustomer });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!customer) throw new AppError('Customer not found', 404);
  
  const ordersCount = await prisma.order.count({ where: { customerId: customer.id } });
  if (ordersCount > 0) {
    throw new AppError('Cannot delete customer with existing orders. Deactivate instead.', 400);
  }
  
  await prisma.customer.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

router.post('/:id/notes', asyncHandler(async (req: AuthRequest, res: Response) => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!customer) throw new AppError('Customer not found', 404);
  
  const { content, isPrivate } = req.body;
  
  const note = await prisma.customerNote.create({
    data: {
      customerId: customer.id,
      userId: req.user!.id,
      content,
      isPrivate: isPrivate || false,
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  
  res.status(201).json({ note });
}));

router.delete('/:id/notes/:noteId', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.customerNote.delete({ where: { id: req.params.noteId } });
  res.json({ success: true });
}));

export { router as customerRoutes };
