import { z } from 'zod';
import { Stock } from '../models/Stock.js';
import { StockMovement, MOVEMENT_TYPES } from '../models/StockMovement.js';
import { Material } from '../models/Material.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';
import { postMovement, valuationReport } from '../services/inventory.js';
import { ACC, postJournal } from '../services/accounting.js';
import { assertPeriodOpen } from '../services/periods.js';
import { round2 } from '../utils/money.js';

export const adjustSchema = z.object({
  material: z.string().min(1),
  direction: z.enum(['IN', 'OUT']),
  qty: z.coerce.number().gt(0, 'Quantity must be greater than zero'),
  rate: z.coerce.number().min(0).optional(),
  location: z.string().optional(),
  reason: z.string().min(3, 'Give a reason for the adjustment'),
  date: z.coerce.date().optional(),
});

export const receiptSchema = z.object({
  material: z.string().min(1),
  qty: z.coerce.number().gt(0),
  rate: z.coerce.number().min(0),
  location: z.string().optional(),
  reference: z.string().optional().default(''),
  date: z.coerce.date().optional(),
});

export const getValuation = asyncHandler(async (req, res) => {
  const rows = await valuationReport({ category: req.query.category, location: req.query.location });
  const byCategory = rows.reduce((acc, r) => {
    acc[r.category] = round2((acc[r.category] || 0) + r.value);
    return acc;
  }, {});

  res.json({
    data: rows,
    summary: {
      totalValue: round2(rows.reduce((s, r) => s + r.value, 0)),
      lineCount: rows.length,
      belowReorder: rows.filter((r) => r.belowReorder).length,
      byCategory,
    },
  });
});

export const getMovements = asyncHandler(async (req, res) => {
  const { material, type, from, to, limit } = req.query;
  const q = {};
  if (material) q.material = material;
  if (type) q.type = type;
  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = new Date(from);
    if (to) q.date.$lte = new Date(to);
  }

  const movements = await StockMovement.find(q)
    .populate('material', 'code name uom category')
    .populate('createdBy', 'name')
    .sort({ date: -1, createdAt: -1 })
    .limit(Number(limit) || 500)
    .lean();

  res.json({ data: movements, meta: { types: MOVEMENT_TYPES } });
});

/** Manual stock adjustment - always paired with a GL entry so books stay tied. */
export const adjustStock = asyncHandler(async (req, res) => {
  const { material, direction, qty, rate, location, reason, date } = req.body;
  const mat = await Material.findById(material);
  if (!mat) throw ApiError.notFound('Material not found');
  await assertPeriodOpen(date, 'this stock adjustment');

  const { value, valuedRate } = await postMovement({
    material: mat,
    type: direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
    qty,
    rate: rate ?? mat.movingAvgRate ?? mat.standardRate,
    location,
    refType: 'Adjustment',
    refCode: 'ADJ',
    remarks: reason,
    date,
    userId: req.user._id,
  });

  const inventoryAccount = mat.category === 'FINISHED' ? ACC.FINISHED_GOODS : ACC.RAW_MATERIAL;
  const je = await postJournal({
    date,
    narration: 'Stock adjustment (' + direction + ') for ' + mat.name + ' - ' + reason,
    rawLines:
      direction === 'IN'
        ? [
            { code: inventoryAccount, debit: value, description: reason },
            { code: ACC.YIELD_LOSS, credit: value, description: 'Adjustment gain' },
          ]
        : [
            { code: ACC.YIELD_LOSS, debit: value, description: 'Adjustment loss - ' + reason },
            { code: inventoryAccount, credit: value, description: reason },
          ],
    refType: 'Adjustment',
    userId: req.user._id,
  });

  recordAudit(req, {
    action: 'inventory.adjust',
    entity: 'Material',
    entityId: mat._id,
    entityCode: mat.code,
    detail: direction + ' ' + qty + ' ' + mat.uom + ' at Rs. ' + valuedRate + ' - ' + reason,
  });

  res.json({ message: 'Stock adjusted', value, journalEntry: je });
});

/** Direct goods receipt without a purchase invoice (opening stock, returns). */
export const receiveStock = asyncHandler(async (req, res) => {
  const { material, qty, rate, location, reference, date } = req.body;
  const mat = await Material.findById(material);
  if (!mat) throw ApiError.notFound('Material not found');
  await assertPeriodOpen(date, 'this goods receipt');

  const { value } = await postMovement({
    material: mat,
    type: 'PURCHASE_RECEIPT',
    qty,
    rate,
    location,
    refType: 'GoodsReceipt',
    refCode: reference,
    remarks: 'Goods receipt ' + (reference || ''),
    date,
    userId: req.user._id,
  });

  const je = await postJournal({
    date,
    narration: 'Goods received - ' + mat.name + ' ' + qty + ' ' + mat.uom,
    rawLines: [
      { code: mat.category === 'FINISHED' ? ACC.FINISHED_GOODS : ACC.RAW_MATERIAL, debit: value, description: reference },
      { code: ACC.PAYABLE, credit: value, description: 'Supplier payable' },
    ],
    refType: 'GoodsReceipt',
    userId: req.user._id,
  });

  recordAudit(req, {
    action: 'inventory.receive',
    entity: 'Material',
    entityId: mat._id,
    entityCode: mat.code,
    detail: qty + ' ' + mat.uom + ' at Rs. ' + rate,
  });

  res.json({ message: 'Stock received', value, journalEntry: je });
});

/** Materials at or below their reorder level. */
export const lowStock = asyncHandler(async (_req, res) => {
  const rows = await valuationReport();
  const low = rows.filter((r) => r.reorderLevel > 0 && r.qty <= r.reorderLevel);
  const materials = await Material.find({ isActive: true, reorderLevel: { $gt: 0 } }).lean();
  const stocked = new Set(rows.map((r) => String(r.materialId)));
  const zero = materials
    .filter((m) => !stocked.has(String(m._id)))
    .map((m) => ({
      materialId: m._id,
      code: m.code,
      name: m.name,
      category: m.category,
      uom: m.uom,
      location: m.defaultLocation,
      qty: 0,
      avgRate: m.standardRate,
      value: 0,
      reorderLevel: m.reorderLevel,
      belowReorder: true,
    }));

  res.json({ data: [...low, ...zero].sort((a, b) => a.qty - b.qty) });
});
