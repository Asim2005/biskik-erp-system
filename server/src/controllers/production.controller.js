import { z } from 'zod';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { Recipe } from '../models/Recipe.js';
import { Material } from '../models/Material.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';
import { nextCode } from '../utils/numbering.js';
import { explodeRecipe, recalcProductionOrder, varianceAnalysis } from '../services/costing.js';
import { postMovement, stockOnHand } from '../services/inventory.js';
import { ACC, postJournal } from '../services/accounting.js';
import { assertPeriodOpen } from '../services/periods.js';
import { round2, round3, round4, sum } from '../utils/money.js';

export const createOrderSchema = z.object({
  recipe: z.string().min(1, 'Select an approved recipe'),
  plannedQty: z.coerce.number().gt(0, 'Planned quantity must be greater than zero'),
  scheduledDate: z.coerce.date().optional(),
  shift: z.enum(['A', 'B', 'C', 'GENERAL']).default('GENERAL'),
  lineNo: z.string().default('Line-1'),
  remarks: z.string().optional().default(''),
});

export const issueSchema = z.object({
  lines: z
    .array(
      z.object({
        materialCode: z.string(),
        actualQty: z.coerce.number().min(0),
      })
    )
    .min(1, 'Nothing to issue'),
  date: z.coerce.date().optional(),
  allowNegativeStock: z.boolean().optional().default(false),
});

export const completeSchema = z.object({
  goodQty: z.coerce.number().min(0),
  rejectQty: z.coerce.number().min(0).default(0),
  actualLabourCost: z.coerce.number().min(0),
  actualOverheadCost: z.coerce.number().min(0),
  date: z.coerce.date().optional(),
  remarks: z.string().optional().default(''),
});

/* -------------------------------------------------------------------------- */

export const listOrders = asyncHandler(async (req, res) => {
  const { status, search, from, to } = req.query;
  const q = {};
  if (status) q.status = status;
  if (search) q.$or = [{ code: new RegExp(search, 'i') }, { productName: new RegExp(search, 'i') }];
  if (from || to) {
    q.scheduledDate = {};
    if (from) q.scheduledDate.$gte = new Date(from);
    if (to) q.scheduledDate.$lte = new Date(to);
  }

  const orders = await ProductionOrder.find(q)
    .populate('createdBy completedBy', 'name role')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ data: orders });
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await ProductionOrder.findById(req.params.id)
    .populate('createdBy completedBy', 'name role email')
    .populate('recipe', 'code version productName yieldPercent baseBatchQty')
    .populate('journalEntries');
  if (!order) throw ApiError.notFound('Production order not found');

  res.json({ data: order, variance: varianceAnalysis(order) });
});

export const createOrder = asyncHandler(async (req, res) => {
  const recipe = await Recipe.findById(req.body.recipe);
  if (!recipe) throw ApiError.notFound('Recipe not found');
  if (recipe.status !== 'APPROVED') {
    throw ApiError.badRequest(
      'Recipe ' + recipe.code + ' v' + recipe.version + ' is ' + recipe.status +
        '. Only an APPROVED recipe can be used for production.'
    );
  }

  const plannedQty = req.body.plannedQty;
  const { lines, scaleFactor, cost } = explodeRecipe(recipe, plannedQty);
  const code = await nextCode('PO');

  const order = new ProductionOrder({
    code,
    recipe: recipe._id,
    recipeCode: recipe.code,
    recipeVersion: recipe.version,
    product: recipe.product,
    productName: recipe.productName,
    plannedQty,
    baseBatchQty: recipe.baseBatchQty,
    scaleFactor,
    scheduledDate: req.body.scheduledDate || new Date(),
    shift: req.body.shift,
    lineNo: req.body.lineNo,
    remarks: req.body.remarks,
    status: 'DRAFT',
    lines,
    standardLabourCost: round2(cost.labourCostPerUnit * plannedQty),
    standardOverheadCost: round2(cost.factoryOverheadPerUnit * plannedQty),
    actualLabourCost: 0,
    actualOverheadCost: 0,
    createdBy: req.user._id,
  });

  recalcProductionOrder(order);
  await order.save();

  recordAudit(req, {
    action: 'production.create',
    entity: 'ProductionOrder',
    entityId: order._id,
    entityCode: order.code,
    detail: order.productName + ' x ' + plannedQty,
  });
  res.status(201).json({ data: order });
});

