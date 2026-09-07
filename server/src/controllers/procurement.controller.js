import { z } from 'zod';
import { PurchaseOrder } from '../models/PurchaseOrder.js';
import { Grn } from '../models/Grn.js';
import { Rfq } from '../models/Rfq.js';
import { Party } from '../models/Party.js';
import { Material } from '../models/Material.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';
import { nextCode } from '../utils/numbering.js';
import { postMovement } from '../services/inventory.js';
import { ACC, postJournal } from '../services/accounting.js';
import { assertPeriodOpen } from '../services/periods.js';
import { approvalLimitFor } from '../config/roles.js';
import { getSettings } from '../models/Setting.js';
import { round2, round3, sum } from '../utils/money.js';

/* ========================================================================== */
/* Purchase orders                                                            */
/* ========================================================================== */

export const poSchema = z.object({
  supplier: z.string().min(1, 'Select a supplier'),
  date: z.coerce.date().optional(),
  expectedDate: z.coerce.date().optional(),
  reference: z.string().optional().default(''),
  deliveryLocation: z.string().optional().default('RM Store'),
  paymentTerms: z.string().optional().default('30 days'),
  remarks: z.string().optional().default(''),
  lines: z
    .array(
      z.object({
        material: z.string().min(1),
        qty: z.coerce.number().gt(0, 'Quantity must be greater than zero'),
        rate: z.coerce.number().min(0),
        taxRate: z.coerce.number().min(0).max(100).optional(),
        requiredBy: z.coerce.date().optional(),
        remarks: z.string().optional().default(''),
      })
    )
    .min(1, 'Add at least one line'),
});

async function priceLines(rawLines, defaultTaxRate) {
  const materials = await Material.find({ _id: { $in: rawLines.map((l) => l.material) } });
  const map = new Map(materials.map((m) => [String(m._id), m]));

  const lines = rawLines.map((l) => {
    const m = map.get(String(l.material));
    if (!m) throw ApiError.badRequest('Material ' + l.material + ' does not exist');
    const amount = round2(l.qty * l.rate);
    const taxRate = l.taxRate ?? m.taxRate ?? defaultTaxRate;
    const taxAmount = round2((amount * taxRate) / 100);
    return {
      material: m._id,
      materialCode: m.code,
      materialName: m.name,
      uom: m.uom,
      qty: round3(l.qty),
      rate: round2(l.rate),
      taxRate,
      amount,
      taxAmount,
      lineTotal: round2(amount + taxAmount),
      receivedQty: 0,
      invoicedQty: 0,
      requiredBy: l.requiredBy,
      remarks: l.remarks || '',
    };
  });

  return {
    lines,
    subtotal: round2(sum(lines, (l) => l.amount)),
    taxTotal: round2(sum(lines, (l) => l.taxAmount)),
    grandTotal: round2(sum(lines, (l) => l.lineTotal)),
  };
}

export const listPurchaseOrders = asyncHandler(async (req, res) => {
  const { status, supplier, search } = req.query;
  const q = {};
  if (status) q.status = status;
  if (supplier) q.supplier = supplier;
  if (search) q.$or = [{ code: new RegExp(search, 'i') }, { supplierName: new RegExp(search, 'i') }];

  const orders = await PurchaseOrder.find(q)
    .populate('createdBy approvedBy submittedBy', 'name role')
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    data: orders,
    summary: {
      count: orders.length,
      open: orders.filter((o) => ['APPROVED', 'PARTIALLY_RECEIVED'].includes(o.status)).length,
      awaitingApproval: orders.filter((o) => o.status === 'PENDING_APPROVAL').length,
      value: round2(sum(orders, (o) => o.grandTotal)),
    },
  });
});

export const getPurchaseOrder = asyncHandler(async (req, res) => {
  const order = await PurchaseOrder.findById(req.params.id)
    .populate('supplier')
    .populate('createdBy approvedBy submittedBy', 'name role email');
  if (!order) throw ApiError.notFound('Purchase order not found');

  const receipts = await Grn.find({ purchaseOrder: order._id })
    .populate('receivedBy', 'name role')
    .sort({ date: 1 })
    .lean();

  res.json({ data: order, receipts });
});

