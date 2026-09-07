import { round2, round3, round4, sum } from '../utils/money.js';

/**
 * ---------------------------------------------------------------------------
 * Costing engine
 * ---------------------------------------------------------------------------
 * Conventions used throughout the system:
 *
 *   baseBatchQty  = GROSS units a single batch of the formula yields
 *   yieldPercent  = share of gross units that come out saleable
 *   goodUnits     = baseBatchQty * yieldPercent / 100
 *   line wastage  = extra material consumed above formula qty (process loss)
 *
 * Unit costs are always expressed per GOOD unit, because scrap does not
 * become inventory - its cost is absorbed by the units that survive.
 */

export function computeRecipeCost(recipe) {
  const lines = (recipe.lines || []).map((l) => {
    const qty = Number(l.qty) || 0;
    const rate = Number(l.rate) || 0;
    const wastage = Number(l.wastagePercent) || 0;
    const effectiveQty = round3(qty * (1 + wastage / 100));
    return {
      ...(l.toObject ? l.toObject() : l),
      effectiveQty,
      lineCost: round2(effectiveQty * rate),
    };
  });

  const materialCostPerBatch = round2(sum(lines, (l) => l.lineCost));
  const baseBatchQty = Number(recipe.baseBatchQty) || 1;
  const yieldPercent = Number(recipe.yieldPercent) || 100;
  const goodUnits = Math.max(1, (baseBatchQty * yieldPercent) / 100);

  const materialCostPerUnit = round4(materialCostPerBatch / goodUnits);
  const labour = Number(recipe.labourCostPerUnit) || 0;
  const factoryOverhead = Number(recipe.factoryOverheadPerUnit) || 0;
  const admin = Number(recipe.adminOverheadPerUnit) || 0;
  const marketing = Number(recipe.marketingOverheadPerUnit) || 0;

  const manufacturingCostPerUnit = round4(materialCostPerUnit + labour + factoryOverhead);
  const fullCostPerUnit = round4(manufacturingCostPerUnit + admin + marketing);

  return {
    lines,
    goodUnitsPerBatch: round3(goodUnits),
    scrapUnitsPerBatch: round3(baseBatchQty - goodUnits),
    materialCostPerBatch,
    materialCostPerUnit,
    labourCostPerUnit: labour,
    factoryOverheadPerUnit: factoryOverhead,
    adminOverheadPerUnit: admin,
    marketingOverheadPerUnit: marketing,
    manufacturingCostPerUnit,
    fullCostPerUnit,
    conversionCostPerUnit: round4(labour + factoryOverhead),
  };
}

/** Applies the computed figures back onto a recipe document before saving. */
export function applyRecipeCost(recipe) {
  const c = computeRecipeCost(recipe);
  recipe.lines = recipe.lines.map((l, i) => {
    // eslint-disable-next-line no-param-reassign
    l.lineCost = c.lines[i].lineCost;
    return l;
  });
  recipe.materialCostPerBatch = c.materialCostPerBatch;
  recipe.materialCostPerUnit = c.materialCostPerUnit;
  recipe.manufacturingCostPerUnit = c.manufacturingCostPerUnit;
  recipe.fullCostPerUnit = c.fullCostPerUnit;
  return c;
}

/**
 * Explodes an approved recipe into the standard bill of materials for a
 * production order of `plannedQty` GOOD units.
 */
export function explodeRecipe(recipe, plannedQty) {
  const cost = computeRecipeCost(recipe);
  const scaleFactor = round4(plannedQty / cost.goodUnitsPerBatch);

  const lines = cost.lines.map((l) => {
    const standardQty = round3(l.effectiveQty * scaleFactor);
    const standardRate = round2(l.rate);
    return {
      material: l.material,
      materialCode: l.materialCode,
      materialName: l.materialName,
      uom: l.uom,
      standardQty,
      standardRate,
      standardCost: round2(standardQty * standardRate),
      actualQty: standardQty,
      actualRate: standardRate,
      actualCost: round2(standardQty * standardRate),
      usageVarianceQty: 0,
      usageVarianceCost: 0,
      priceVarianceCost: 0,
      totalVarianceCost: 0,
      issued: false,
    };
  });

  return { lines, scaleFactor, cost };
}

