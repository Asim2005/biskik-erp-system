import { z } from 'zod';
import { Party } from '../models/Party.js';
import { AuditLog } from '../models/AuditLog.js';
import { Setting, getSettings } from '../models/Setting.js';
import { Recipe } from '../models/Recipe.js';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { Invoice } from '../models/Invoice.js';
import { Material } from '../models/Material.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';
import { nextCode } from '../utils/numbering.js';
import { taxLedger, taxRegister, taxSummary } from '../services/tax.js';
import { valuationReport } from '../services/inventory.js';
import { financialSummary } from '../services/accounting.js';
import { round2, round4, sum } from '../utils/money.js';

/* ----------------------------------- parties ---------------------------- */

export const partySchema = z.object({
  type: z.enum(['CUSTOMER', 'SUPPLIER']),
  name: z.string().min(2),
  contactPerson: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  email: z.string().optional().default(''),
  address: z.string().optional().default(''),
  city: z.string().optional().default(''),
  ntn: z.string().optional().default(''),
  strn: z.string().optional().default(''),
  filerStatus: z.enum(['FILER', 'NON_FILER', 'UNKNOWN']).default('UNKNOWN'),
  creditLimit: z.coerce.number().min(0).default(0),
  creditDays: z.coerce.number().min(0).default(0),
  openingBalance: z.coerce.number().default(0),
  isActive: z.boolean().optional().default(true),
});

export const listParties = asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.type) q.type = req.query.type;
  if (req.query.search) q.$or = [{ name: new RegExp(req.query.search, 'i') }, { code: new RegExp(req.query.search, 'i') }];
  const data = await Party.find(q).sort({ name: 1 }).lean();
  res.json({ data });
});

export const createParty = asyncHandler(async (req, res) => {
  const code = await nextCode(req.body.type === 'CUSTOMER' ? 'CUS' : 'SUP', 4);
  const party = await Party.create({ ...req.body, code, balance: req.body.openingBalance });
  recordAudit(req, { action: 'party.create', entity: 'Party', entityId: party._id, entityCode: party.code, detail: party.name });
  res.status(201).json({ data: party });
});

export const updateParty = asyncHandler(async (req, res) => {
  const party = await Party.findById(req.params.id);
  if (!party) throw ApiError.notFound('Party not found');
  Object.assign(party, req.body);
  await party.save();
  recordAudit(req, { action: 'party.update', entity: 'Party', entityId: party._id, entityCode: party.code });
  res.json({ data: party });
});

export const deleteParty = asyncHandler(async (req, res) => {
  const party = await Party.findById(req.params.id);
  if (!party) throw ApiError.notFound('Party not found');
  const used = await Invoice.findOne({ party: party._id });
  if (used) throw ApiError.badRequest('Party is used on invoice ' + used.code + ' - deactivate instead');
  await party.deleteOne();
  res.json({ message: 'Party removed' });
});

/* ------------------------------------ tax -------------------------------- */

export const getTaxSummary = asyncHandler(async (req, res) => {
  const summary = await taxSummary(req.query.period);
  const ledger = await taxLedger({ from: req.query.from, to: req.query.to });
  const settings = await getSettings();
  res.json({
    data: summary,
    ledger,
    config: {
      defaultSalesTaxRate: settings.defaultSalesTaxRate,
      furtherTaxRate: settings.furtherTaxRate,
      withholdingTaxRate: settings.withholdingTaxRate,
    },
  });
});

export const getTaxRegister = asyncHandler(async (req, res) => {
  const rows = await taxRegister(req.query.period);
  res.json({ data: rows });
});

/* ---------------------------------- audit -------------------------------- */

export const listAudit = asyncHandler(async (req, res) => {
  const { action, entity, user, limit } = req.query;
  const q = {};
  if (action) q.action = new RegExp(action, 'i');
  if (entity) q.entity = entity;
  if (user) q.user = user;
  const data = await AuditLog.find(q).sort({ createdAt: -1 }).limit(Number(limit) || 300).lean();
  res.json({ data });
});

/* --------------------------------- settings ------------------------------ */

export const settingsSchema = z.object({
  companyName: z.string().min(2).optional(),
  address: z.string().optional(),
  ntn: z.string().optional(),
  strn: z.string().optional(),
  currencySymbol: z.string().optional(),
  defaultSalesTaxRate: z.coerce.number().min(0).max(100).optional(),
  furtherTaxRate: z.coerce.number().min(0).max(100).optional(),
  withholdingTaxRate: z.coerce.number().min(0).max(100).optional(),
  labourRatePerUnit: z.coerce.number().min(0).optional(),
  overheadRatePerUnit: z.coerce.number().min(0).optional(),
  adminRatePerUnit: z.coerce.number().min(0).optional(),
  marketingRatePerUnit: z.coerce.number().min(0).optional(),
  lowStockThresholdPercent: z.coerce.number().min(0).max(100).optional(),
});