export const createPurchaseOrder = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const supplier = await Party.findById(req.body.supplier);
  if (!supplier) throw ApiError.notFound('Supplier not found');
  if (supplier.type !== 'SUPPLIER') throw ApiError.badRequest('That party is a customer, not a supplier');

  const totals = await priceLines(req.body.lines, settings.defaultSalesTaxRate);
  const code = await nextCode('PO-P');

  const order = await PurchaseOrder.create({
    code,
    supplier: supplier._id,
    supplierName: supplier.name,
    date: req.body.date || new Date(),
    expectedDate: req.body.expectedDate,
    reference: req.body.reference,
    deliveryLocation: req.body.deliveryLocation,
    paymentTerms: req.body.paymentTerms,
    remarks: req.body.remarks,
    ...totals,
    status: 'DRAFT',
    createdBy: req.user._id,
  });

  recordAudit(req, {
    action: 'po.create',
    entity: 'PurchaseOrder',
    entityId: order._id,
    entityCode: order.code,
    detail: supplier.name + ' Rs. ' + order.grandTotal,
  });
  res.status(201).json({ data: order });
});

export const updatePurchaseOrder = asyncHandler(async (req, res) => {
  const order = await PurchaseOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Purchase order not found');
  if (!['DRAFT'].includes(order.status)) {
    throw ApiError.badRequest('Only a draft purchase order can be edited (this one is ' + order.status + ')');
  }

  const settings = await getSettings();
  const totals = await priceLines(req.body.lines, settings.defaultSalesTaxRate);
  Object.assign(order, {
    date: req.body.date || order.date,
    expectedDate: req.body.expectedDate ?? order.expectedDate,
    reference: req.body.reference ?? order.reference,
    deliveryLocation: req.body.deliveryLocation ?? order.deliveryLocation,
    paymentTerms: req.body.paymentTerms ?? order.paymentTerms,
    remarks: req.body.remarks ?? order.remarks,
    ...totals,
  });
  await order.save();
  res.json({ data: order });
});

export const submitPurchaseOrder = asyncHandler(async (req, res) => {
  const order = await PurchaseOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Purchase order not found');
  if (order.status !== 'DRAFT') throw ApiError.badRequest('Only a draft purchase order can be submitted');

  order.status = 'PENDING_APPROVAL';
  order.submittedBy = req.user._id;
  order.submittedAt = new Date();
  order.rejectionReason = '';
  await order.save();

  recordAudit(req, { action: 'po.submit', entity: 'PurchaseOrder', entityId: order._id, entityCode: order.code });
  res.json({ data: order, message: order.code + ' sent for approval' });
});

/**
 * Approval enforces two controls at once:
 *  - segregation of duties: the raiser cannot approve their own order
 *  - an approval limit: above it, the order must escalate to a higher role
 */
export const approvePurchaseOrder = asyncHandler(async (req, res) => {
  const order = await PurchaseOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Purchase order not found');
  if (order.status !== 'PENDING_APPROVAL') {
    throw ApiError.badRequest('Only an order pending approval can be approved');
  }
  if (String(order.submittedBy) === String(req.user._id) || String(order.createdBy) === String(req.user._id)) {
    throw ApiError.forbidden(
      'Segregation of duties: you raised ' + order.code + ', so someone else must approve it'
    );
  }

  const limit = approvalLimitFor(req.user.role);
  if (order.grandTotal > limit) {
    throw ApiError.forbidden(
      'Approval limit exceeded: ' + order.code + ' is Rs. ' + order.grandTotal.toLocaleString() +
        ' but your approval limit is Rs. ' + (limit === Infinity ? 'unlimited' : limit.toLocaleString()) +
        '. This must be approved by a higher authority.'
    );
  }

  order.status = 'APPROVED';
  order.approvedBy = req.user._id;
  order.approvedAt = new Date();
  await order.save();

  recordAudit(req, {
    action: 'po.approve',
    entity: 'PurchaseOrder',
    entityId: order._id,
    entityCode: order.code,
    detail: 'Rs. ' + order.grandTotal + ' approved within a limit of ' + limit,
  });
  res.json({ data: order, message: order.code + ' approved - the warehouse can now receive against it' });
});

