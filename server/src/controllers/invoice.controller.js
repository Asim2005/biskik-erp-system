import { z } from 'zod';
import { Invoice } from '../models/Invoice.js';
import { Party } from '../models/Party.js';
import { Material } from '../models/Material.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';
import { nextCode } from '../utils/numbering.js';
import { postMovement, valuationRate } from '../services/inventory.js';
import { ACC, postJournal } from '../services/accounting.js';
import { Grn } from '../models/Grn.js';
import { PurchaseOrder } from '../models/PurchaseOrder.js';
import { assertPeriodOpen } from '../services/periods.js';
import { getSettings } from '../models/Setting.js';
import { round2, round3, sum } from '../utils/money.js';

export const invoiceSchema = z.object({
  kind: z.enum(['SALES', 'PURCHASE']),
  party: z.string().min(1, 'Select a party'),
  date: z.coerce.date().optional(),
  reference: z.string().optional().default(''),
  purchaseOrder: z.string().optional().nullable(),
  remarks: z.string().optional().default(''),
  lines: z
    .array(
      z.object({
        material: z.string().min(1),
        qty: z.coerce.number().gt(0, 'Quantity must be greater than zero'),
        rate: z.coerce.number().min(0),
        discountPercent: z.coerce.number().min(0).max(100).default(0),
        taxRate: z.coerce.number().min(0).max(100).optional(),
      })
    )
    .min(1, 'Add at least one line'),
});

/** Prices each line and rolls the invoice up. */
async function buildLines(rawLines, defaultTaxRate) {
  const materials = await Material.find({ _id: { $in: rawLines.map((l) => l.material) } });
  const map = new Map(materials.map((m) => [String(m._id), m]));

  const lines = rawLines.map((l) => {
    const m = map.get(String(l.material));
    if (!m) throw ApiError.badRequest('Material ' + l.material + ' does not exist');
    const gross = l.qty * l.rate;
    const discount = round2((gross * (l.discountPercent || 0)) / 100);
    const amount = round2(gross - discount);
    const taxRate = l.taxRate ?? m.taxRate ?? defaultTaxRate;
    const taxAmount = round2((amount * taxRate) / 100);
    return {
      material: m._id,
      materialCode: m.code,
      materialName: m.name,
      uom: m.uom,
      qty: round3(l.qty),
      rate: round2(l.rate),
      discountPercent: l.discountPercent || 0,
      amount,
      taxRate,
      taxAmount,
      lineTotal: round2(amount + taxAmount),
      __discount: discount,
    };
  });

  return {
    lines: lines.map(({ __discount, ...rest }) => rest),
    subtotal: round2(sum(lines, (l) => l.amount)),
    discountTotal: round2(sum(lines, (l) => l.__discount)),
    taxTotal: round2(sum(lines, (l) => l.taxAmount)),
    grandTotal: round2(sum(lines, (l) => l.lineTotal)),
  };
}

export const listInvoices = asyncHandler(async (req, res) => {
  const { kind, status, period, party, search } = req.query;
  const q = {};
  if (kind) q.kind = kind;
  if (status) q.status = status;
  if (period) q.period = period;
  if (party) q.party = party;
  if (search) q.$or = [{ code: new RegExp(search, 'i') }, { partyName: new RegExp(search, 'i') }, { reference: new RegExp(search, 'i') }];

  const invoices = await Invoice.find(q).populate('party', 'name code ntn').sort({ date: -1, createdAt: -1 }).lean();
  res.json({
    data: invoices,
    summary: {
      count: invoices.length,
      total: round2(sum(invoices, (i) => i.grandTotal)),
      tax: round2(sum(invoices, (i) => i.taxTotal)),
    },
  });
});

export const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id)
    .populate('party')
    .populate('journalEntry')
    .populate('createdBy', 'name role');
  if (!invoice) throw ApiError.notFound('Invoice not found');
  res.json({ data: invoice });
});

