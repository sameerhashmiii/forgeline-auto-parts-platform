import { Router, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.js';
import { aiParseMessageSchema, AiParseMessageInput } from '../validators/index.js';
import OpenAI from 'openai';
import { Prisma } from '@prisma/client';

const router = Router();

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const SYSTEM_PROMPT = `You are an AI assistant that extracts automotive parts order information from messages.

Extract the following information from the message:
- parts: array of objects with partName, quantity, partNumber (optional), description (optional)
- requestedDeliveryDate: ISO date string if mentioned
- urgency: LOW, MEDIUM, HIGH, URGENT, CRITICAL
- notes: any additional information
- customerInfo: name, email, phone, company if mentioned

Return ONLY valid JSON. If information is not mentioned, use null or empty array.`;

router.post('/parse-message', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = aiParseMessageSchema.parse(req.body) as AiParseMessageInput;
  
  if (!openai) {
    throw new AppError('AI service not configured', 503);
  }
  
  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: data.rawMessage },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });
  
  const extractedData = JSON.parse(completion.choices[0].message.content || '{}');
  
  const parsedMessage = await prisma.aiParsedMessage.create({
    data: {
      source: data.source,
      sourceId: data.sourceId,
      rawMessage: data.rawMessage,
      extractedData,
      confidence: 0.85,
    },
  });
  
  res.json({ parsedMessage, extractedData });
}));

router.post('/create-order-from-message', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { parsedMessageId, plantId, supplierId } = req.body;
  
  const parsedMessage = await prisma.aiParsedMessage.findUnique({ where: { id: parsedMessageId } });
  if (!parsedMessage) throw new AppError('Parsed message not found', 404);
  if (parsedMessage.isProcessed) throw new AppError('Message already processed', 400);
  
  const { extractedData } = parsedMessage;
  const { parts, requestedDeliveryDate, urgency, notes, customerInfo } = extractedData;
  
  if (!parts || parts.length === 0) {
    throw new AppError('No parts found in message', 400);
  }
  
  const plant = await prisma.plant.findUnique({ where: { id: plantId } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new AppError('Supplier not found', 404);
  
  const plantSupplier = await prisma.plantSupplier.findUnique({
    where: { plantId_supplierId: { plantId, supplierId } },
  });
  if (!plantSupplier) throw new AppError('Supplier not associated with plant', 400);
  
  const orderItems = [];
  for (const partData of parts) {
    let part = await prisma.part.findFirst({
      where: {
        OR: [
          { name: { contains: partData.partName, mode: 'insensitive' } },
          { sku: { equals: partData.partNumber, mode: 'insensitive' } },
          { manufacturerPartNumber: { equals: partData.partNumber, mode: 'insensitive' } },
        ],
        supplierId: supplier.id,
        isActive: true,
      },
    });
    
    if (!part) {
      throw new AppError(`Part not found: ${partData.partName} (${partData.partNumber || 'no part number'})`, 404);
    }
    
    const priceTier = await prisma.priceTier.findFirst({
      where: { partId: part.id, minQty: { lte: partData.quantity } },
      orderBy: { minQty: 'desc' },
    });
    
    const unitPrice = priceTier ? Number(priceTier.price) : Number(part.listPrice);
    
    orderItems.push({
      partId: part.id,
      quantityOrdered: partData.quantity,
      unitPrice,
      discountPercent: 0,
      notes: partData.description,
    });
  }
  
  const subtotal = orderItems.reduce((sum, item) => sum + item.quantityOrdered * item.unitPrice, 0);
  const totalAmount = subtotal;
  
  const order = await prisma.order.create({
    data: {
      orderNumber: `AI-${Date.now().toString(36).toUpperCase()}`,
      plantId,
      supplierId,
      userId: req.user!.id,
      priority: urgency || 'MEDIUM',
      deliveryType: 'DELIVERY',
      subtotal,
      totalAmount,
      paymentTerms: supplier.paymentTerms,
      requestedDeliveryDate: requestedDeliveryDate ? new Date(requestedDeliveryDate) : null,
      notes: notes || `Created from ${parsedMessage.source} message`,
      internalNotes: `AI-parsed from: ${parsedMessage.rawMessage}`,
      status: 'DRAFT',
      paymentStatus: 'UNPAID',
      items: { create: orderItems },
      statusHistory: {
        create: {
          fromStatus: null,
          toStatus: 'DRAFT',
          changedById: req.user!.id,
          reason: 'Order created from AI-parsed message',
        },
      },
    },
    include: { items: { include: { part: true } } },
  });
  
  await prisma.aiParsedMessage.update({
    where: { id: parsedMessageId },
    data: { isProcessed: true, orderId: order.id },
  });
  
  res.status(201).json({ order });
}));

router.get('/parsed-messages', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const { isProcessed, source } = req.query;
  
  const where: Prisma.AiParsedMessageWhereInput = {};
  if (isProcessed !== undefined) where.isProcessed = isProcessed === 'true';
  if (source) where.source = source as any;
  
  const [messages, total] = await Promise.all([
    prisma.aiParsedMessage.findMany({
      where,
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      orderBy: { [sortBy as string || 'createdAt']: sortOrder as 'asc' | 'desc' },
    }),
    prisma.aiParsedMessage.count({ where }),
  ]);
  
  res.json({ messages, pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) } });
}));

router.get('/suggest-parts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { query, plantId, limit = 10 } = req.query;
  
  if (!query || typeof query !== 'string') {
    return res.json({ suggestions: [] });
  }
  
  const plant = await prisma.plant.findUnique({ where: { id: plantId as string } });
  if (!plant) throw new AppError('Plant not found', 404);
  
  const plantSuppliers = await prisma.plantSupplier.findMany({
    where: { plantId: plant.id },
    select: { supplierId: true },
  });
  const supplierIds = plantSuppliers.map(ps => ps.supplierId);
  
  const parts = await prisma.part.findMany({
    where: {
      isActive: true,
      supplierId: { in: supplierIds },
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { sku: { contains: query, mode: 'insensitive' } },
        { manufacturerPartNumber: { contains: query, mode: 'insensitive' } },
        { oemNumber: { contains: query, mode: 'insensitive' } },
        { tags: { has: query } },
      ],
    },
    take: Number(limit),
    include: { supplier: { select: { id: true, name: true, code: true } }, priceTiers: { orderBy: { minQty: 'asc' } } },
  });
  
  res.json({ suggestions: parts });
}));

export { router as aiRoutes };