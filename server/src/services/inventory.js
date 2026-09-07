import { Stock } from '../models/Stock.js';
import { StockMovement } from '../models/StockMovement.js';
import { Material } from '../models/Material.js';
import { ApiError } from '../utils/apiError.js';
import { round2, round3, round4 } from '../utils/money.js';

/**
 * Posts one stock movement and updates the moving-average balance.
 *
 * Inbound movements re-average the rate; outbound movements are valued at the
 * current moving average (so issues never change the unit cost of what is left).
 */
export async function postMovement({
  material,
  type,
  qty,
  rate,
  location,
  refType,
  refId,
  refCode,
  remarks,
  date,
  userId,
  allowNegative = false,
}) {
  // `material` may be a hydrated Material document or just an id / ObjectId
  const isDoc = material && typeof material.save === 'function' && material.code;
  const mat = isDoc ? material : await Material.findById(material?._id || material);
  if (!mat) throw ApiError.notFound('Material not found for stock movement');

  const loc = location || mat.defaultLocation || 'RM Store';
  const inbound = ['PURCHASE_RECEIPT', 'PRODUCTION_RECEIPT', 'ADJUSTMENT_IN', 'OPENING'].includes(type);
  const absQty = Math.abs(Number(qty) || 0);
  if (absQty <= 0) throw ApiError.badRequest('Stock movement quantity must be greater than zero');

  let stock = await Stock.findOne({ material: mat._id, location: loc });
  if (!stock) stock = new Stock({ material: mat._id, location: loc, qty: 0, avgRate: 0, value: 0 });

  const signedQty = inbound ? absQty : -absQty;

  if (!inbound && !allowNegative && stock.qty < absQty - 0.0001) {
    throw ApiError.badRequest(
      'Insufficient stock for ' + mat.name + ' at ' + loc +
      ': on hand ' + round3(stock.qty) + ' ' + mat.uom + ', required ' + round3(absQty) + ' ' + mat.uom
    );
  }

  let movementRate;
  if (inbound) {
    movementRate = round4(Number(rate) ?? mat.standardRate ?? 0);
    const newQty = round3(stock.qty + absQty);
    const newValue = round2(stock.value + absQty * movementRate);
    stock.qty = newQty;
    stock.value = newValue;
    stock.avgRate = newQty > 0 ? round4(newValue / newQty) : movementRate;
  } else {
    movementRate = round4(stock.avgRate || Number(rate) || mat.standardRate || 0);
    const newQty = round3(stock.qty - absQty);
    const newValue = round2(Math.max(0, stock.value - absQty * movementRate));
    stock.qty = newQty;
    stock.value = newQty <= 0 ? 0 : newValue;
    stock.avgRate = newQty > 0 ? round4(stock.value / newQty) : movementRate;
  }

  await stock.save();

  const value = round2(absQty * movementRate);

  const movement = await StockMovement.create({
    date: date || new Date(),
    material: mat._id,
    type,
    location: loc,
    qty: signedQty,
    rate: movementRate,
    value: inbound ? value : -value,
    balanceQty: stock.qty,
    balanceValue: stock.value,
    refType: refType || '',
    refId,
    refCode: refCode || '',
    remarks: remarks || '',
    createdBy: userId,
  });

  if (inbound && type === 'PURCHASE_RECEIPT') {
    mat.lastPurchaseRate = movementRate;
  }
  mat.movingAvgRate = stock.avgRate;
  await mat.save();

  return { movement, stock, valuedRate: movementRate, value };
}

/** Current valuation rate for a material (moving average, falling back to standard). */
export async function valuationRate(materialId, location) {
  const q = { material: materialId };
  if (location) q.location = location;
  const stock = await Stock.findOne(q);
  if (stock && stock.qty > 0) return round4(stock.avgRate);
  const mat = await Material.findById(materialId);
  return round4(mat?.movingAvgRate || mat?.standardRate || 0);
}

export async function stockOnHand(materialId, location) {
  const q = { material: materialId };
  if (location) q.location = location;
  const rows = await Stock.find(q);
  return round3(rows.reduce((s, r) => s + r.qty, 0));
}

/** Full valuation listing used by the inventory screen and the PDF/CSV report. */
export async function valuationReport(filter = {}) {
  const stocks = await Stock.find().populate('material').lean();
  return stocks
    .filter((s) => s.material)
    .filter((s) => (filter.category ? s.material.category === filter.category : true))
    .filter((s) => (filter.location ? s.location === filter.location : true))
    .map((s) => ({
      materialId: s.material._id,
      code: s.material.code,
      name: s.material.name,
      category: s.material.category,
      uom: s.material.uom,
      location: s.location,
      qty: round3(s.qty),
      avgRate: round4(s.avgRate),
      value: round2(s.value),
      reorderLevel: s.material.reorderLevel,
      belowReorder: s.material.reorderLevel > 0 && s.qty < s.material.reorderLevel,
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
