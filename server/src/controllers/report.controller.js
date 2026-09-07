import dayjs from 'dayjs';
import { Recipe } from '../models/Recipe.js';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { StockMovement } from '../models/StockMovement.js';
import { Invoice } from '../models/Invoice.js';
import { Account } from '../models/Account.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { sendCsv } from '../utils/csv.js';
import { sendPdfReport } from '../utils/pdf.js';
import { getSettings } from '../models/Setting.js';
import { computeRecipeCost, varianceAnalysis } from '../services/costing.js';
import { valuationReport } from '../services/inventory.js';
import { accountLedger, financialSummary, trialBalance } from '../services/accounting.js';
import { taxLedger, taxRegister, taxSummary } from '../services/tax.js';
import { round2, round4, sum } from '../utils/money.js';
import { recordAudit } from '../middleware/audit.js';

const n2 = (v) => (Number(v) || 0).toFixed(2);
const n3 = (v) => (Number(v) || 0).toFixed(3);
const n4 = (v) => (Number(v) || 0).toFixed(4);
const d = (v) => (v ? dayjs(v).format('DD-MMM-YYYY') : '');
const signed = (v) => {
  const x = Number(v) || 0;
  return (x > 0 ? '+' : '') + x.toFixed(2);
};

/* ========================================================================== */
/* Report registry - one definition drives JSON, CSV and PDF alike            */
/* ========================================================================== */

