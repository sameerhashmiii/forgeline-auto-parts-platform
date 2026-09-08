import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';
import { subDays, startOfDay, endOfDay, format, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns';

const router = Router();

router.get('/dashboard', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate } = req.query;
  const plantId = req.user!.plantId;
  
  const where: Prisma.OrderWhereInput = {};
  if (plantId) where.plantId = plantId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }
  
  const [
    totalOrders,
    totalRevenue,
    pendingOrders,
    completedOrders,
    overduePayments,
    lowStockItems,
    recentOrders,
    topParts,
    topSuppliers,
    ordersByStatus,
    revenueByPeriod,
  ] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.aggregate({ where: { ...where, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } }),
    prisma.order.count({ where: { ...where, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION'] } } }),
    prisma.order.count({ where: { ...where, status: 'COMPLETED' } }),
    prisma.payment.count({ where: { order: { ...where }, paymentStatus: { in: ['OVERDUE', 'UNPAID'] }, dueDate: { lt: new Date() } } }),
    prisma.plantInventory.findMany({ where: { plantId: plantId! }, select: { quantityOnHand: true, reorderPoint: true } }),
    prisma.order.findMany({
      where,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { plant: true, supplier: true, items: { include: { part: true } } },
    }),
    prisma.orderItem.groupBy({
      by: ['partId'],
      where: { order: { ...where, status: { not: 'CANCELLED' } } },
      _sum: { quantityOrdered: true, lineTotal: true },
      orderBy: { _sum: { quantityOrdered: 'desc' } },
      take: 10,
    }),
    prisma.order.groupBy({
      by: ['supplierId'],
      where: { ...where, status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true },
      _count: { id: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 10,
    }),
    prisma.order.groupBy({ by: ['status'], where, _count: { id: true } }),
    prisma.order.groupBy({
      by: ['createdAt'],
      where: { ...where, status: { not: 'CANCELLED' }, createdAt: { gte: subDays(new Date(), 30) } },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
  ]);
  
  const topPartsWithDetails = await Promise.all(
    topParts.map(async (p) => {
      const part = await prisma.part.findUnique({ where: { id: p.partId }, select: { sku: true, name: true, category: true } });
      return { ...p, part };
    })
  );
  
  const topSuppliersWithDetails = await Promise.all(
    topSuppliers.map(async (s) => {
      const supplier = await prisma.supplier.findUnique({ where: { id: s.supplierId }, select: { name: true, code: true } });
      return { ...s, supplier };
    })
  );
  
  const dailyRevenue = eachDayOfInterval({
    start: subDays(new Date(), 30),
    end: new Date(),
  }).map(date => {
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);
    const dayData = revenueByPeriod.find(r => 
      new Date(r.createdAt) >= dayStart && new Date(r.createdAt) <= dayEnd
    );
    return {
      date: format(date, 'yyyy-MM-dd'),
      revenue: Number(dayData?._sum.totalAmount || 0),
      orders: dayData?._count.id || 0,
    };
  });
  
  res.json({
    dashboard: {
      summary: {
        totalOrders,
        totalRevenue: Number(totalRevenue._sum.totalAmount || 0),
        pendingOrders,
        completedOrders,
        overduePayments,
        lowStockItems: lowStockItems.filter(item => item.quantityOnHand <= item.reorderPoint).length,
      },
      recentOrders,
      topParts: topPartsWithDetails,
      topSuppliers: topSuppliersWithDetails,
      ordersByStatus: ordersByStatus.map(s => ({ status: s.status, count: s._count.id })),
      dailyRevenue,
    },
  });
}));

router.get('/sales', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, groupBy = 'day' } = req.query;
  const plantId = req.user!.plantId;
  
  const where: Prisma.OrderWhereInput = { status: { not: 'CANCELLED' } };
  if (plantId) where.plantId = plantId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }
  
  const orders = await prisma.order.findMany({
    where,
    select: { createdAt: true, totalAmount: true, status: true, plantId: true },
  });
  
  const grouped = orders.reduce((acc, order) => {
    let key: string;
    const date = new Date(order.createdAt);
    if (groupBy === 'day') key = format(date, 'yyyy-MM-dd');
    else if (groupBy === 'week') key = format(date, 'yyyy-\'W\'ww');
    else key = format(date, 'yyyy-MM');
    
    if (!acc[key]) acc[key] = { revenue: 0, orders: 0 };
    acc[key].revenue += Number(order.totalAmount);
    acc[key].orders += 1;
    return acc;
  }, {} as Record<string, { revenue: number; orders: number }>);
  
  const series = Object.entries(grouped).map(([period, data]) => ({ period, ...data }));
  
  res.json({ series });
}));