export const rejectPurchaseOrder = asyncHandler(async (req, res) => {
  const order = await PurchaseOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Purchase order not found');
  if (order.status !== 'PENDING_APPROVAL') throw ApiError.badRequest('Only a pending order can be rejected');

  order.status = 'DRAFT';
  order.rejectionReason = req.body.reason || 'No reason supplied';
  await order.save();
  recordAudit(req, {
    action: 'po.reject',
    entity: 'PurchaseOrder',
    entityId: order._id,
    entityCode: order.code,
    detail: order.rejectionReason,
  });
  res.json({ data: order, message: 'Sent back to the buyer as a draft' });
});

export const cancelPurchaseOrder = asyncHandler(async (req, res) => {
  const order = await PurchaseOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Purchase order not found');
  if (['RECEIVED', 'CLOSED'].includes(order.status)) {
    throw ApiError.badRequest('A fully received order cannot be cancelled');
  }
  const received = order.lines.some((l) => l.receivedQty > 0);
  if (received) throw ApiError.badRequest('Goods have already been received against ' + order.code);

  order.status = 'CANCELLED';
  order.cancelledAt = new Date();
  await order.save();
  recordAudit(req, { action: 'po.cancel', entity: 'PurchaseOrder', entityId: order._id, entityCode: order.code });
  res.json({ data: order });
});

export const closePurchaseOrder = asyncHandler(async (req, res) => {
  const order = await PurchaseOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Purchase order not found');
  if (!['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(order.status)) {
    throw ApiError.badRequest('Order ' + order.code + ' is ' + order.status + ' and cannot be closed');
  }
  order.status = 'CLOSED';
  order.closedAt = new Date();
  await order.save();
  recordAudit(req, {
    action: 'po.close',
    entity: 'PurchaseOrder',
    entityId: order._id,
    entityCode: order.code,
    detail: 'Short-closed by ' + req.user.name,
  });
  res.json({ data: order, message: order.code + ' closed' });
});

/* ========================================================================== */
/* Goods receipt notes                                                        */
/* ========================================================================== */

export const grnSchema = z.object({
  purchaseOrder: z.string().min(1, 'A goods receipt must be against a purchase order'),
  date: z.coerce.date().optional(),
  location: z.string().optional(),
  deliveryNote: z.string().optional().default(''),
  vehicleNo: z.string().optional().default(''),
  remarks: z.string().optional().default(''),
  lines: z
    .array(
      z.object({
        materialCode: z.string(),
        receivedQty: z.coerce.number().min(0),
        rejectedQty: z.coerce.number().min(0).default(0),
        qcStatus: z.enum(['PENDING', 'PASSED', 'FAILED', 'PARTIAL']).default('PASSED'),
        batchNo: z.string().optional().default(''),
        expiryDate: z.coerce.date().optional(),
        remarks: z.string().optional().default(''),
      })
    )
    .min(1, 'Nothing to receive'),
});

export const listGrns = asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.purchaseOrder) q.purchaseOrder = req.query.purchaseOrder;
  if (req.query.matched === 'false') q.matched = false;
  if (req.query.search) {
    q.$or = [{ code: new RegExp(req.query.search, 'i') }, { supplierName: new RegExp(req.query.search, 'i') }];
  }

  const grns = await Grn.find(q).populate('receivedBy', 'name role').sort({ createdAt: -1 }).lean();
  res.json({
    data: grns,
    summary: {
      count: grns.length,
      posted: grns.filter((g) => g.status === 'POSTED').length,
      awaitingInvoice: grns.filter((g) => g.status === 'POSTED' && !g.matched).length,
      value: round2(sum(grns.filter((g) => g.status === 'POSTED'), (g) => g.totalValue)),
    },
  });
});

export const getGrn = asyncHandler(async (req, res) => {
  const grn = await Grn.findById(req.params.id)
    .populate('purchaseOrder', 'code supplierName grandTotal status')
    .populate('receivedBy', 'name role')
    .populate('journalEntry')
    .populate('invoice', 'code grandTotal status');
  if (!grn) throw ApiError.notFound('Goods receipt not found');
  res.json({ data: grn });
});

/**
 * Receives goods against an approved purchase order.
 *
 * Posts stock and  Dr Inventory / Cr Goods Received Not Invoiced.  The
 * supplier liability stays in GRNI until Finance matches the invoice, which is
 * what lets the three-way match (PO / GRN / invoice) actually mean something.
 */