/** Re-scale a draft order (planned quantity change re-explodes the BOM). */
export const updateOrder = asyncHandler(async (req, res) => {
  const order = await ProductionOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Production order not found');
  if (!['DRAFT', 'RELEASED'].includes(order.status)) {
    throw ApiError.badRequest('Order ' + order.code + ' is ' + order.status + ' and can no longer be re-scaled');
  }

  const recipe = await Recipe.findById(order.recipe);
  const plannedQty = req.body.plannedQty ?? order.plannedQty;
  const { lines, scaleFactor, cost } = explodeRecipe(recipe, plannedQty);

  order.plannedQty = plannedQty;
  order.scaleFactor = scaleFactor;
  order.lines = lines;
  order.standardLabourCost = round2(cost.labourCostPerUnit * plannedQty);
  order.standardOverheadCost = round2(cost.factoryOverheadPerUnit * plannedQty);
  if (req.body.scheduledDate) order.scheduledDate = req.body.scheduledDate;
  if (req.body.shift) order.shift = req.body.shift;
  if (req.body.lineNo) order.lineNo = req.body.lineNo;
  if (req.body.remarks !== undefined) order.remarks = req.body.remarks;

  recalcProductionOrder(order);
  await order.save();

  recordAudit(req, { action: 'production.update', entity: 'ProductionOrder', entityId: order._id, entityCode: order.code });
  res.json({ data: order });
});

export const releaseOrder = asyncHandler(async (req, res) => {
  const order = await ProductionOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Production order not found');
  if (order.status !== 'DRAFT') throw ApiError.badRequest('Only a draft order can be released');

  order.status = 'RELEASED';
  await order.save();
  recordAudit(req, { action: 'production.release', entity: 'ProductionOrder', entityId: order._id, entityCode: order.code });
  res.json({ data: order, message: 'Order released to the shop floor' });
});

/**
 * Issues actual material to the floor.
 *  - relieves raw-material stock at moving average
 *  - the moving-average rate becomes the line's actual rate, so the GL and the
 *    stock ledger can never drift apart
 *  - posts  Dr WIP  /  Cr Raw Material Inventory
 */
export const issueMaterials = asyncHandler(async (req, res) => {
  const order = await ProductionOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Production order not found');
  if (!['RELEASED', 'DRAFT'].includes(order.status)) {
    throw ApiError.badRequest('Materials for ' + order.code + ' have already been issued (status ' + order.status + ')');
  }

  const byCode = new Map(req.body.lines.map((l) => [l.materialCode, l.actualQty]));
  const date = req.body.date || new Date();
  const allowNegative = req.body.allowNegativeStock === true;
  await assertPeriodOpen(date, 'the material issue for ' + order.code);

  /*
   * Pre-flight availability check.
   *
   * Stock movements are relieved line by line, and MongoDB gives us no
   * transaction here, so a shortage discovered half way through would leave
   * some stock already issued with no journal entry behind it. Verify every
   * line up front and refuse the whole issue if any of them cannot be met.
   */
  if (!allowNegative) {
    const shortages = [];
    for (const line of order.lines) {
      const qty = byCode.has(line.materialCode) ? Number(byCode.get(line.materialCode)) : line.standardQty;
      if (qty <= 0) continue;
      const onHand = await stockOnHand(line.material);
      if (onHand < qty - 0.0001) {
        shortages.push(
          line.materialName + ': need ' + round3(qty) + ' ' + line.uom + ', on hand ' + round3(onHand) + ' ' + line.uom
        );
      }
    }
    if (shortages.length) {
      throw ApiError.badRequest(
        'Not enough stock to issue ' + order.code + ' — nothing has been posted',
        shortages
      );
    }
  }

  for (const line of order.lines) {
    const actualQty = byCode.has(line.materialCode) ? Number(byCode.get(line.materialCode)) : line.standardQty;
    if (actualQty <= 0) {
      line.actualQty = 0;
      line.actualRate = line.standardRate;
      line.issued = true;
      continue;
    }

    const { valuedRate } = await postMovement({
      material: line.material,
      type: 'PRODUCTION_ISSUE',
      qty: actualQty,
      location: undefined,
      refType: 'ProductionOrder',
      refId: order._id,
      refCode: order.code,
      remarks: 'Issued to ' + order.code,
      date,
      userId: req.user._id,
      allowNegative,
    });

    line.actualQty = round3(actualQty);
    line.actualRate = round4(valuedRate);
    line.issued = true;
  }

  recalcProductionOrder(order);

  const je = await postJournal({
    date,
    narration: 'Material issued to production order ' + order.code + ' (' + order.productName + ')',
    rawLines: [
      { code: ACC.WIP, debit: order.actualMaterialCost, description: 'Material consumed - ' + order.code },
      { code: ACC.RAW_MATERIAL, credit: order.actualMaterialCost, description: 'Issued to ' + order.code },
    ],
    refType: 'ProductionOrder',
    refId: order._id,
    refCode: order.code,
    userId: req.user._id,
  });

  order.journalEntries.push(je._id);
  order.status = 'IN_PROGRESS';
  order.materialsIssuedAt = date;
  order.startedAt = order.startedAt || date;
  await order.save();

  recordAudit(req, {
    action: 'production.issue',
    entity: 'ProductionOrder',
    entityId: order._id,
    entityCode: order.code,
    detail: 'Material value Rs. ' + order.actualMaterialCost + ' posted via ' + je.code,
  });

  res.json({ data: order, journalEntry: je, variance: varianceAnalysis(order) });
});