export const createInvoice = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const party = await Party.findById(req.body.party);
  if (!party) throw ApiError.notFound('Party not found');

  const expectedType = req.body.kind === 'SALES' ? 'CUSTOMER' : 'SUPPLIER';
  if (party.type !== expectedType) {
    throw ApiError.badRequest('A ' + req.body.kind.toLowerCase() + ' invoice needs a ' + expectedType.toLowerCase());
  }

  const totals = await buildLines(req.body.lines, settings.defaultSalesTaxRate);
  const code = await nextCode(req.body.kind === 'SALES' ? 'INV' : 'PINV');

  // A purchase invoice may settle a purchase order, which switches posting to
  // the three-way-match path (clear GRNI) instead of debiting inventory again.
  let po = null;
  if (req.body.purchaseOrder) {
    po = await PurchaseOrder.findById(req.body.purchaseOrder);
    if (!po) throw ApiError.notFound('Purchase order not found');
    if (String(po.supplier) !== String(party._id)) {
      throw ApiError.badRequest('Purchase order ' + po.code + ' belongs to a different supplier');
    }
  }

  const invoice = await Invoice.create({
    code,
    kind: req.body.kind,
    party: party._id,
    partyName: party.name,
    date: req.body.date || new Date(),
    reference: req.body.reference,
    purchaseOrder: po?._id,
    purchaseOrderCode: po?.code,
    remarks: req.body.remarks,
    ...totals,
    status: 'DRAFT',
    createdBy: req.user._id,
  });

  recordAudit(req, {
    action: 'invoice.create',
    entity: 'Invoice',
    entityId: invoice._id,
    entityCode: invoice.code,
    detail: invoice.kind + ' ' + party.name + ' Rs. ' + invoice.grandTotal,
  });
  res.status(201).json({ data: invoice });
});

export const updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice not found');
  if (invoice.status !== 'DRAFT') throw ApiError.badRequest('Only a draft invoice can be edited');

  const settings = await getSettings();
  const totals = await buildLines(req.body.lines, settings.defaultSalesTaxRate);
  Object.assign(invoice, {
    date: req.body.date || invoice.date,
    reference: req.body.reference ?? invoice.reference,
    remarks: req.body.remarks ?? invoice.remarks,
    ...totals,
  });
  await invoice.save();
  res.json({ data: invoice });
});

/**
 * Posting an invoice moves stock and writes the GL entry.
 *
 * SALES     Dr Receivable / Cr Sales / Cr Output tax   +   Dr COGS / Cr Finished goods
 * PURCHASE  Dr Inventory  / Dr Input tax / Cr Payable
 *
 * COGS is always the moving-average value actually relieved from stock, so the
 * GL and the stock ledger cannot disagree.
 */
