import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  phone: z.string().optional(),
  role: z.enum(['ADMIN', 'PLANT_MANAGER', 'PROCUREMENT_OFFICER', 'SUPPLIER', 'WAREHOUSE_STAFF']).optional(),
  plantId: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const createOrderSchema = z.object({
  plantId: z.string().cuid(),
  supplierId: z.string().cuid(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']).default('MEDIUM'),
  deliveryType: z.enum(['PICKUP', 'DELIVERY', 'JUST_IN_TIME', 'SCHEDULED']).default('DELIVERY'),
  requestedDeliveryDate: z.string().datetime().optional(),
  paymentTerms: z.number().int().min(0).max(365).default(30),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CREDIT_CARD', 'ACH', 'WIRE_TRANSFER', 'NET_TERMS', 'PURCHASE_ORDER']).optional(),
  purchaseOrderNumber: z.string().max(100).optional(),
  shippingAddress: z.record(z.any()).optional(),
  billingAddress: z.record(z.any()).optional(),
  notes: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  items: z.array(z.object({
    partId: z.string().cuid(),
    quantityOrdered: z.number().int().min(1),
    unitPrice: z.number().nonnegative(),
    discountPercent: z.number().min(0).max(100).default(0),
    notes: z.string().max(1000).optional(),
  })).min(1, 'At least one item is required'),
});

export const updateOrderSchema = z.object({
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']).optional(),
  deliveryType: z.enum(['PICKUP', 'DELIVERY', 'JUST_IN_TIME', 'SCHEDULED']).optional(),
  requestedDeliveryDate: z.string().datetime().optional(),
  promisedDeliveryDate: z.string().datetime().optional(),
  paymentTerms: z.number().int().min(0).max(365).optional(),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CREDIT_CARD', 'ACH', 'WIRE_TRANSFER', 'NET_TERMS', 'PURCHASE_ORDER']).optional(),
  purchaseOrderNumber: z.string().max(100).optional(),
  shippingAddress: z.record(z.any()).optional(),
  billingAddress: z.record(z.any()).optional(),
  notes: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PRODUCTION', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'COMPLETED', 'CANCELLED', 'ON_HOLD']).optional(),
});

export const createPartSchema = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: z.enum(['ENGINE_COMPONENTS', 'TRANSMISSION', 'BRAKE_SYSTEM', 'SUSPENSION', 'ELECTRICAL', 'BODY_PANELS', 'INTERIOR', 'EXTERIOR', 'FLUIDS_LUBRICANTS', 'FASTENERS', 'TOOLING', 'SAFETY_EQUIPMENT', 'RAW_MATERIALS', 'PACKAGING', 'OTHER']),
  unitOfMeasure: z.string().max(20).default('EA'),
  weight: z.number().nonnegative().optional(),
  dimensions: z.record(z.any()).optional(),
  specifications: z.record(z.any()).optional(),
  manufacturer: z.string().max(200).optional(),
  manufacturerPartNumber: z.string().max(100).optional(),
  oemNumber: z.string().max(100).optional(),
  isHazardous: z.boolean().default(false),
  requiresSerialTracking: z.boolean().default(false),
  shelfLifeDays: z.number().int().positive().optional(),
  minOrderQty: z.number().int().min(1).default(1),
  maxOrderQty: z.number().int().positive().optional(),
  leadTimeDays: z.number().int().min(0).default(7),
  standardCost: z.number().nonnegative(),
  listPrice: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
  tags: z.array(z.string()).default([]),
  supplierId: z.string().cuid(),
});

export const createPlantSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(20).toUpperCase(),
  address: z.string().min(1).max(500),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  zipCode: z.string().min(1).max(20),
  country: z.string().length(2).default('US'),
  phone: z.string().max(50).optional(),
  email: z.string().email().optional(),
  timezone: z.string().default('America/New_York'),
  operatingHours: z.record(z.any()).optional(),
});

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(20).toUpperCase(),
  contactName: z.string().max(100).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().length(2).default('US'),
  taxId: z.string().max(50).optional(),
  paymentTerms: z.number().int().min(0).max(365).default(30),
  currency: z.string().length(3).default('USD'),
});

export const createCustomerSchema = z.object({
  code: z.string().min(1).max(20).toUpperCase(),
  name: z.string().min(1).max(200),
  contactName: z.string().max(100).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(50).optional(),
  billingAddress: z.record(z.any()).optional(),
  shippingAddress: z.record(z.any()).optional(),
  paymentTerms: z.number().int().min(0).max(365).default(30),
  creditLimit: z.number().nonnegative().optional(),
  currency: z.string().length(3).default('USD'),
  taxExempt: z.boolean().default(false),
  taxId: z.string().max(50).optional(),
});

export const createPaymentSchema = z.object({
  orderId: z.string().cuid(),
  amount: z.number().positive(),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CREDIT_CARD', 'ACH', 'WIRE_TRANSFER', 'NET_TERMS', 'PURCHASE_ORDER']),
  paymentStatus: z.enum(['UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'REFUNDED', 'DISPUTED']).default('UNPAID'),
  transactionId: z.string().max(100).optional(),
  referenceNumber: z.string().max(100).optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

export const createDeliverySchema = z.object({
  orderId: z.string().cuid(),
  supplierId: z.string().cuid(),
  scheduledDate: z.string().datetime(),
  pickupLocation: z.record(z.any()).optional(),
  deliveryLocation: z.record(z.any()).optional(),
  carrier: z.string().max(100).optional(),
  driverName: z.string().max(100).optional(),
  driverPhone: z.string().max(50).optional(),
  vehicleInfo: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

export const createDeliveryScheduleSchema = z.object({
  plantId: z.string().cuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']).default('WEEKLY'),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  timeWindowStart: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
  timeWindowEnd: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
});

export const createShareableLinkSchema = z.object({
  plantId: z.string().cuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  expiresAt: z.string().datetime().optional(),
  maxUses: z.number().int().positive().optional(),
  allowedParts: z.array(z.string().cuid()).default([]),
  allowedSuppliers: z.array(z.string().cuid()).default([]),
  requiresAuth: z.boolean().default(false),
});

export const createNotificationSchema = z.object({
  userId: z.string().cuid(),
  type: z.enum(['ORDER_CREATED', 'ORDER_UPDATED', 'ORDER_APPROVED', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'DELIVERY_SCHEDULED', 'DELIVERY_REMINDER', 'LOW_STOCK_ALERT', 'NEW_MESSAGE', 'SYSTEM_ALERT']),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  data: z.record(z.any()).optional(),
});

export const aiParseMessageSchema = z.object({
  source: z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'SLACK', 'TEAMS', 'OTHER']),
  sourceId: z.string().max(200),
  rawMessage: z.string().min(1).max(10000),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type CreatePartInput = z.infer<typeof createPartSchema>;
export type CreatePlantInput = z.infer<typeof createPlantSchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
export type CreateDeliveryScheduleInput = z.infer<typeof createDeliveryScheduleSchema>;
export type CreateShareableLinkInput = z.infer<typeof createShareableLinkSchema>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
export type AiParseMessageInput = z.infer<typeof aiParseMessageSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type DateRangeInput = z.infer<typeof dateRangeSchema>;