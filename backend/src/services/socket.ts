import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
  plantId?: string;
}

export const setupSocketHandlers = (io: SocketIOServer) => {
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication required'));
      }
      
      const decoded = jwt.verify(token, env.JWT_SECRET) as {
        id: string;
        email: string;
        role: string;
        plantId?: string;
      };
      
      const user = await prisma.user.findUnique({
        where: { id: decoded.id, isActive: true },
        select: { id: true, role: true, plantId: true },
      });
      
      if (!user) {
        return next(new Error('User not found'));
      }
      
      socket.userId = user.id;
      socket.userRole = user.role;
      socket.plantId = user.plantId || undefined;
      
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });
  
  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`User connected: ${socket.userId} (${socket.userRole})`);
    
    if (socket.plantId) {
      socket.join(`plant:${socket.plantId}`);
    }
    socket.join(`user:${socket.userId}`);
    socket.join(`role:${socket.userRole}`);
    
    socket.on('subscribe:orders', (filters: any) => {
      const room = `orders:${socket.plantId}:${JSON.stringify(filters)}`;
      socket.join(room);
    });
    
    socket.on('unsubscribe:orders', (filters: any) => {
      const room = `orders:${socket.plantId}:${JSON.stringify(filters)}`;
      socket.leave(room);
    });
    
    socket.on('subscribe:deliveries', () => {
      if (socket.plantId) {
        socket.join(`deliveries:${socket.plantId}`);
      }
    });
    
    socket.on('subscribe:inventory', () => {
      if (socket.plantId) {
        socket.join(`inventory:${socket.plantId}`);
      }
    });
    
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
    });
  });
};

export const emitOrderUpdate = (io: SocketIOServer, plantId: string, order: any) => {
  io.to(`plant:${plantId}`).emit('order:updated', order);
  io.to(`orders:${plantId}:all`).emit('order:updated', order);
};

export const emitOrderCreated = (io: SocketIOServer, plantId: string, order: any) => {
  io.to(`plant:${plantId}`).emit('order:created', order);
  io.to(`orders:${plantId}:all`).emit('order:created', order);
};

export const emitDeliveryUpdate = (io: SocketIOServer, plantId: string, delivery: any) => {
  io.to(`plant:${plantId}`).emit('delivery:updated', delivery);
  io.to(`deliveries:${plantId}`).emit('delivery:updated', delivery);
};

export const emitInventoryUpdate = (io: SocketIOServer, plantId: string, inventory: any) => {
  io.to(`plant:${plantId}`).emit('inventory:updated', inventory);
  io.to(`inventory:${plantId}`).emit('inventory:updated', inventory);
};

export const emitNotification = (io: SocketIOServer, userId: string, notification: any) => {
  io.to(`user:${userId}`).emit('notification', notification);
};

export const emitPaymentUpdate = (io: SocketIOServer, plantId: string, payment: any) => {
  io.to(`plant:${plantId}`).emit('payment:updated', payment);
};

export const emitAnalyticsUpdate = (io: SocketIOServer, plantId: string, data: any) => {
  io.to(`plant:${plantId}`).emit('analytics:updated', data);
};