export const createGrn = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.body.purchaseOrder);
  if (!po) throw ApiError.notFound('Purchase order not found');
  if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
    throw ApiError.badRequest(
      'Cannot receive against ' + po.code + ' - it is ' + po.status +
        '. Only an approved order that is not yet fully received can take a goods receipt.'
    );
  }

  const date = req.body.date || new Date();
  await assertPeriodOpen(date, 'this goods receipt');

  const byCode = new Map(req.body.lines.map((l) => [l.materialCode, l]));
  const grnLines = [];

  for (const poLine of po.lines) {
    const input = byCode.get(poLine.materialCode);
    if (!input) continue;

    const receivedQty = round3(Number(input.receivedQty) || 0);
    const rejectedQty = round3(Number(input.rejectedQty) || 0);
    if (receivedQty <= 0) continue;

    const acceptedQty = round3(receivedQty - rejectedQty);
    if (acceptedQty < 0) {
      throw ApiError.badRequest(
        poLine.materialName + ': rejected quantity cannot exceed what was received'
      );
    }

    // over-receipt tolerance: 5% above the ordered quantity
    const outstanding = round3(poLine.qty - poLine.receivedQty);
    const tolerance = round3(outstanding * 1.05);
    if (receivedQty > tolerance + 0.0001) {
      throw ApiError.badRequest(
        poLine.materialName + ': receiving ' + receivedQty + ' ' + poLine.uom +
          ' but only ' + outstanding + ' ' + poLine.uom + ' is outstanding on ' + po.code +
          ' (5% over-receipt tolerance allowed)'
      );
    }

    grnLines.push({
      material: poLine.material,
      materialCode: poLine.materialCode,
      materialName: poLine.materialName,
      uom: poLine.uom,
      orderedQty: poLine.qty,
      previouslyReceived: poLine.receivedQty,
      receivedQty,
      acceptedQty,
      rejectedQty,
      rate: poLine.rate,
      value: round2(acceptedQty * poLine.rate),
      qcStatus: input.qcStatus || 'PASSED',
      batchNo: input.batchNo || '',
      expiryDate: input.expiryDate,
      remarks: input.remarks || '',
    });
  }

  if (!grnLines.length) throw ApiError.badRequest('No lines with a received quantity');

  const code = await nextCode('GRN');
  const totalValue = round2(sum(grnLines, (l) => l.value));

  const grn = await Grn.create({
    code,
    purchaseOrder: po._id,
    purchaseOrderCode: po.code,
    supplier: po.supplier,
    supplierName: po.supplierName,
    date,
    location: req.body.location || po.deliveryLocation,
    deliveryNote: req.body.deliveryNote,
    vehicleNo: req.body.vehicleNo,
    remarks: req.body.remarks,
    lines: grnLines,
    totalValue,
    totalAccepted: round3(sum(grnLines, (l) => l.acceptedQty)),
    totalRejected: round3(sum(grnLines, (l) => l.rejectedQty)),
    status: 'DRAFT',
    receivedBy: req.user._id,
  });

  // ---- stock: only ACCEPTED quantity enters inventory ---------------------
  for (const line of grnLines) {
    if (line.acceptedQty <= 0) continue;
    await postMovement({
      material: line.material,
      type: 'PURCHASE_RECEIPT',
      qty: line.acceptedQty,
      rate: line.rate,
      location: grn.location,
      refType: 'Grn',
      refId: grn._id,
      refCode: grn.code,
      remarks: 'Received against ' + po.code,
      date,
      userId: req.user._id,
    });
  }

  // ---- ledger: liability parks in GRNI until the invoice arrives ----------
  const je = await postJournal({
    date,
    narration: 'Goods received ' + grn.code + ' against ' + po.code + ' from ' + po.supplierName,
    rawLines: [
      { code: ACC.RAW_MATERIAL, debit: totalValue, description: 'Materials received into ' + grn.location },
      { code: ACC.GRNI, credit: totalValue, description: 'Goods received not invoiced - ' + po.supplierName },
    ],
    refType: 'Grn',
    refId: grn._id,
    refCode: grn.code,
    userId: req.user._id,
  });

  grn.status = 'POSTED';
  grn.postedAt = new Date();
  grn.journalEntry = je._id;
  await grn.save();

  // ---- roll the receipt back onto the purchase order ----------------------
  for (const line of grnLines) {
    const poLine = po.lines.find((l) => l.materialCode === line.materialCode);
    if (poLine) poLine.receivedQty = round3(poLine.receivedQty + line.acceptedQty);
  }
  po.status = po.receiptState();
  await po.save();

  recordAudit(req, {
    action: 'grn.post',
    entity: 'Grn',
    entityId: grn._id,
    entityCode: grn.code,
    detail: 'Rs. ' + totalValue + ' received against ' + po.code + '; ' + po.code + ' is now ' + po.status,
  });

  res.status(201).json({ data: grn, journalEntry: je, purchaseOrder: po });
});