/** Recomputes every derived number on a production order document. */
export function recalcProductionOrder(order) {
  const planned = Number(order.plannedQty) || 0;
  const good = Number(order.goodQty) || 0;

  order.lines = (order.lines || []).map((l) => {
    const sq = Number(l.standardQty) || 0;
    const sr = Number(l.standardRate) || 0;
    const aq = Number(l.actualQty) || 0;
    const ar = Number(l.actualRate) || 0;

    l.standardCost = round2(sq * sr);
    l.actualCost = round2(aq * ar);
    l.usageVarianceQty = round3(aq - sq);
    // usage variance is valued at STANDARD rate, price variance on ACTUAL qty
    l.usageVarianceCost = round2((aq - sq) * sr);
    l.priceVarianceCost = round2((ar - sr) * aq);
    l.totalVarianceCost = round2(l.actualCost - l.standardCost);
    return l;
  });

  order.standardMaterialCost = round2(sum(order.lines, (l) => l.standardCost));
  order.actualMaterialCost = round2(sum(order.lines, (l) => l.actualCost));

  order.standardTotalCost = round2(
    order.standardMaterialCost + (order.standardLabourCost || 0) + (order.standardOverheadCost || 0)
  );
  order.actualTotalCost = round2(
    order.actualMaterialCost + (order.actualLabourCost || 0) + (order.actualOverheadCost || 0)
  );

  order.standardUnitCost = round4(planned > 0 ? order.standardTotalCost / planned : 0);
  // actual unit cost is spread over GOOD output only
  const absorbBase = good > 0 ? good : planned;
  order.actualUnitCost = round4(absorbBase > 0 ? order.actualTotalCost / absorbBase : 0);
  order.totalVariance = round2(order.actualTotalCost - order.standardTotalCost);

  return order;
}

/** Detailed estimated-vs-actual analysis used by the UI and the reports. */
export function varianceAnalysis(order) {
  const planned = Number(order.plannedQty) || 0;
  const good = Number(order.goodQty) || 0;
  const reject = Number(order.rejectQty) || 0;

  const materialUsage = round2(sum(order.lines, (l) => l.usageVarianceCost));
  const materialPrice = round2(sum(order.lines, (l) => l.priceVarianceCost));
  const labour = round2((order.actualLabourCost || 0) - (order.standardLabourCost || 0));
  const overhead = round2((order.actualOverheadCost || 0) - (order.standardOverheadCost || 0));
  const yieldLossUnits = good > 0 ? round3(planned - good) : 0;
  const yieldVariance = round2(yieldLossUnits * (order.standardUnitCost || 0));

  const rows = [
    { element: 'Material - usage (quantity)', standard: 0, actual: materialUsage, variance: materialUsage },
    { element: 'Material - price (rate)', standard: 0, actual: materialPrice, variance: materialPrice },
    { element: 'Direct labour', standard: order.standardLabourCost || 0, actual: order.actualLabourCost || 0, variance: labour },
    { element: 'Factory overhead', standard: order.standardOverheadCost || 0, actual: order.actualOverheadCost || 0, variance: overhead },
  ];

  return {
    plannedQty: planned,
    goodQty: good,
    rejectQty: reject,
    yieldPercent: planned > 0 ? round2((good / planned) * 100) : 0,
    yieldLossUnits,
    yieldVariance,
    materialUsageVariance: materialUsage,
    materialPriceVariance: materialPrice,
    labourVariance: labour,
    overheadVariance: overhead,
    totalVariance: round2(materialUsage + materialPrice + labour + overhead),
    unitCostVariance: round4((order.actualUnitCost || 0) - (order.standardUnitCost || 0)),
    rows,
    /** favourable = actual below standard */
    verdict: (materialUsage + materialPrice + labour + overhead) <= 0 ? 'FAVOURABLE' : 'ADVERSE',
  };
}