const reports = {
  'recipe-cost-sheet': {
    title: 'Recipe Cost Sheet',
    subtitle: 'Batch and per-unit standard cost build-up',
    landscape: false,
    async load(req) {
      const id = req.query.id;
      if (!id) throw ApiError.badRequest('Pass ?id=<recipeId>');
      const recipe = await Recipe.findById(id).lean();
      if (!recipe) throw ApiError.notFound('Recipe not found');
      const cost = computeRecipeCost(recipe);

      const rows = cost.lines.map((l) => ({
        material: l.materialName,
        code: l.materialCode,
        qty: l.qty,
        wastage: l.wastagePercent,
        effectiveQty: l.effectiveQty,
        uom: l.uom,
        rate: l.rate,
        lineCost: l.lineCost,
        perUnit: round4(l.lineCost / cost.goodUnitsPerBatch),
      }));

      return {
        rows,
        meta: [
          { label: 'Recipe', value: recipe.code + ' v' + recipe.version },
          { label: 'Product', value: recipe.productName },
          { label: 'Status', value: recipe.status },
          { label: 'Base batch', value: recipe.baseBatchQty + ' ' + recipe.baseBatchUom },
          { label: 'Yield', value: recipe.yieldPercent + '%  (' + cost.goodUnitsPerBatch + ' good units)' },
          { label: 'Effective', value: d(recipe.effectiveDate) },
        ],
        totals: [
          { label: 'Material cost / batch', value: n2(cost.materialCostPerBatch) },
          { label: 'Material / unit', value: n4(cost.materialCostPerUnit) },
          { label: 'Direct labour / unit', value: n4(cost.labourCostPerUnit) },
          { label: 'Factory overhead / unit', value: n4(cost.factoryOverheadPerUnit) },
          { label: 'Manufacturing cost / unit', value: n4(cost.manufacturingCostPerUnit) },
          { label: 'Admin + marketing / unit', value: n4(cost.adminOverheadPerUnit + cost.marketingOverheadPerUnit) },
          { label: 'Full management cost / unit', value: n4(cost.fullCostPerUnit) },
        ],
        notes: [
          'Manufacturing cost stops at factory gate: material + direct labour + factory overhead.',
          'Full management cost adds administration and marketing absorption and is not used to value inventory.',
          'Per-unit figures are spread over good units only (' + cost.goodUnitsPerBatch + '), so scrap is absorbed by saleable output.',
        ],
        filename: 'recipe-cost-' + recipe.code + '-v' + recipe.version,
      };
    },
    columns: [
      { key: 'code', title: 'Code', width: 1 },
      { key: 'material', title: 'Material', width: 2.4 },
      { key: 'qty', title: 'Formula Qty', width: 1.2, align: 'right', format: n3 },
      { key: 'wastage', title: 'Wastage %', width: 1, align: 'right', format: n2 },
      { key: 'effectiveQty', title: 'Effective Qty', width: 1.3, align: 'right', format: n3 },
      { key: 'uom', title: 'UOM', width: 0.7 },
      { key: 'rate', title: 'Rate', width: 1.1, align: 'right', format: n2 },
      { key: 'lineCost', title: 'Batch Cost', width: 1.3, align: 'right', format: n2 },
      { key: 'perUnit', title: 'Per Unit', width: 1.1, align: 'right', format: n4 },
    ],
  },

  'production-variance': {
    title: 'Standard vs Actual Cost',
    subtitle: 'Estimated cost against actual cost with variance analysis',
    landscape: true,
    async load(req) {
      const id = req.query.id;
      if (!id) throw ApiError.badRequest('Pass ?id=<productionOrderId>');
      const order = await ProductionOrder.findById(id).lean();
      if (!order) throw ApiError.notFound('Production order not found');
      const analysis = varianceAnalysis(order);

      const rows = order.lines.map((l) => ({
        code: l.materialCode,
        material: l.materialName,
        uom: l.uom,
        standardQty: l.standardQty,
        actualQty: l.actualQty,
        varianceQty: round2(l.actualQty - l.standardQty),
        standardRate: l.standardRate,
        actualRate: l.actualRate,
        standardCost: l.standardCost,
        actualCost: l.actualCost,
        usageVariance: l.usageVarianceCost,
        priceVariance: l.priceVarianceCost,
        totalVariance: l.totalVarianceCost,
      }));

      rows.push({
        __bold: true,
        code: '',
        material: 'MATERIAL TOTAL',
        uom: '',
        standardQty: null,
        actualQty: null,
        varianceQty: null,
        standardRate: null,
        actualRate: null,
        standardCost: order.standardMaterialCost,
        actualCost: order.actualMaterialCost,
        usageVariance: analysis.materialUsageVariance,
        priceVariance: analysis.materialPriceVariance,
        totalVariance: round2(order.actualMaterialCost - order.standardMaterialCost),
      });
      rows.push({
        __bold: false, code: '', material: 'Direct labour', uom: '',
        standardCost: order.standardLabourCost, actualCost: order.actualLabourCost,
        totalVariance: analysis.labourVariance,
      });
      rows.push({
        __bold: false, code: '', material: 'Factory overhead', uom: '',
        standardCost: order.standardOverheadCost, actualCost: order.actualOverheadCost,
        totalVariance: analysis.overheadVariance,
      });
      rows.push({
        __bold: true, code: '', material: 'TOTAL PRODUCTION COST', uom: '',
        standardCost: order.standardTotalCost, actualCost: order.actualTotalCost,
        totalVariance: order.totalVariance,
      });

      return {
        rows,
        meta: [
          { label: 'Order', value: order.code },
          { label: 'Product', value: order.productName },
          { label: 'Recipe', value: order.recipeCode + ' v' + order.recipeVersion },
          { label: 'Planned qty', value: order.plannedQty.toLocaleString() },
          { label: 'Good output', value: order.goodQty.toLocaleString() + ' (' + analysis.yieldPercent + '%)' },
          { label: 'Status', value: order.status },
          { label: 'Completed', value: d(order.completedAt) },
          { label: 'Verdict', value: analysis.verdict },
        ],
        totals: [
          { label: 'Standard unit cost', value: n4(order.standardUnitCost) },
          { label: 'Actual unit cost', value: n4(order.actualUnitCost) },
          { label: 'Unit cost variance', value: signed(analysis.unitCostVariance), tone: analysis.unitCostVariance > 0 ? 'bad' : 'good' },
          { label: 'Material usage variance', value: signed(analysis.materialUsageVariance) },
          { label: 'Material price variance', value: signed(analysis.materialPriceVariance) },
          { label: 'Yield loss (' + analysis.yieldLossUnits + ' units)', value: n2(analysis.yieldVariance) },
          { label: 'Total variance', value: signed(analysis.totalVariance), tone: analysis.totalVariance > 0 ? 'bad' : 'good' },
        ],
        notes: [
          'Usage variance is valued at standard rate; price variance is valued on actual quantity.',
          'A positive variance is adverse (actual above standard); a negative variance is favourable.',
          'Actual unit cost is spread over good output only, so yield loss raises the cost of what survives.',
        ],
        filename: 'variance-' + order.code,
      };
    },
    columns: [
      { key: 'code', title: 'Code', width: 0.9 },
      { key: 'material', title: 'Cost element', width: 2.2 },
      { key: 'standardQty', title: 'Std Qty', width: 1.1, align: 'right', format: (v) => (v == null ? '' : n3(v)) },
      { key: 'actualQty', title: 'Act Qty', width: 1.1, align: 'right', format: (v) => (v == null ? '' : n3(v)) },
      { key: 'varianceQty', title: 'Qty Var', width: 1, align: 'right', format: (v) => (v == null ? '' : signed(v)) },
      { key: 'standardRate', title: 'Std Rate', width: 1, align: 'right', format: (v) => (v == null ? '' : n2(v)) },
      { key: 'actualRate', title: 'Act Rate', width: 1, align: 'right', format: (v) => (v == null ? '' : n2(v)) },
      { key: 'standardCost', title: 'Std Cost', width: 1.3, align: 'right', format: (v) => (v == null ? '' : n2(v)) },
      { key: 'actualCost', title: 'Act Cost', width: 1.3, align: 'right', format: (v) => (v == null ? '' : n2(v)) },
      { key: 'usageVariance', title: 'Usage Var', width: 1.2, align: 'right', format: (v) => (v == null ? '' : signed(v)) },
      { key: 'priceVariance', title: 'Price Var', width: 1.2, align: 'right', format: (v) => (v == null ? '' : signed(v)) },
      { key: 'totalVariance', title: 'Total Var', width: 1.2, align: 'right', format: (v) => (v == null ? '' : signed(v)) },
    ],
  },

  'material-consumption': {
    title: 'Material Consumption Variance',
    subtitle: 'Excess and saved usage across completed production orders',
    landscape: true,
    async load(req) {
      const q = { status: 'COMPLETED' };
      if (req.query.from || req.query.to) {
        q.completedAt = {};
        if (req.query.from) q.completedAt.$gte = new Date(req.query.from);
        if (req.query.to) q.completedAt.$lte = new Date(req.query.to);
      }
      const orders = await ProductionOrder.find(q).sort({ completedAt: -1 }).lean();

      const byMaterial = new Map();
      for (const o of orders) {
        for (const l of o.lines) {
          const key = l.materialCode;
          const b = byMaterial.get(key) || {
            code: l.materialCode, material: l.materialName, uom: l.uom,
            standardQty: 0, actualQty: 0, standardCost: 0, actualCost: 0, orders: 0,
          };
          b.standardQty = round2(b.standardQty + l.standardQty);
          b.actualQty = round2(b.actualQty + l.actualQty);
          b.standardCost = round2(b.standardCost + l.standardCost);
          b.actualCost = round2(b.actualCost + l.actualCost);
          b.orders += 1;
          byMaterial.set(key, b);
        }
      }

      const rows = [...byMaterial.values()].map((b) => ({
        ...b,
        varianceQty: round2(b.actualQty - b.standardQty),
        variancePercent: b.standardQty ? round2(((b.actualQty - b.standardQty) / b.standardQty) * 100) : 0,
        varianceCost: round2(b.actualCost - b.standardCost),
      })).sort((a, b) => b.varianceCost - a.varianceCost);

      return {
        rows,
        meta: [
          { label: 'Orders analysed', value: orders.length },
          { label: 'Materials', value: rows.length },
          { label: 'From', value: req.query.from ? d(req.query.from) : 'Beginning' },
          { label: 'To', value: req.query.to ? d(req.query.to) : 'Today' },
        ],
        totals: [
          { label: 'Standard material cost', value: n2(sum(rows, (r) => r.standardCost)) },
          { label: 'Actual material cost', value: n2(sum(rows, (r) => r.actualCost)) },
          { label: 'Net consumption variance', value: signed(sum(rows, (r) => r.varianceCost)) },
        ],
        notes: ['Rows are sorted worst-first so the biggest wastage sits at the top.'],
        filename: 'material-consumption',
      };
    },
    columns: [
      { key: 'code', title: 'Code', width: 1 },
      { key: 'material', title: 'Material', width: 2.4 },
      { key: 'uom', title: 'UOM', width: 0.7 },
      { key: 'orders', title: 'Orders', width: 0.8, align: 'right' },
      { key: 'standardQty', title: 'Standard Qty', width: 1.4, align: 'right', format: n3 },
      { key: 'actualQty', title: 'Actual Qty', width: 1.4, align: 'right', format: n3 },
      { key: 'varianceQty', title: 'Variance Qty', width: 1.3, align: 'right', format: signed },
      { key: 'variancePercent', title: 'Var %', width: 1, align: 'right', format: signed },
      { key: 'standardCost', title: 'Standard Cost', width: 1.5, align: 'right', format: n2 },
      { key: 'actualCost', title: 'Actual Cost', width: 1.5, align: 'right', format: n2 },
      { key: 'varianceCost', title: 'Variance Cost', width: 1.5, align: 'right', format: signed },
    ],
  },

  'inventory-valuation': {
    title: 'Inventory Valuation',
    subtitle: 'Raw material, WIP and finished goods at moving average cost',
    landscape: false,
    async load(req) {
      const rows = await valuationReport({ category: req.query.category, location: req.query.location });
      const byCategory = rows.reduce((acc, r) => {
        acc[r.category] = round2((acc[r.category] || 0) + r.value);
        return acc;
      }, {});
      return {
        rows,
        meta: [
          { label: 'Lines', value: rows.length },
          { label: 'Below reorder', value: rows.filter((r) => r.belowReorder).length },
          { label: 'As at', value: d(new Date()) },
        ],
        totals: [
          ...Object.entries(byCategory).map(([k, v]) => ({ label: k, value: n2(v) })),
          { label: 'TOTAL INVENTORY VALUE', value: n2(sum(rows, (r) => r.value)) },
        ],
        notes: ['Issues are valued at moving average, so the general ledger inventory balance equals this total.'],
        filename: 'inventory-valuation',
      };
    },
    columns: [
      { key: 'code', title: 'Code', width: 1 },
      { key: 'name', title: 'Item', width: 2.6 },
      { key: 'category', title: 'Category', width: 1.2 },
      { key: 'location', title: 'Location', width: 1.4 },
      { key: 'qty', title: 'Qty', width: 1.2, align: 'right', format: n3 },
      { key: 'uom', title: 'UOM', width: 0.7 },
      { key: 'avgRate', title: 'Avg Rate', width: 1.2, align: 'right', format: n4 },
      { key: 'value', title: 'Value', width: 1.5, align: 'right', format: n2 },
    ],
  },

  'stock-movement': {
    title: 'Stock Movement Register',
    subtitle: 'Every receipt, issue and adjustment with running balance',
    landscape: true,
    async load(req) {
      const q = {};
      if (req.query.material) q.material = req.query.material;
      if (req.query.type) q.type = req.query.type;
      if (req.query.from || req.query.to) {
        q.date = {};
        if (req.query.from) q.date.$gte = new Date(req.query.from);
        if (req.query.to) q.date.$lte = new Date(req.query.to);
      }
      const moves = await StockMovement.find(q).populate('material', 'code name uom').sort({ date: 1, createdAt: 1 }).limit(2000).lean();
      const rows = moves.map((m) => ({
        date: m.date,
        code: m.material?.code,
        material: m.material?.name,
        type: m.type,
        location: m.location,
        inQty: m.qty > 0 ? m.qty : null,
        outQty: m.qty < 0 ? -m.qty : null,
        rate: m.rate,
        value: Math.abs(m.value),
        balanceQty: m.balanceQty,
        balanceValue: m.balanceValue,
        ref: m.refCode || m.refType,
      }));
      return {
        rows,
        meta: [
          { label: 'Movements', value: rows.length },
          { label: 'From', value: req.query.from ? d(req.query.from) : 'Beginning' },
          { label: 'To', value: req.query.to ? d(req.query.to) : 'Today' },
        ],
        totals: [
          { label: 'Total received', value: n3(sum(rows, (r) => r.inQty || 0)) },
          { label: 'Total issued', value: n3(sum(rows, (r) => r.outQty || 0)) },
        ],
        notes: [],
        filename: 'stock-movements',
      };
    },
    columns: [
      { key: 'date', title: 'Date', width: 1.2, format: d },
      { key: 'code', title: 'Code', width: 0.9 },
      { key: 'material', title: 'Material', width: 2.2 },
      { key: 'type', title: 'Type', width: 1.7 },
      { key: 'location', title: 'Location', width: 1.3 },
      { key: 'inQty', title: 'In', width: 1.1, align: 'right', format: (v) => (v ? n3(v) : '') },
      { key: 'outQty', title: 'Out', width: 1.1, align: 'right', format: (v) => (v ? n3(v) : '') },
      { key: 'rate', title: 'Rate', width: 1, align: 'right', format: n2 },
      { key: 'value', title: 'Value', width: 1.3, align: 'right', format: n2 },
      { key: 'balanceQty', title: 'Bal Qty', width: 1.2, align: 'right', format: n3 },
      { key: 'balanceValue', title: 'Bal Value', width: 1.3, align: 'right', format: n2 },
      { key: 'ref', title: 'Reference', width: 1.3 },
    ],
  },

  'trial-balance': {
    title: 'Trial Balance',
    subtitle: 'All posted journal entries by account',
    landscape: false,
    async load(req) {
      const tb = await trialBalance({ from: req.query.from, to: req.query.to });
      return {
        rows: tb.rows,
        meta: [
          { label: 'Accounts', value: tb.rows.length },
          { label: 'From', value: req.query.from ? d(req.query.from) : 'Beginning' },
          { label: 'To', value: req.query.to ? d(req.query.to) : 'Today' },
        ],
        totals: [
          { label: 'Total debit', value: n2(tb.totalDebit) },
          { label: 'Total credit', value: n2(tb.totalCredit) },
          {
            label: 'Difference',
            value: n2(tb.totalDebit - tb.totalCredit),
            tone: Math.abs(tb.totalDebit - tb.totalCredit) < 0.01 ? 'good' : 'bad',
          },
        ],
        notes: ['Balances shown net; an account appears on the side matching its net position.'],
        filename: 'trial-balance',
      };
    },
    columns: [
      { key: 'code', title: 'Code', width: 0.9 },
      { key: 'name', title: 'Account', width: 3 },
      { key: 'type', title: 'Type', width: 1.2 },
      { key: 'debit', title: 'Total Debit', width: 1.5, align: 'right', format: n2 },
      { key: 'credit', title: 'Total Credit', width: 1.5, align: 'right', format: n2 },
      { key: 'balanceDebit', title: 'Balance Dr', width: 1.5, align: 'right', format: (v) => (v ? n2(v) : '') },
      { key: 'balanceCredit', title: 'Balance Cr', width: 1.5, align: 'right', format: (v) => (v ? n2(v) : '') },
    ],
  },

  ledger: {
    title: 'General Ledger',
    subtitle: 'Account detail with running balance',
    landscape: false,
    async load(req) {
      const id = req.query.account;
      if (!id) throw ApiError.badRequest('Pass ?account=<accountId>');
      const { account, rows, closingBalance } = await accountLedger(id, { from: req.query.from, to: req.query.to });
      return {
        rows,
        meta: [
          { label: 'Account', value: account.code + ' - ' + account.name },
          { label: 'Type', value: account.type },
          { label: 'Entries', value: rows.length },
        ],
        totals: [
          { label: 'Total debit', value: n2(sum(rows, (r) => r.debit)) },
          { label: 'Total credit', value: n2(sum(rows, (r) => r.credit)) },
          { label: 'Closing balance', value: n2(closingBalance) },
        ],
        notes: [],
        filename: 'ledger-' + account.code,
      };
    },
    columns: [
      { key: 'date', title: 'Date', width: 1.2, format: d },
      { key: 'entryCode', title: 'Entry', width: 1.2 },
      { key: 'refCode', title: 'Reference', width: 1.3 },
      { key: 'narration', title: 'Narration', width: 3.4 },
      { key: 'debit', title: 'Debit', width: 1.3, align: 'right', format: (v) => (v ? n2(v) : '') },
      { key: 'credit', title: 'Credit', width: 1.3, align: 'right', format: (v) => (v ? n2(v) : '') },
      { key: 'balance', title: 'Balance', width: 1.4, align: 'right', format: n2 },
    ],
  },

  'sales-tax': {
    title: 'Sales Tax Summary',
    subtitle: 'Input tax, output tax and net position by period',
    landscape: false,
    async load(req) {
      const ledger = await taxLedger({ from: req.query.from, to: req.query.to });
      const summary = await taxSummary(req.query.period);
      return {
        rows: ledger,
        meta: [
          { label: 'Periods', value: ledger.length },
          { label: 'Focus period', value: summary.period },
          { label: 'Position', value: summary.position },
        ],
        totals: [
          { label: 'Total input tax', value: n2(sum(ledger, (r) => r.inputTax)) },
          { label: 'Total output tax', value: n2(sum(ledger, (r) => r.outputTax)) },
          {
            label: 'Net payable',
            value: n2(sum(ledger, (r) => r.net)),
            tone: sum(ledger, (r) => r.net) > 0 ? 'bad' : 'good',
          },
        ],
        notes: [
          'Input tax is recoverable and is never capitalised into inventory cost.',
          'Output tax is a liability and is kept out of sales revenue.',
          'Rates are configurable in Settings and must be set to the rate applicable to the product under current law.',
        ],
        filename: 'sales-tax-summary',
      };
    },
    columns: [
      { key: 'period', title: 'Period', width: 1.2 },
      { key: 'invoices', title: 'Invoices', width: 1, align: 'right' },
      { key: 'taxablePurchases', title: 'Taxable Purchases', width: 1.8, align: 'right', format: n2 },
      { key: 'inputTax', title: 'Input Tax', width: 1.5, align: 'right', format: n2 },
      { key: 'taxableSales', title: 'Taxable Sales', width: 1.8, align: 'right', format: n2 },
      { key: 'outputTax', title: 'Output Tax', width: 1.5, align: 'right', format: n2 },
      { key: 'net', title: 'Net Payable', width: 1.5, align: 'right', format: n2 },
    ],
  },

  'tax-register': {
    title: 'Sales Tax Register',
    subtitle: 'Invoice-level input and output tax detail',
    landscape: true,
    async load(req) {
      const rows = await taxRegister(req.query.period);
      return {
        rows,
        meta: [
          { label: 'Period', value: req.query.period || 'All' },
          { label: 'Invoices', value: rows.length },
        ],
        totals: [
          { label: 'Input tax', value: n2(sum(rows, (r) => r.inputTax)) },
          { label: 'Output tax', value: n2(sum(rows, (r) => r.outputTax)) },
          { label: 'Net', value: n2(sum(rows, (r) => r.outputTax) - sum(rows, (r) => r.inputTax)) },
        ],
        notes: [],
        filename: 'tax-register',
      };
    },
    columns: [
      { key: 'date', title: 'Date', width: 1.2, format: d },
      { key: 'code', title: 'Invoice', width: 1.3 },
      { key: 'kind', title: 'Type', width: 1 },
      { key: 'party', title: 'Party', width: 2.4 },
      { key: 'ntn', title: 'NTN', width: 1.2 },
      { key: 'taxable', title: 'Taxable Value', width: 1.6, align: 'right', format: n2 },
      { key: 'taxRate', title: 'Rate %', width: 0.9, align: 'right', format: n2 },
      { key: 'inputTax', title: 'Input Tax', width: 1.4, align: 'right', format: (v) => (v ? n2(v) : '') },
      { key: 'outputTax', title: 'Output Tax', width: 1.4, align: 'right', format: (v) => (v ? n2(v) : '') },
      { key: 'grandTotal', title: 'Invoice Total', width: 1.6, align: 'right', format: n2 },
    ],
  },

  'production-summary': {
    title: 'Production Summary',
    subtitle: 'Output, yield and unit cost by production order',
    landscape: true,
    async load(req) {
      const q = {};
      if (req.query.status) q.status = req.query.status;
      if (req.query.from || req.query.to) {
        q.scheduledDate = {};
        if (req.query.from) q.scheduledDate.$gte = new Date(req.query.from);
        if (req.query.to) q.scheduledDate.$lte = new Date(req.query.to);
      }
      const orders = await ProductionOrder.find(q).sort({ scheduledDate: -1 }).lean();
      const rows = orders.map((o) => ({
        code: o.code,
        date: o.scheduledDate,
        product: o.productName,
        recipe: o.recipeCode + ' v' + o.recipeVersion,
        status: o.status,
        plannedQty: o.plannedQty,
        goodQty: o.goodQty,
        rejectQty: o.rejectQty,
        yieldPercent: o.plannedQty ? round2((o.goodQty / o.plannedQty) * 100) : 0,
        standardUnitCost: o.standardUnitCost,
        actualUnitCost: o.actualUnitCost,
        unitVariance: round4(o.actualUnitCost - o.standardUnitCost),
        totalVariance: o.totalVariance,
      }));
      return {
        rows,
        meta: [
          { label: 'Orders', value: rows.length },
          { label: 'Planned units', value: sum(rows, (r) => r.plannedQty).toLocaleString() },
          { label: 'Good units', value: sum(rows, (r) => r.goodQty).toLocaleString() },
          { label: 'Rejected', value: sum(rows, (r) => r.rejectQty).toLocaleString() },
        ],
        totals: [
          { label: 'Total standard cost', value: n2(sum(orders, (o) => o.standardTotalCost)) },
          { label: 'Total actual cost', value: n2(sum(orders, (o) => o.actualTotalCost)) },
          { label: 'Total variance', value: signed(sum(orders, (o) => o.totalVariance)) },
        ],
        notes: [],
        filename: 'production-summary',
      };
    },
    columns: [
      { key: 'code', title: 'Order', width: 1.2 },
      { key: 'date', title: 'Date', width: 1.2, format: d },
      { key: 'product', title: 'Product', width: 2.2 },
      { key: 'recipe', title: 'Recipe', width: 1.4 },
      { key: 'status', title: 'Status', width: 1.2 },
      { key: 'plannedQty', title: 'Planned', width: 1.2, align: 'right', format: (v) => Number(v).toLocaleString() },
      { key: 'goodQty', title: 'Good', width: 1.2, align: 'right', format: (v) => Number(v).toLocaleString() },
      { key: 'rejectQty', title: 'Reject', width: 1, align: 'right', format: (v) => Number(v).toLocaleString() },
      { key: 'yieldPercent', title: 'Yield %', width: 1, align: 'right', format: n2 },
      { key: 'standardUnitCost', title: 'Std / Unit', width: 1.2, align: 'right', format: n4 },
      { key: 'actualUnitCost', title: 'Act / Unit', width: 1.2, align: 'right', format: n4 },
      { key: 'unitVariance', title: 'Unit Var', width: 1.1, align: 'right', format: (v) => (Number(v) > 0 ? '+' : '') + n4(v) },
      { key: 'totalVariance', title: 'Total Var', width: 1.3, align: 'right', format: signed },
    ],
  },

  'sales-register': {
    title: 'Sales Register',
    subtitle: 'Posted sales invoices with gross margin',
    landscape: true,
    async load(req) {
      const q = { kind: 'SALES', status: 'POSTED' };
      if (req.query.period) q.period = req.query.period;
      const rows = await Invoice.find(q).sort({ date: -1 }).lean();
      const mapped = rows.map((r) => ({
        date: r.date,
        code: r.code,
        party: r.partyName,
        units: sum(r.lines, (l) => l.qty),
        subtotal: r.subtotal,
        taxTotal: r.taxTotal,
        grandTotal: r.grandTotal,
        cogsAmount: r.cogsAmount,
        grossProfit: r.grossProfit,
        marginPercent: r.subtotal ? round2((r.grossProfit / r.subtotal) * 100) : 0,
      }));
      return {
        rows: mapped,
        meta: [
          { label: 'Invoices', value: mapped.length },
          { label: 'Period', value: req.query.period || 'All' },
        ],
        totals: [
          { label: 'Net sales', value: n2(sum(mapped, (r) => r.subtotal)) },
          { label: 'Output tax', value: n2(sum(mapped, (r) => r.taxTotal)) },
          { label: 'Cost of goods sold', value: n2(sum(mapped, (r) => r.cogsAmount)) },
          { label: 'Gross profit', value: n2(sum(mapped, (r) => r.grossProfit)), tone: 'good' },
        ],
        notes: ['Cost of goods sold is the moving-average value actually relieved from finished goods stock.'],
        filename: 'sales-register',
      };
    },
    columns: [
      { key: 'date', title: 'Date', width: 1.2, format: d },
      { key: 'code', title: 'Invoice', width: 1.3 },
      { key: 'party', title: 'Customer', width: 2.6 },
      { key: 'units', title: 'Units', width: 1.2, align: 'right', format: (v) => Number(v).toLocaleString() },
      { key: 'subtotal', title: 'Net Sales', width: 1.6, align: 'right', format: n2 },
      { key: 'taxTotal', title: 'Output Tax', width: 1.4, align: 'right', format: n2 },
      { key: 'grandTotal', title: 'Invoice Total', width: 1.6, align: 'right', format: n2 },
      { key: 'cogsAmount', title: 'COGS', width: 1.5, align: 'right', format: n2 },
      { key: 'grossProfit', title: 'Gross Profit', width: 1.5, align: 'right', format: n2 },
      { key: 'marginPercent', title: 'Margin %', width: 1.1, align: 'right', format: n2 },
    ],
  },

  'purchase-register': {
    title: 'Purchase Register',
    subtitle: 'Posted supplier invoices with recoverable input tax',
    landscape: false,
    async load(req) {
      const q = { kind: 'PURCHASE', status: 'POSTED' };
      if (req.query.period) q.period = req.query.period;
      const rows = await Invoice.find(q).sort({ date: -1 }).lean();
      const mapped = rows.map((r) => ({
        date: r.date,
        code: r.code,
        party: r.partyName,
        reference: r.reference,
        subtotal: r.subtotal,
        taxTotal: r.taxTotal,
        grandTotal: r.grandTotal,
      }));
      return {
        rows: mapped,
        meta: [
          { label: 'Invoices', value: mapped.length },
          { label: 'Period', value: req.query.period || 'All' },
        ],
        totals: [
          { label: 'Net purchases', value: n2(sum(mapped, (r) => r.subtotal)) },
          { label: 'Input tax', value: n2(sum(mapped, (r) => r.taxTotal)) },
          { label: 'Total payable', value: n2(sum(mapped, (r) => r.grandTotal)) },
        ],
        notes: [],
        filename: 'purchase-register',
      };
    },
    columns: [
      { key: 'date', title: 'Date', width: 1.2, format: d },
      { key: 'code', title: 'Invoice', width: 1.4 },
      { key: 'party', title: 'Supplier', width: 2.6 },
      { key: 'reference', title: 'Reference', width: 1.6 },
      { key: 'subtotal', title: 'Net Amount', width: 1.6, align: 'right', format: n2 },
      { key: 'taxTotal', title: 'Input Tax', width: 1.4, align: 'right', format: n2 },
      { key: 'grandTotal', title: 'Total', width: 1.6, align: 'right', format: n2 },
    ],
  },

  'profit-loss': {
    title: 'Profit and Loss',
    subtitle: 'Income and expense by account',
    landscape: false,
    async load(req) {
      const fin = await financialSummary({ from: req.query.from, to: req.query.to });
      const rows = fin.trialBalance.rows
        .filter((r) => ['INCOME', 'EXPENSE'].includes(r.type))
        .map((r) => ({
          code: r.code,
          name: r.name,
          type: r.type,
          amount: Math.abs(r.net),
        }));
      return {
        rows,
        meta: [
          { label: 'From', value: req.query.from ? d(req.query.from) : 'Beginning' },
          { label: 'To', value: req.query.to ? d(req.query.to) : 'Today' },
        ],
        totals: [
          { label: 'Revenue', value: n2(fin.revenue) },
          { label: 'Cost of goods sold', value: n2(fin.cogs) },
          { label: 'Gross profit', value: n2(fin.grossProfit), tone: fin.grossProfit >= 0 ? 'good' : 'bad' },
          { label: 'Total expenses', value: n2(fin.totalExpenses) },
          { label: 'Net profit', value: n2(fin.netProfit), tone: fin.netProfit >= 0 ? 'good' : 'bad' },
        ],
        notes: [],
        filename: 'profit-and-loss',
      };
    },
    columns: [
      { key: 'code', title: 'Code', width: 1 },
      { key: 'name', title: 'Account', width: 3.4 },
      { key: 'type', title: 'Type', width: 1.4 },
      { key: 'amount', title: 'Amount', width: 1.8, align: 'right', format: n2 },
    ],
  },
};

