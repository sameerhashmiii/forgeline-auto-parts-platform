import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { paginationSchema, PaginationInput } from '../validators/index.js';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const router = Router();

router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  const { role, plantId, isActive, search } = req.query;
  
  const where: Prisma.UserWhereInput = {};
  if (role) where.role = role as any;
  if (plantId) where.plantId = plantId as string;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) {
    where.OR = [
      { email: { contains: search as string, mode: 'insensitive' } },
      { firstName: { contains: search as string, mode: 'insensitive' } },
      { lastName: { contains: search as string, mode: 'insensitive' } },
    ];
  }
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId) {
    where.plantId = req.user!.plantId;
  }
  
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'createdAt']: sortOrder },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        plantId: true,
        avatarUrl: true,
        isActive: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        plant: { select: { id: true, name: true, code: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  
  res.json({ users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      plantId: true,
      avatarUrl: true,
      isActive: true,
      emailVerified: true,
      lastLoginAt: true,
      createdAt: true,
      plant: { select: { id: true, name: true, code: true } },
      _count: { select: { orders: true, payments: true, notifications: true } },
    },
  });
  
  if (!user) throw new AppError('User not found', 404);
  
  if (req.user!.role !== 'ADMIN' && req.user!.plantId && user.plantId !== req.user!.plantId) {
    throw new AppError('Access denied', 403);
  }
  
  res.json({ user });
}));

router.post('/', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, password, firstName, lastName, phone, role, plantId } = req.body;
  
  const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existingUser) throw new AppError('Email already registered', 409);
  
  const passwordHash = await bcrypt.hash(password, 12);
  
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      firstName,
      lastName,
      phone,
      role: role || 'PROCUREMENT_OFFICER',
      plantId,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      plantId: true,
    },
  });
  
  res.status(201).json({ user });
}));

router.put('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new AppError('User not found', 404);
  
  const { firstName, lastName, phone, role, plantId, isActive, avatarUrl } = req.body;
  
  const updatedUser = await prisma.user.update({
    where: { id: req.params.id },
    data: { firstName, lastName, phone, role, plantId, isActive, avatarUrl },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      plantId: true,
      avatarUrl: true,
      isActive: true,
    },
  });
  
  res.json({ user: updatedUser });
}));

router.put('/:id/password', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new AppError('User not found', 404);
  
  const { password } = req.body;
  const passwordHash = await bcrypt.hash(password, 12);
  
  await prisma.user.update({
    where: { id: req.params.id },
    data: { passwordHash },
  });
  
  res.json({ success: true });
}));

router.delete('/:id', requireRole('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new AppError('User not found', 404);
  
  if (user.id === req.user!.id) throw new AppError('Cannot delete yourself', 400);
  
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));

router.get('/:id/activity', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = paginationSchema.parse(req.query) as PaginationInput;
  
  const [activity, total] = await Promise.all([
    prisma.activityLog.findMany({
      where: { userId: req.params.id },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { [sortBy || 'createdAt']: sortOrder },
    }),
    prisma.activityLog.count({ where: { userId: req.params.id } }),
  ]);
  
  res.json({ activity, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

export { router as userRoutes };