/* ========================================================================== */
/* Three-way match                                                            */
/* ========================================================================== */

/**
 * Compares purchase order, goods receipt and supplier invoice.
 * Finance uses this before releasing a payment.
 */
export const threeWayMatch = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id).lean();
  if (!po) throw ApiError.notFound('Purchase order not found');

  const receipts = await Grn.find({ purchaseOrder: po._id, status: 'POSTED' }).lean();
  const { Invoice } = await import('../models/Invoice.js');
  const invoices = await Invoice.find({ purchaseOrder: po._id, status: 'POSTED' }).lean();

  const rows = po.lines.map((l) => {
    const receivedQty = round3(
      receipts.reduce(
        (s, g) => s + (g.lines.find((x) => x.materialCode === l.materialCode)?.acceptedQty || 0),
        0
      )
    );
    const invoicedQty = round3(
      invoices.reduce(
        (s, i) => s + (i.lines.find((x) => x.materialCode === l.materialCode)?.qty || 0),
        0
      )
    );
    const invoicedValue = round2(
      invoices.reduce(
        (s, i) => s + (i.lines.find((x) => x.materialCode === l.materialCode)?.amount || 0),
        0
      )
    );

    const qtyMatched = Math.abs(receivedQty - invoicedQty) < 0.001;
    const priceMatched = Math.abs(round2(receivedQty * l.rate) - invoicedValue) < 0.5 || invoicedQty === 0;

    return {
      materialCode: l.materialCode,
      materialName: l.materialName,
      uom: l.uom,
      orderedQty: l.qty,
      receivedQty,
      invoicedQty,
      orderedRate: l.rate,
      orderedValue: l.amount,
      receivedValue: round2(receivedQty * l.rate),
      invoicedValue,
      qtyVariance: round3(receivedQty - l.qty),
      valueVariance: round2(invoicedValue - round2(receivedQty * l.rate)),
      status:
        invoicedQty === 0
          ? 'AWAITING_INVOICE'
          : qtyMatched && priceMatched
            ? 'MATCHED'
            : 'EXCEPTION',
    };
  });

  const exceptions = rows.filter((r) => r.status === 'EXCEPTION');

  res.json({
    data: {
      purchaseOrder: {
        code: po.code,
        supplierName: po.supplierName,
        status: po.status,
        subtotal: po.subtotal,
        grandTotal: po.grandTotal,
      },
      receipts: receipts.map((g) => ({ code: g.code, date: g.date, totalValue: g.totalValue, matched: g.matched })),
      invoices: invoices.map((i) => ({ code: i.code, date: i.date, subtotal: i.subtotal, grandTotal: i.grandTotal })),
      rows,
      verdict: exceptions.length ? 'EXCEPTION' : rows.every((r) => r.status === 'MATCHED') ? 'MATCHED' : 'AWAITING_INVOICE',
      exceptionCount: exceptions.length,
    },
  });
});

/* ========================================================================== */
/* RFQ                                                                        */
/* ========================================================================== */

export const rfqSchema = z.object({
  title: z.string().optional().default(''),
  closingDate: z.coerce.date().optional(),
  suppliers: z.array(z.string()).default([]),
  remarks: z.string().optional().default(''),
  lines: z
    .array(
      z.object({
        material: z.string().min(1),
        qty: z.coerce.number().gt(0),
      })
    )
    .min(1, 'Add at least one line'),
});

export const quoteSchema = z.object({
  materialCode: z.string(),
  supplier: z.string().min(1),
  rate: z.coerce.number().min(0),
  leadTimeDays: z.coerce.number().min(0).default(0),
  remarks: z.string().optional().default(''),
});

