import { PrismaClient, UserRole, PartCategory, OrderStatus, PaymentStatus, PaymentMethod, Priority, DeliveryType, DeliveryStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');
  
  const passwordHash = await bcrypt.hash('password123', 12);
  
  const admin = await prisma.user.upsert({
    where: { email: 'admin@autoparts.com' },
    update: {},
    create: {
      email: 'admin@autoparts.com',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      role: UserRole.ADMIN,
    },
  });
  
  const plant = await prisma.plant.upsert({
    where: { code: 'DET-MI-01' },
    update: {},
    create: {
      name: 'Detroit Manufacturing Plant',
      code: 'DET-MI-01',
      address: '123 Assembly Line Drive',
      city: 'Detroit',
      state: 'MI',
      zipCode: '48201',
      country: 'US',
      phone: '+1-313-555-0100',
      email: 'detroit-plant@autoparts.com',
      timezone: 'America/Detroit',
      managerId: admin.id,
    },
  });
  
  await prisma.user.update({
    where: { id: admin.id },
    data: { plantId: plant.id },
  });
  
  const procurement = await prisma.user.upsert({
    where: { email: 'procurement@autoparts.com' },
    update: {},
    create: {
      email: 'procurement@autoparts.com',
      passwordHash,
      firstName: 'John',
      lastName: 'Procurement',
      role: UserRole.PROCUREMENT_OFFICER,
      plantId: plant.id,
    },
  });
  
  const warehouse = await prisma.user.upsert({
    where: { email: 'warehouse@autoparts.com' },
    update: {},
    create: {
      email: 'warehouse@autoparts.com',
      passwordHash,
      firstName: 'Mike',
      lastName: 'Warehouse',
      role: UserRole.WAREHOUSE_STAFF,
      plantId: plant.id,
    },
  });
  
  const supplier1 = await prisma.supplier.upsert({
    where: { code: 'BOSCH-01' },
    update: {},
    create: {
      name: 'Bosch Automotive Parts',
      code: 'BOSCH-01',
      contactName: 'Sarah Mitchell',
      contactEmail: 'sarah@bosch-auto.com',
      contactPhone: '+1-248-555-0200',
      address: '38000 Hills Tech Drive',
      city: 'Farmington Hills',
      state: 'MI',
      zipCode: '48331',
      taxId: '38-1234567',
      paymentTerms: 30,
      currency: 'USD',
    },
  });
  
  const supplier2 = await prisma.supplier.upsert({
    where: { code: 'DENSO-01' },
    update: {},
    create: {
      name: 'Denso International',
      code: 'DENSO-01',
      contactName: 'Ken Tanaka',
      contactEmail: 'ken@denso.com',
      contactPhone: '+1-248-555-0300',
      address: '24777 Denso Drive',
      city: 'Southfield',
      state: 'MI',
      zipCode: '48033',
      taxId: '38-7654321',
      paymentTerms: 45,
      currency: 'USD',
    },
  });
  
  const supplier3 = await prisma.supplier.upsert({
    where: { code: 'MAGNA-01' },
    update: {},
    create: {
      name: 'Magna International',
      code: 'MAGNA-01',
      contactName: 'Lisa Chen',
      contactEmail: 'lisa@magna.com',
      contactPhone: '+1-734-555-0400',
      address: '33000 Magna Drive',
      city: 'Troy',
      state: 'MI',
      zipCode: '48083',
      taxId: '38-9998888',
      paymentTerms: 30,
      currency: 'USD',
    },
  });
  
  await prisma.plantSupplier.createMany({
    data: [
      { plantId: plant.id, supplierId: supplier1.id, isPreferred: true, leadTimeDays: 5, minOrderValue: 5000 },
      { plantId: plant.id, supplierId: supplier2.id, isPreferred: true, leadTimeDays: 7, minOrderValue: 3000 },
      { plantId: plant.id, supplierId: supplier3.id, isPreferred: false, leadTimeDays: 10, minOrderValue: 10000 },
    ],
    skipDuplicates: true,
  });
  
  const parts = [
    {
      sku: 'ENG-001',
      name: 'V8 Engine Block - 5.7L',
      description: 'Aluminum V8 engine block for 5.7L applications',
      category: PartCategory.ENGINE_COMPONENTS,
      unitOfMeasure: 'EA',
      weight: 185.5,
      manufacturer: 'GM Performance Parts',
      manufacturerPartNumber: '19301105',
      standardCost: 2850.00,
      listPrice: 3420.00,
      supplierId: supplier1.id,
      minOrderQty: 1,
      leadTimeDays: 7,
      tags: ['engine', 'block', 'v8', 'aluminum'],
    },
    {
      sku: 'ENG-002',
      name: 'Crankshaft - Forged Steel 5.7L',
      description: 'Forged steel crankshaft for 5.7L V8',
      category: PartCategory.ENGINE_COMPONENTS,
      unitOfMeasure: 'EA',
      weight: 48.2,
      manufacturer: 'Eagle',
      manufacturerPartNumber: 'CRS-5700',
      standardCost: 425.00,
      listPrice: 510.00,
      supplierId: supplier1.id,
      minOrderQty: 2,
      leadTimeDays: 5,
      tags: ['engine', 'crankshaft', 'forged'],
    },
    {
      sku: 'BRK-001',
      name: 'Front Brake Rotor - 14 inch',
      description: 'Vented front brake rotor for heavy duty applications',
      category: PartCategory.BRAKE_SYSTEM,
      unitOfMeasure: 'EA',
      weight: 12.5,
      manufacturer: 'Brembo',
      manufacturerPartNumber: 'BR-1400-HD',
      standardCost: 85.00,
      listPrice: 119.00,
      supplierId: supplier2.id,
      minOrderQty: 4,
      leadTimeDays: 3,
      tags: ['brake', 'rotor', 'front', 'vented'],
    },
    {
      sku: 'BRK-002',
      name: 'Brake Pad Set - Ceramic Front',
      description: 'Ceramic brake pad set for front axle',
      category: PartCategory.BRAKE_SYSTEM,
      unitOfMeasure: 'SET',
      weight: 3.2,
      manufacturer: 'Akebono',
      manufacturerPartNumber: 'ACT-1400',
      standardCost: 42.00,
      listPrice: 65.00,
      supplierId: supplier2.id,
      minOrderQty: 10,
      leadTimeDays: 2,
      tags: ['brake', 'pads', 'ceramic', 'front'],
    },
    {
      sku: 'SUS-001',
      name: 'Front Shock Absorber - Heavy Duty',
      description: 'Monotube shock absorber for heavy duty suspension',
      category: PartCategory.SUSPENSION,
      unitOfMeasure: 'EA',
      weight: 8.5,
      manufacturer: 'Bilstein',
      manufacturerPartNumber: 'BIL-5100-HD',
      standardCost: 125.00,
      listPrice: 175.00,
      supplierId: supplier1.id,
      minOrderQty: 4,
      leadTimeDays: 5,
      tags: ['suspension', 'shock', 'monotube', 'heavy-duty'],
    },
    {
      sku: 'ELE-001',
      name: 'Alternator - 220 Amp',
      description: 'High output alternator for heavy electrical loads',
      category: PartCategory.ELECTRICAL,
      unitOfMeasure: 'EA',
      weight: 15.8,
      manufacturer: 'Denso',
      manufacturerPartNumber: 'ALT-220-HD',
      standardCost: 285.00,
      listPrice: 365.00,
      supplierId: supplier2.id,
      minOrderQty: 2,
      leadTimeDays: 4,
      tags: ['electrical', 'alternator', 'high-output'],
    },
    {
      sku: 'TRN-001',
      name: 'Transmission Filter Kit - 8L90',
      description: 'Complete transmission filter kit for 8L90 transmission',
      category: PartCategory.TRANSMISSION,
      unitOfMeasure: 'KIT',
      weight: 2.1,
      manufacturer: 'ACDelco',
      manufacturerPartNumber: 'TFK-8L90',
      standardCost: 38.00,
      listPrice: 58.00,
      supplierId: supplier1.id,
      minOrderQty: 10,
      leadTimeDays: 2,
      tags: ['transmission', 'filter', '8L90'],
    },
    {
      sku: 'BOD-001',
      name: 'Front Bumper Cover - Unpainted',
      description: 'Unpainted front bumper cover for 2024 model',
      category: PartCategory.BODY_PANELS,
      unitOfMeasure: 'EA',
      weight: 22.0,
      manufacturer: 'Magna',
      manufacturerPartNumber: 'FBC-2024-UNP',
      standardCost: 320.00,
      listPrice: 450.00,
      supplierId: supplier3.id,
      minOrderQty: 1,
      leadTimeDays: 14,
      tags: ['body', 'bumper', 'front', 'unpainted'],
    },
    {
      sku: 'FLD-001',
      name: 'Synthetic Motor Oil 5W-30 - 55 Gallon Drum',
      description: 'Full synthetic 5W-30 motor oil, 55 gallon drum',
      category: PartCategory.FLUIDS_LUBRICANTS,
      unitOfMeasure: 'DRUM',
      weight: 420.0,
      manufacturer: 'Mobil 1',
      manufacturerPartNumber: 'MOB-5W30-55',
      standardCost: 850.00,
      listPrice: 1100.00,
      supplierId: supplier1.id,
      minOrderQty: 1,
      leadTimeDays: 3,
      tags: ['fluids', 'oil', 'synthetic', '5w30', 'drum'],
    },
    {
      sku: 'FAS-001',
      name: 'Grade 8 Hex Bolt - 1/2-13 x 2 inch',
      description: 'Grade 8 hex bolt, zinc plated',
      category: PartCategory.FASTENERS,
      unitOfMeasure: 'BOX',
      weight: 5.5,
      manufacturer: 'Fastenal',
      manufacturerPartNumber: 'G8-HB-050-200',
      standardCost: 28.00,
      listPrice: 42.00,
      supplierId: supplier3.id,
      minOrderQty: 5,
      leadTimeDays: 1,
      tags: ['fasteners', 'bolt', 'grade8', 'hex'],
    },
  ];
  
  for (const partData of parts) {
    await prisma.part.upsert({
      where: { sku: partData.sku },
      update: {},
      create: partData,
    });
  }
  
  const createdParts = await prisma.part.findMany({ where: { sku: { in: parts.map(p => p.sku) } } });
  
  for (const part of createdParts) {
    await prisma.plantInventory.upsert({
      where: { plantId_partId_location: { plantId: plant.id, partId: part.id, location: 'A1' } },
      update: {},
      create: {
        plantId: plant.id,
        partId: part.id,
        quantityOnHand: Math.floor(Math.random() * 50) + 10,
        quantityReserved: 0,
        reorderPoint: 10,
        maxStockLevel: 100,
        location: 'A1',
        binLocation: 'A1-B2',
      },
    });
  }
  
  await prisma.priceTier.createMany({
    data: [
      { partId: createdParts.find(p => p.sku === 'ENG-001')!.id, minQty: 1, price: 3420.00 },
      { partId: createdParts.find(p => p.sku === 'ENG-001')!.id, minQty: 5, price: 3249.00 },
      { partId: createdParts.find(p => p.sku === 'ENG-001')!.id, minQty: 10, price: 3078.00 },
      { partId: createdParts.find(p => p.sku === 'BRK-001')!.id, minQty: 4, price: 119.00 },
      { partId: createdParts.find(p => p.sku === 'BRK-001')!.id, minQty: 20, price: 107.10 },
      { partId: createdParts.find(p => p.sku === 'BRK-001')!.id, minQty: 50, price: 95.20 },
      { partId: createdParts.find(p => p.sku === 'FLD-001')!.id, minQty: 1, price: 1100.00 },
      { partId: createdParts.find(p => p.sku === 'FLD-001')!.id, minQty: 5, price: 1045.00 },
    ],
    skipDuplicates: true,
  });
  
  const customer = await prisma.customer.upsert({
    where: { code: 'FORD-01' },
    update: {},
    create: {
      code: 'FORD-01',
      name: 'Ford Motor Company',
      contactName: 'Robert Ford',
      contactEmail: 'robert@ford.com',
      contactPhone: '+1-313-555-0500',
      billingAddress: { street: '1 American Road', city: 'Dearborn', state: 'MI', zipCode: '48126' },
      shippingAddress: { street: '1 American Road', city: 'Dearborn', state: 'MI', zipCode: '48126' },
      paymentTerms: 45,
      creditLimit: 500000,
      currency: 'USD',
    },
  });
  
  const order1 = await prisma.order.create({
    data: {
      orderNumber: 'PO-240115-ABC123',
      plantId: plant.id,
      supplierId: supplier1.id,
      userId: procurement.id,
      priority: Priority.HIGH,
      deliveryType: DeliveryType.JUST_IN_TIME,
      subtotal: 15000.00,
      taxAmount: 0,
      shippingAmount: 250.00,
      discountAmount: 500.00,
      totalAmount: 14750.00,
      paymentTerms: 30,
      paymentStatus: PaymentStatus.PARTIALLY_PAID,
      paymentMethod: PaymentMethod.NET_TERMS,
      purchaseOrderNumber: 'FORD-PO-2024-001',
      requestedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: OrderStatus.APPROVED,
      approvedById: admin.id,
      notes: 'Urgent order for production line restart',
      items: {
        create: [
          { partId: createdParts.find(p => p.sku === 'ENG-001')!.id, quantityOrdered: 3, unitPrice: 3420.00, discountPercent: 0, lineTotal: 10260.00 },
          { partId: createdParts.find(p => p.sku === 'ENG-002')!.id, quantityOrdered: 6, unitPrice: 510.00, discountPercent: 5, lineTotal: 2907.00 },
          { partId: createdParts.find(p => p.sku === 'BRK-001')!.id, quantityOrdered: 20, unitPrice: 119.00, discountPercent: 10, lineTotal: 2142.00 },
        ],
      },
      statusHistory: {
        create: [
          { fromStatus: null, toStatus: OrderStatus.DRAFT, changedById: procurement.id, reason: 'Order created' },
          { fromStatus: OrderStatus.DRAFT, toStatus: OrderStatus.PENDING_APPROVAL, changedById: procurement.id, reason: 'Submitted for approval' },
          { fromStatus: OrderStatus.PENDING_APPROVAL, toStatus: OrderStatus.APPROVED, changedById: admin.id, reason: 'Approved by plant manager' },
        ],
      },
    },
  });
  
  await prisma.payment.create({
    data: {
      orderId: order1.id,
      userId: procurement.id,
      amount: 5000.00,
      paymentMethod: PaymentMethod.NET_TERMS,
      paymentStatus: PaymentStatus.PARTIALLY_PAID,
      referenceNumber: 'WIRE-2024-001',
      notes: 'Partial deposit payment',
    },
  });
  
  const delivery = await prisma.delivery.create({
    data: {
      orderId: order1.id,
      supplierId: supplier1.id,
      deliveryNumber: 'DEL-240115-001',
      scheduledDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: DeliveryStatus.SCHEDULED,
      carrier: 'FedEx Freight',
      driverName: 'James Driver',
      driverPhone: '+1-313-555-0600',
      pickupLocation: { address: '38000 Hills Tech Drive', city: 'Farmington Hills', state: 'MI', zipCode: '48331' },
      deliveryLocation: { address: '123 Assembly Line Drive', city: 'Detroit', state: 'MI', zipCode: '48201' },
    },
  });
  
  await prisma.shareableLink.create({
    data: {
      plantId: plant.id,
      code: 'DET-PARTS-2024',
      name: 'Detroit Plant Parts Ordering',
      description: 'Shareable link for Detroit Manufacturing Plant parts ordering',
      createdById: admin.id,
      allowedParts: createdParts.slice(0, 5).map(p => p.id),
      requiresAuth: false,
    },
  });
  
  await prisma.deliverySchedule.create({
    data: {
      plantId: plant.id,
      name: 'Weekly JIT Delivery',
      description: 'Just-in-time delivery every Monday and Thursday',
      frequency: 'WEEKLY',
      daysOfWeek: [1, 4],
      timeWindowStart: '06:00',
      timeWindowEnd: '10:00',
      isActive: true,
    },
  });
  
  await prisma.systemSetting.createMany({
    data: [
      { key: 'company_name', value: '"Auto Parts Platform"', category: 'general', description: 'Company name' },
      { key: 'default_payment_terms', value: '30', category: 'orders', description: 'Default payment terms in days' },
      { key: 'low_stock_threshold_days', value: '7', category: 'inventory', description: 'Days of supply before low stock alert' },
      { key: 'auto_approve_threshold', value: '5000', category: 'orders', description: 'Auto-approve orders under this amount' },
    ],
    skipDuplicates: true,
  });
  
  console.log('✅ Database seeded successfully!');
  console.log('\n📋 Test Accounts:');
  console.log('   Admin: admin@autoparts.com / password123');
  console.log('   Procurement: procurement@autoparts.com / password123');
  console.log('   Warehouse: warehouse@autoparts.com / password123');
  console.log('\n🏭 Plant: Detroit Manufacturing Plant (DET-MI-01)');
  console.log('📦 Suppliers: Bosch, Denso, Magna');
  console.log('🔧 Parts: 10 automotive parts created');
  console.log('🔗 Shareable Link: DET-PARTS-2024');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