/**
 * Completes the order.
 *  1. absorbs actual conversion cost into WIP
 *  2. receives GOOD output into finished goods at STANDARD unit cost
 *  3. clears the WIP residual to the variance accounts, so WIP nets to zero
 *
 * Debits and credits prove out arithmetically:
 *   goodQty*std + yieldLoss + allVariances  ==  actual material + labour + overhead
 */
export const completeOrder = asyncHandler(async (req, res) => {
  const order = await ProductionOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Production order not found');
  if (order.status !== 'IN_PROGRESS') {
    throw ApiError.badRequest('Issue materials before completing ' + order.code + ' (status ' + order.status + ')');
  }

  const { goodQty, rejectQty, actualLabourCost, actualOverheadCost } = req.body;
  const date = req.body.date || new Date();
  await assertPeriodOpen(date, 'the completion of ' + order.code);

  if (goodQty <= 0) throw ApiError.badRequest('Good output must be greater than zero');
  if (goodQty + rejectQty > order.plannedQty * 1.5) {
    throw ApiError.badRequest('Output of ' + (goodQty + rejectQty) + ' is more than 150% of the planned quantity - please check the figures');
  }

  order.goodQty = goodQty;
  order.rejectQty = rejectQty;
  order.actualLabourCost = round2(actualLabourCost);
  order.actualOverheadCost = round2(actualOverheadCost);
  if (req.body.remarks) order.remarks = req.body.remarks;
  recalcProductionOrder(order);

  const conversionActual = round2(order.actualLabourCost + order.actualOverheadCost);
  const journals = [];

  // 1. conversion cost into WIP
  if (conversionActual > 0) {
    const jeConv = await postJournal({
      date,
      narration: 'Conversion cost absorbed into WIP for ' + order.code,
      rawLines: [
        { code: ACC.WIP, debit: conversionActual, description: 'Labour and factory overhead - ' + order.code },
        { code: ACC.ACCRUED_PAYROLL, credit: order.actualLabourCost, description: 'Direct labour accrued' },
        { code: ACC.FACTORY_OVERHEAD, credit: order.actualOverheadCost, description: 'Factory overhead applied' },
      ],
      refType: 'ProductionOrder',
      refId: order._id,
      refCode: order.code,
      userId: req.user._id,
    });
    journals.push(jeConv);
  }

  // 2 + 3. finished goods at standard, residual to variances
  const stdUnit = order.standardUnitCost;
  const fgValue = round2(goodQty * stdUnit);
  const yieldLossUnits = Math.max(0, round3(order.plannedQty - goodQty));
  const yieldLossValue = round2(yieldLossUnits * stdUnit);

  const usageVar = round2(sum(order.lines, (l) => l.usageVarianceCost));
  const priceVar = round2(sum(order.lines, (l) => l.priceVarianceCost));
  const labourVar = round2(order.actualLabourCost - order.standardLabourCost);
  const overheadVar = round2(order.actualOverheadCost - order.standardOverheadCost);

  const wipCredit = order.actualTotalCost;

  const varLine = (code, amount, description) => {
    if (Math.abs(amount) < 0.01) return null;
    return amount > 0
      ? { code, debit: round2(amount), description: description + ' (adverse)' }
      : { code, credit: round2(-amount), description: description + ' (favourable)' };
  };

  const rawLines = [
    { code: ACC.FINISHED_GOODS, debit: fgValue, description: goodQty + ' units at standard ' + stdUnit },
    varLine(ACC.YIELD_LOSS, yieldLossValue, 'Yield loss ' + yieldLossUnits + ' units'),
    varLine(ACC.MATERIAL_USAGE_VARIANCE, usageVar, 'Material usage variance'),
    varLine(ACC.MATERIAL_PRICE_VARIANCE, priceVar, 'Material price variance'),
    varLine(ACC.LABOUR_VARIANCE, labourVar, 'Direct labour variance'),
    varLine(ACC.OVERHEAD_VARIANCE, overheadVar, 'Factory overhead variance'),
    { code: ACC.WIP, credit: wipCredit, description: 'WIP cleared for ' + order.code },
  ].filter(Boolean);

  // guard against rounding drift before mongoose rejects the entry
  const dr = rawLines.reduce((s, l) => s + (l.debit || 0), 0);
  const cr = rawLines.reduce((s, l) => s + (l.credit || 0), 0);
  const drift = round2(cr - dr);
  if (Math.abs(drift) >= 0.01) {
    rawLines.push(
      drift > 0
        ? { code: ACC.YIELD_LOSS, debit: drift, description: 'Rounding adjustment' }
        : { code: ACC.YIELD_LOSS, credit: -drift, description: 'Rounding adjustment' }
    );
  }

  const jeFg = await postJournal({
    date,
    narration: 'Production completed ' + order.code + ' - ' + goodQty + ' good units of ' + order.productName,
    rawLines,
    refType: 'ProductionOrder',
    refId: order._id,
    refCode: order.code,
    userId: req.user._id,
  });
  journals.push(jeFg);

  // finished goods into stock, valued exactly as debited to the GL
  if (order.product) {
    await postMovement({
      material: order.product,
      type: 'PRODUCTION_RECEIPT',
      qty: goodQty,
      rate: stdUnit,
      location: 'Finished Goods',
      refType: 'ProductionOrder',
      refId: order._id,
      refCode: order.code,
      remarks: 'Output of ' + order.code,
      date,
      userId: req.user._id,
    });
    if (rejectQty > 0) {
      const rejectMaterial = await Material.findById(order.product);
      if (rejectMaterial) {
        recordAudit(req, {
          action: 'production.reject',
          entity: 'ProductionOrder',
          entityId: order._id,
          entityCode: order.code,
          detail: rejectQty + ' units rejected and scrapped (not capitalised)',
        });
      }
    }
  }

  order.status = 'COMPLETED';
  order.completedAt = date;
  order.completedBy = req.user._id;
  journals.forEach((j) => order.journalEntries.push(j._id));
  await order.save();

  recordAudit(req, {
    action: 'production.complete',
    entity: 'ProductionOrder',
    entityId: order._id,
    entityCode: order.code,
    detail: goodQty + ' good / ' + rejectQty + ' rejected, total variance Rs. ' + order.totalVariance,
  });

  res.json({ data: order, journalEntries: journals, variance: varianceAnalysis(order) });
});

