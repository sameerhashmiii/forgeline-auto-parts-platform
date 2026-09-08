import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { orderRoutes } from './routes/orders.js';
import { partRoutes } from './routes/parts.js';
import { plantRoutes } from './routes/plants.js';
import { supplierRoutes } from './routes/suppliers.js';
import { customerRoutes } from './routes/customers.js';
import { paymentRoutes } from './routes/payments.js';
import { deliveryRoutes } from './routes/deliveries.js';
import { analyticsRoutes } from './routes/analytics.js';
import { notificationRoutes } from './routes/notifications.js';
import { shareableLinkRoutes } from './routes/shareableLinks.js';
import { aiRoutes } from './routes/ai.js';
import { userRoutes } from './routes/users.js';
import { documentRoutes } from './routes/documents.js';
import { publicOrderingRoutes } from './routes/publicOrdering.js';
import { setupSocketHandlers } from './services/socket.js';

const app: Application = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.FRONTEND_URL,
    credentials: true,
  },
});

app.set('io', io);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/public/order-links', publicOrderingRoutes);
app.use('/api/orders', authMiddleware, orderRoutes);
app.use('/api/parts', authMiddleware, partRoutes);
app.use('/api/plants', authMiddleware, plantRoutes);
app.use('/api/suppliers', authMiddleware, supplierRoutes);
app.use('/api/customers', authMiddleware, customerRoutes);
app.use('/api/payments', authMiddleware, paymentRoutes);
app.use('/api/deliveries', authMiddleware, deliveryRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/shareable-links', authMiddleware, shareableLinkRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/documents', authMiddleware, documentRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

setupSocketHandlers(io);

const PORT = env.PORT;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} in ${env.NODE_ENV} mode`);
  console.log(`📡 WebSocket server ready`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  httpServer.close(() => {
    process.exit(0);
  });
});

export { app, io };