export const listRfqs = asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  const rfqs = await Rfq.find(q).populate('createdBy', 'name role').sort({ createdAt: -1 }).lean();
  res.json({ data: rfqs });
});

export const createRfq = asyncHandler(async (req, res) => {
  const materials = await Material.find({ _id: { $in: req.body.lines.map((l) => l.material) } });
  const map = new Map(materials.map((m) => [String(m._id), m]));
  const suppliers = await Party.find({ _id: { $in: req.body.suppliers }, type: 'SUPPLIER' });

  const code = await nextCode('RFQ');
  const rfq = await Rfq.create({
    code,
    title: req.body.title,
    closingDate: req.body.closingDate,
    suppliers: suppliers.map((s) => s._id),
    remarks: req.body.remarks,
    lines: req.body.lines.map((l) => {
      const m = map.get(String(l.material));
      if (!m) throw ApiError.badRequest('Material ' + l.material + ' does not exist');
      return {
        material: m._id,
        materialCode: m.code,
        materialName: m.name,
        uom: m.uom,
        qty: round3(l.qty),
        quotes: [],
      };
    }),
    status: 'OPEN',
    createdBy: req.user._id,
  });

  recordAudit(req, { action: 'rfq.create', entity: 'Rfq', entityId: rfq._id, entityCode: rfq.code });
  res.status(201).json({ data: rfq });
});

export const recordQuote = asyncHandler(async (req, res) => {
  const rfq = await Rfq.findById(req.params.id);
  if (!rfq) throw ApiError.notFound('RFQ not found');
  if (rfq.status !== 'OPEN') throw ApiError.badRequest('This RFQ is ' + rfq.status);

  const supplier = await Party.findById(req.body.supplier);
  if (!supplier) throw ApiError.notFound('Supplier not found');

  const line = rfq.lines.find((l) => l.materialCode === req.body.materialCode);
  if (!line) throw ApiError.badRequest('No line for ' + req.body.materialCode + ' on this RFQ');

  const existing = line.quotes.findIndex((q) => String(q.supplier) === String(supplier._id));
  const quote = {
    supplier: supplier._id,
    supplierName: supplier.name,
    rate: round2(req.body.rate),
    leadTimeDays: req.body.leadTimeDays,
    remarks: req.body.remarks || '',
    receivedAt: new Date(),
  };
  if (existing >= 0) line.quotes[existing] = quote;
  else line.quotes.push(quote);

  await rfq.save();
  res.json({ data: rfq });
});

/** Turns the winning quotes into a draft purchase order. */
export const awardRfq = asyncHandler(async (req, res) => {
  const rfq = await Rfq.findById(req.params.id);
  if (!rfq) throw ApiError.notFound('RFQ not found');
  if (rfq.status === 'AWARDED') throw ApiError.badRequest('This RFQ has already been awarded');

  const supplierId = req.body.supplier;
  const supplier = await Party.findById(supplierId);
  if (!supplier) throw ApiError.notFound('Supplier not found');

  const lines = [];
  for (const line of rfq.lines) {
    const quote = line.quotes.find((q) => String(q.supplier) === String(supplierId));
    if (!quote) continue;
    lines.push({ material: line.material, qty: line.qty, rate: quote.rate });
  }
  if (!lines.length) throw ApiError.badRequest(supplier.name + ' has not quoted on any line of this RFQ');

  const settings = await getSettings();
  const totals = await priceLines(lines, settings.defaultSalesTaxRate);
  const code = await nextCode('PO-P');

  const po = await PurchaseOrder.create({
    code,
    supplier: supplier._id,
    supplierName: supplier.name,
    date: new Date(),
    reference: 'Awarded from ' + rfq.code,
    rfq: rfq._id,
    ...totals,
    status: 'DRAFT',
    createdBy: req.user._id,
  });

  rfq.status = 'AWARDED';
  rfq.awardedTo = supplier._id;
  rfq.awardedPurchaseOrder = po._id;
  await rfq.save();

  recordAudit(req, {
    action: 'rfq.award',
    entity: 'Rfq',
    entityId: rfq._id,
    entityCode: rfq.code,
    detail: 'Awarded to ' + supplier.name + ', raised ' + po.code,
  });
  res.json({ data: rfq, purchaseOrder: po, message: 'Awarded to ' + supplier.name + ' - draft ' + po.code + ' raised' });
});