export const cancelOrder = asyncHandler(async (req, res) => {
  const order = await ProductionOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Production order not found');
  if (order.status === 'COMPLETED') throw ApiError.badRequest('A completed order cannot be cancelled - post a reversal instead');
  if (order.status === 'IN_PROGRESS') {
    throw ApiError.badRequest('Materials have already been issued. Complete the order or reverse the issue first.');
  }

  order.status = 'CANCELLED';
  await order.save();
  recordAudit(req, { action: 'production.cancel', entity: 'ProductionOrder', entityId: order._id, entityCode: order.code });
  res.json({ data: order, message: 'Order cancelled' });
});

/** Estimated vs actual, line by line - drives the comparison screen. */
export const orderVariance = asyncHandler(async (req, res) => {
  const order = await ProductionOrder.findById(req.params.id).lean();
  if (!order) throw ApiError.notFound('Production order not found');

  const analysis = varianceAnalysis(order);
  const lines = order.lines.map((l) => ({
    materialCode: l.materialCode,
    materialName: l.materialName,
    uom: l.uom,
    standardQty: l.standardQty,
    actualQty: l.actualQty,
    varianceQty: round3(l.actualQty - l.standardQty),
    variancePercent: l.standardQty ? round2(((l.actualQty - l.standardQty) / l.standardQty) * 100) : 0,
    standardRate: l.standardRate,
    actualRate: l.actualRate,
    standardCost: l.standardCost,
    actualCost: l.actualCost,
    usageVarianceCost: l.usageVarianceCost,
    priceVarianceCost: l.priceVarianceCost,
    totalVarianceCost: l.totalVarianceCost,
    status: l.totalVarianceCost > 0 ? 'ADVERSE' : l.totalVarianceCost < 0 ? 'FAVOURABLE' : 'ON_STANDARD',
  }));

  res.json({ data: { order, analysis, lines } });
});
