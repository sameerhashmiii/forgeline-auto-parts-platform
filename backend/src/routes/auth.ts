import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { 
  loginSchema, 
  registerSchema, 
  changePasswordSchema,
  LoginInput,
  RegisterInput 
} from '../validators/index.js';

const router = Router();

const generateTokens = (user: { id: string; email: string; role: string; plantId?: string }) => {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, plantId: user.plantId },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as any }
  );
  
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any }
  );
  
  return { accessToken, refreshToken };
};

const setTokenCookies = (res: Response, accessToken: string, refreshToken: string) => {
  const isProduction = env.NODE_ENV === 'production';
  
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
};

const clearTokenCookies = (res: Response) => {
  const isProduction = env.NODE_ENV === 'production';
  
  res.clearCookie('accessToken', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
  });
  
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
  });
};

router.post('/login', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = loginSchema.parse(req.body) as LoginInput;
  
  const user = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });
  
  if (!user || !user.isActive) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }
  
  const isValidPassword = await bcrypt.compare(data.password, user.passwordHash);
  if (!isValidPassword) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }
  
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  
  const { accessToken, refreshToken } = generateTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    plantId: user.plantId || undefined,
  });
  
  setTokenCookies(res, accessToken, refreshToken);
  
  res.json({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      plantId: user.plantId,
      avatarUrl: user.avatarUrl,
    },
  });
}));

router.post('/register', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = registerSchema.parse(req.body) as RegisterInput;
  
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });
  
  if (existingUser) {
    throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
  }
  
  const passwordHash = await bcrypt.hash(data.password, 12);
  
  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      role: data.role || 'PROCUREMENT_OFFICER',
      plantId: data.plantId,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      plantId: true,
      avatarUrl: true,
    },
  });
  
  const { accessToken, refreshToken } = generateTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    plantId: user.plantId || undefined,
  });
  
  setTokenCookies(res, accessToken, refreshToken);
  
  res.status(201).json({ user });
}));

router.post('/refresh', asyncHandler(async (req: AuthRequest, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;
  
  if (!refreshToken) {
    throw new AppError('Refresh token required', 401, 'REFRESH_TOKEN_REQUIRED');
  }
  
  try {
    const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
      id: string;
      type: string;
    };
    
    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type', 401, 'INVALID_TOKEN_TYPE');
    }
    
    const user = await prisma.user.findUnique({
      where: { id: decoded.id, isActive: true },
    });
    
    if (!user) {
      throw new AppError('User not found', 401, 'USER_NOT_FOUND');
    }
    
    const { accessToken, refreshToken: newRefreshToken } = generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      plantId: user.plantId || undefined,
    });
    
    setTokenCookies(res, accessToken, newRefreshToken);
    
    res.json({ success: true });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError('Refresh token expired', 401, 'REFRESH_TOKEN_EXPIRED');
    }
    throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }
}));

router.post('/logout', asyncHandler(async (_req: AuthRequest, res: Response) => {
  clearTokenCookies(res);
  res.json({ success: true });
}));

router.get('/me', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
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
      plant: {
        select: { id: true, name: true, code: true },
      },
    },
  });
  
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  
  res.json({ user });
}));

router.put('/password', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = changePasswordSchema.parse(req.body);
  
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
  });
  
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  
  const isValidPassword = await bcrypt.compare(data.currentPassword, user.passwordHash);
  if (!isValidPassword) {
    throw new AppError('Current password is incorrect', 400, 'INVALID_CURRENT_PASSWORD');
  }
  
  const passwordHash = await bcrypt.hash(data.newPassword, 12);
  
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
  
  clearTokenCookies(res);
  
  res.json({ success: true, message: 'Password changed. Please log in again.' });
}));

router.put('/profile', authMiddleware, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { firstName, lastName, phone, avatarUrl } = req.body;
  
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      firstName,
      lastName,
      phone,
      avatarUrl,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      plantId: true,
      avatarUrl: true,
    },
  });
  
  res.json({ user });
}));

export { router as authRoutes };