/* ========================================================================== */

export const listReports = asyncHandler(async (_req, res) => {
  res.json({
    data: Object.entries(reports).map(([key, r]) => ({
      key,
      title: r.title,
      subtitle: r.subtitle,
      needsId: ['recipe-cost-sheet', 'production-variance', 'ledger'].includes(key),
    })),
  });
});

export const runReport = asyncHandler(async (req, res) => {
  const def = reports[req.params.key];
  if (!def) throw ApiError.notFound('Unknown report: ' + req.params.key);

  const format = (req.query.format || 'json').toLowerCase();
  const result = await def.load(req);
  const settings = await getSettings();
  const stamp = dayjs().format('YYYYMMDD-HHmm');
  const base = (result.filename || req.params.key) + '-' + stamp;

  if (format === 'csv') {
    recordAudit(req, { action: 'report.export', entity: 'Report', entityCode: req.params.key, detail: 'CSV' });
    return sendCsv(res, base + '.csv', def.columns, result.rows);
  }

  if (format === 'pdf') {
    recordAudit(req, { action: 'report.export', entity: 'Report', entityCode: req.params.key, detail: 'PDF' });
    return sendPdfReport(res, {
      filename: base + '.pdf',
      title: def.title,
      subtitle: def.subtitle,
      company: settings,
      meta: result.meta,
      columns: def.columns,
      rows: result.rows,
      totals: result.totals,
      notes: result.notes,
      landscape: def.landscape,
    });
  }

  return res.json({
    key: req.params.key,
    title: def.title,
    subtitle: def.subtitle,
    columns: def.columns.map((c) => ({ key: typeof c.key === 'string' ? c.key : c.title, title: c.title, align: c.align || 'left' })),
    data: result.rows,
    meta: result.meta,
    totals: result.totals,
    notes: result.notes,
  });
});