router.get('/parts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, limit = 20 } = req.query;
  const plantId = req.user!.plantId;
  
  const where: Prisma.OrderItemWhereInput = {};
  if (plantId) where.order = { plantId };
  if (startDate || endDate) {
    where.order = { ...where.order, createdAt: {} };
    if (startDate) where.order!.createdAt!.gte = new Date(startDate as string);
    if (endDate) where.order!.createdAt!.lte = new Date(endDate as string);
  }
  where.order = { ...where.order, status: { not: 'CANCELLED' } };
  
  const items = await prisma.orderItem.groupBy({
    by: ['partId'],
    where,
    _sum: { quantityOrdered: true, lineTotal: true },
    _count: { id: true },
    orderBy: { _sum: { quantityOrdered: 'desc' } },
    take: Number(limit),
  });
  
  const partsWithDetails = await Promise.all(
    items.map(async (item) => {
      const part = await prisma.part.findUnique({
        where: { id: item.partId },
        select: { sku: true, name: true, category: true, listPrice: true },
      });
      return { ...item, part };
    })
  );
  
  res.json({ topParts: partsWithDetails });
}));

router.get('/suppliers', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, limit = 20 } = req.query;
  const plantId = req.user!.plantId;
  
  const where: Prisma.OrderWhereInput = { status: { not: 'CANCELLED' } };
  if (plantId) where.plantId = plantId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }
  
  const suppliers = await prisma.order.groupBy({
    by: ['supplierId'],
    where,
    _sum: { totalAmount: true },
    _count: { id: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
    take: Number(limit),
  });
  
  const suppliersWithDetails = await Promise.all(
    suppliers.map(async (s) => {
      const supplier = await prisma.supplier.findUnique({
        where: { id: s.supplierId },
        select: { name: true, code: true, rating: true },
      });
      return { ...s, supplier };
    })
  );
  
  res.json({ topSuppliers: suppliersWithDetails });
}));

router.get('/inventory', asyncHandler(async (req: AuthRequest, res: Response) => {
  const plantId = req.user!.plantId;
  if (!plantId) throw new AppError('Plant ID required', 400);
  
  const inventory = await prisma.plantInventory.findMany({
    where: { plantId },
    include: { part: { select: { sku: true, name: true, category: true, listPrice: true } } },
  });
  
  const totalValue = inventory.reduce((sum, item) => 
    sum + (item.quantityOnHand * Number(item.part.listPrice)), 0);
  
  const lowStock = inventory.filter(item => item.quantityOnHand <= item.reorderPoint);
  const outOfStock = inventory.filter(item => item.quantityOnHand === 0);
  const overstocked = inventory.filter(item => item.quantityOnHand > item.maxStockLevel);
  
  const byCategory = inventory.reduce((acc, item) => {
    const cat = item.part.category;
    if (!acc[cat]) acc[cat] = { count: 0, value: 0, items: 0 };
    acc[cat].count += 1;
    acc[cat].value += item.quantityOnHand * Number(item.part.listPrice);
    acc[cat].items += item.quantityOnHand;
    return acc;
  }, {} as Record<string, { count: number; value: number; items: number }>);
  
  res.json({
    inventory: {
      totalItems: inventory.length,
      totalValue,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      overstockedCount: overstocked.length,
      lowStockItems: lowStock.slice(0, 20),
      outOfStockItems: outOfStock.slice(0, 20),
      byCategory: Object.entries(byCategory).map(([category, data]) => ({ category, ...data })),
    },
  });
}));

router.get('/orders/heatmap', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate } = req.query;
  const plantId = req.user!.plantId;
  
  const where: Prisma.OrderWhereInput = { status: { not: 'CANCELLED' } };
  if (plantId) where.plantId = plantId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate as string);
    if (endDate) where.createdAt.lte = new Date(endDate as string);
  }
  
  const orders = await prisma.order.findMany({
    where,
    select: { createdAt: true, totalAmount: true },
  });
  
  const heatmap: Record<string, Record<number, { orders: number; revenue: number }>> = {};
  
  orders.forEach(order => {
    const date = new Date(order.createdAt);
    const day = format(date, 'EEEE');
    const hour = date.getHours();
    
    if (!heatmap[day]) heatmap[day] = {};
    if (!heatmap[day][hour]) heatmap[day][hour] = { orders: 0, revenue: 0 };
    
    heatmap[day][hour].orders += 1;
    heatmap[day][hour].revenue += Number(order.totalAmount);
  });
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const result = days.map(day => ({
    day,
    hours: Array.from({ length: 24 }, (_, hour) => heatmap[day]?.[hour] || { orders: 0, revenue: 0 }),
  }));
  
  res.json({ heatmap: result });
}));

export { router as analyticsRoutes };