export const postInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate('party');
  if (!invoice) throw ApiError.notFound('Invoice not found');
  if (invoice.status === 'POSTED') throw ApiError.badRequest('Invoice ' + invoice.code + ' is already posted');
  if (invoice.status === 'CANCELLED') throw ApiError.badRequest('A cancelled invoice cannot be posted');

  const date = invoice.date;
  await assertPeriodOpen(date, 'invoice ' + invoice.code);
  let je;

  if (invoice.kind === 'SALES') {
    let cogs = 0;
    for (const line of invoice.lines) {
      const mat = await Material.findById(line.material);
      const location = mat?.category === 'FINISHED' ? 'Finished Goods' : undefined;
      const { value } = await postMovement({
        material: line.material,
        type: 'SALE_ISSUE',
        qty: line.qty,
        location,
        refType: 'Invoice',
        refId: invoice._id,
        refCode: invoice.code,
        remarks: 'Sold to ' + invoice.partyName,
        date,
        userId: req.user._id,
      });
      cogs = round2(cogs + value);
    }

    invoice.cogsAmount = cogs;
    invoice.grossProfit = round2(invoice.subtotal - cogs);

    je = await postJournal({
      date,
      narration: 'Sales invoice ' + invoice.code + ' to ' + invoice.partyName,
      rawLines: [
        { code: ACC.RECEIVABLE, debit: invoice.grandTotal, description: invoice.partyName },
        { code: ACC.SALES, credit: invoice.subtotal, description: 'Revenue - ' + invoice.code },
        { code: ACC.OUTPUT_TAX, credit: invoice.taxTotal, description: 'Output sales tax' },
        { code: ACC.COGS, debit: cogs, description: 'Cost of goods sold - ' + invoice.code },
        { code: ACC.FINISHED_GOODS, credit: cogs, description: 'Finished goods relieved' },
      ],
      refType: 'Invoice',
      refId: invoice._id,
      refCode: invoice.code,
      userId: req.user._id,
    });

    invoice.party.balance = round2((invoice.party.balance || 0) + invoice.grandTotal);
    await invoice.party.save();
  } else if (invoice.purchaseOrder) {
    /*
     * Three-way match path.
     *
     * The warehouse already received these goods on a GRN, which put the stock
     * on hand and parked the liability in Goods Received Not Invoiced. The
     * invoice does NOT receive stock again - it clears GRNI into the supplier
     * payable and books the recoverable input tax.
     */
    const openGrns = await Grn.find({
      purchaseOrder: invoice.purchaseOrder,
      status: 'POSTED',
      matched: false,
    });

    const grniValue = round2(sum(openGrns, (g) => g.totalValue));
    const priceVariance = round2(invoice.subtotal - grniValue);

    const rawLines = [
      { code: ACC.GRNI, debit: grniValue, description: 'Clearing goods received not invoiced' },
      { code: ACC.INPUT_TAX, debit: invoice.taxTotal, description: 'Recoverable input sales tax' },
      { code: ACC.PAYABLE, credit: invoice.grandTotal, description: invoice.partyName },
    ];

    // The supplier billed something other than the received value: the
    // difference is a purchase price variance, not a silent adjustment.
    if (Math.abs(priceVariance) >= 0.01) {
      rawLines.push(
        priceVariance > 0
          ? { code: ACC.MATERIAL_PRICE_VARIANCE, debit: priceVariance, description: 'Invoice above receipt value (adverse)' }
          : { code: ACC.MATERIAL_PRICE_VARIANCE, credit: -priceVariance, description: 'Invoice below receipt value (favourable)' }
      );
    }

    je = await postJournal({
      date,
      narration:
        'Purchase invoice ' + invoice.code + ' from ' + invoice.partyName +
        ' matched to ' + invoice.purchaseOrderCode,
      rawLines,
      refType: 'Invoice',
      refId: invoice._id,
      refCode: invoice.code,
      userId: req.user._id,
    });

    for (const g of openGrns) {
      g.matched = true;
      g.invoice = invoice._id;
      await g.save();
    }

    invoice.grns = openGrns.map((g) => g._id);
    invoice.matchVariance = priceVariance;
    invoice.matchStatus = Math.abs(priceVariance) < 0.01 ? 'MATCHED' : 'EXCEPTION';

    invoice.party.balance = round2((invoice.party.balance || 0) + invoice.grandTotal);
    await invoice.party.save();
  } else {
    /* Direct purchase with no order behind it - the invoice itself brings the
       stock in, so it debits inventory directly. */
    for (const line of invoice.lines) {
      await postMovement({
        material: line.material,
        type: 'PURCHASE_RECEIPT',
        qty: line.qty,
        rate: line.amount / line.qty,
        refType: 'Invoice',
        refId: invoice._id,
        refCode: invoice.code,
        remarks: 'Purchased from ' + invoice.partyName,
        date,
        userId: req.user._id,
      });
    }

    je = await postJournal({
      date,
      narration: 'Purchase invoice ' + invoice.code + ' from ' + invoice.partyName,
      rawLines: [
        { code: ACC.RAW_MATERIAL, debit: invoice.subtotal, description: 'Materials received - ' + invoice.code },
        { code: ACC.INPUT_TAX, debit: invoice.taxTotal, description: 'Recoverable input sales tax' },
        { code: ACC.PAYABLE, credit: invoice.grandTotal, description: invoice.partyName },
      ],
      refType: 'Invoice',
      refId: invoice._id,
      refCode: invoice.code,
      userId: req.user._id,
    });

    invoice.party.balance = round2((invoice.party.balance || 0) + invoice.grandTotal);
    await invoice.party.save();
  }

  invoice.status = 'POSTED';
  invoice.postedAt = new Date();
  invoice.journalEntry = je._id;
  await invoice.save();

  recordAudit(req, {
    action: 'invoice.post',
    entity: 'Invoice',
    entityId: invoice._id,
    entityCode: invoice.code,
    detail: 'Posted via ' + je.code + ' for Rs. ' + invoice.grandTotal,
  });

  res.json({ data: invoice, journalEntry: je });
});

export const cancelInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice not found');
  if (invoice.status === 'POSTED') {
    throw ApiError.badRequest('A posted invoice cannot be cancelled - reverse its journal entry instead');
  }
  invoice.status = 'CANCELLED';
  await invoice.save();
  recordAudit(req, { action: 'invoice.cancel', entity: 'Invoice', entityId: invoice._id, entityCode: invoice.code });
  res.json({ data: invoice });
});