export const getSettingsHandler = asyncHandler(async (_req, res) => {
  res.json({ data: await getSettings() });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const doc = await getSettings();
  Object.assign(doc, req.body);
  await doc.save();
  recordAudit(req, { action: 'settings.update', entity: 'Setting', detail: Object.keys(req.body).join(', ') });
  res.json({ data: doc });
});

/* -------------------------------- dashboard ------------------------------ */

export const dashboard = asyncHandler(async (req, res) => {
  const now = new Date();
  const period = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [recipes, orders, valuation, tax, financials, lowStockMaterials] = await Promise.all([
    Recipe.find({ status: 'APPROVED' }).lean(),
    ProductionOrder.find().sort({ createdAt: -1 }).limit(200).lean(),
    valuationReport(),
    taxSummary(period),
    financialSummary(),
    Material.find({ isActive: true, reorderLevel: { $gt: 0 } }).lean(),
  ]);

  const completed = orders.filter((o) => o.status === 'COMPLETED');
  const monthOrders = completed.filter((o) => new Date(o.completedAt || o.createdAt) >= monthStart);

  const producedThisMonth = sum(monthOrders, (o) => o.goodQty);
  const actualCostThisMonth = round2(sum(monthOrders, (o) => o.actualTotalCost));
  const standardCostThisMonth = round2(sum(monthOrders, (o) => o.standardTotalCost));

  const avgActualUnit = producedThisMonth > 0 ? round4(actualCostThisMonth / producedThisMonth) : 0;
  const avgStandardUnit = producedThisMonth > 0 ? round4(standardCostThisMonth / producedThisMonth) : 0;

  const stockByCategory = valuation.reduce((acc, r) => {
    acc[r.category] = round2((acc[r.category] || 0) + r.value);
    return acc;
  }, {});

  const stockMap = new Map(valuation.map((v) => [String(v.materialId), v.qty]));
  const lowStock = lowStockMaterials
    .filter((m) => (stockMap.get(String(m._id)) || 0) <= m.reorderLevel)
    .map((m) => ({
      code: m.code,
      name: m.name,
      uom: m.uom,
      onHand: stockMap.get(String(m._id)) || 0,
      reorderLevel: m.reorderLevel,
    }))
    .slice(0, 8);

  // production trend, last 8 completed orders oldest-first
  const trend = completed
    .slice(0, 8)
    .reverse()
    .map((o) => ({
      code: o.code,
      date: o.completedAt,
      planned: o.plannedQty,
      good: o.goodQty,
      standardUnitCost: o.standardUnitCost,
      actualUnitCost: o.actualUnitCost,
    }));

  const pendingApprovals = await Recipe.countDocuments({ status: 'PENDING_APPROVAL' });

  res.json({
    data: {
      period,
      cards: {
        activeRecipes: recipes.length,
        pendingApprovals,
        openOrders: orders.filter((o) => ['DRAFT', 'RELEASED', 'IN_PROGRESS'].includes(o.status)).length,
        producedThisMonth,
        avgActualUnitCost: avgActualUnit,
        avgStandardUnitCost: avgStandardUnit,
        unitCostVariance: round4(avgActualUnit - avgStandardUnit),
        inventoryValue: round2(sum(valuation, (v) => v.value)),
        netTaxPayable: tax.netPayable,
        revenue: financials.revenue,
        grossProfit: financials.grossProfit,
        netProfit: financials.netProfit,
      },
      stockByCategory,
      lowStock,
      trend,
      tax,
      recentOrders: orders.slice(0, 6).map((o) => ({
        code: o.code,
        productName: o.productName,
        status: o.status,
        plannedQty: o.plannedQty,
        goodQty: o.goodQty,
        totalVariance: o.totalVariance,
        createdAt: o.createdAt,
      })),
      workflow: [
        { stage: 'Recipe approval', status: pendingApprovals > 0 ? String(pendingApprovals) + ' pending' : 'Clear', tone: pendingApprovals > 0 ? 'warn' : 'ok' },
        { stage: 'Production', status: orders.filter((o) => o.status === 'IN_PROGRESS').length + ' in progress', tone: 'info' },
        { stage: 'Inventory', status: lowStock.length + ' below reorder', tone: lowStock.length ? 'warn' : 'ok' },
        { stage: 'Sales tax ' + period, status: tax.position, tone: tax.netPayable > 0 ? 'warn' : 'ok' },
      ],
    },
  });
});
