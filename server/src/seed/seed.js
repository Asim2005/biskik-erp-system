/**
 * Seeds a complete, internally consistent demo company:
 * chart of accounts -> users -> materials -> opening stock -> approved recipe
 * -> a completed production order -> a purchase invoice -> a sales invoice.
 *
 * Every number the UI shows is produced by the same engine the application
 * uses at runtime, so the dashboard, inventory, GL and tax screens agree.
 *
 *   npm run seed
 */
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import { connectDb } from '../config/db.js';
import { ROLES } from '../config/roles.js';

import { User } from '../models/User.js';
import { Counter } from '../models/Counter.js';
import { Material } from '../models/Material.js';
import { Stock } from '../models/Stock.js';
import { StockMovement } from '../models/StockMovement.js';
import { Recipe } from '../models/Recipe.js';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { Account } from '../models/Account.js';
import { JournalEntry } from '../models/JournalEntry.js';
import { Party } from '../models/Party.js';
import { Invoice } from '../models/Invoice.js';
import { AuditLog } from '../models/AuditLog.js';
import { Setting } from '../models/Setting.js';
import { PurchaseOrder } from '../models/PurchaseOrder.js';
import { Grn } from '../models/Grn.js';
import { Rfq } from '../models/Rfq.js';
import { FiscalPeriod } from '../models/FiscalPeriod.js';

import { nextCode } from '../utils/numbering.js';
import { round2, round3, round4, sum } from '../utils/money.js';
import { applyRecipeCost, explodeRecipe, recalcProductionOrder } from '../services/costing.js';
import { postMovement } from '../services/inventory.js';
import { ACC, clearAccountCache, postJournal } from '../services/accounting.js';

const log = (...a) => console.log('  ', ...a);

/* -------------------------------------------------------------------------- */
/* the demo timeline                                                          */
/* -------------------------------------------------------------------------- */
/*
 * Every dated document below is placed relative to the day the seed runs, and
 * the whole story - request for quotation, purchase order, goods receipt,
 * production run, sale - spans about a fortnight.
 *
 * Fixed offsets push the early steps into the previous month whenever the
 * seed is run near the start of one, and a dashboard scoped to "this period"
 * then opens on zeros: no production this month, no sales tax, no output.
 * That is accurate and useless.
 *
 * So the fortnight is compressed into however much of the current month has
 * already passed. Order is preserved, and when several steps land on the same
 * day they are separated by hours so the ledger still reads in sequence.
 */
const STORY_SPAN_DAYS = 12;
const seedRunAt = dayjs();
const runwayDays = Math.min(STORY_SPAN_DAYS, seedRunAt.date() - 1);

function daysAgo(n) {
  const scaled = runwayDays === 0 ? 0 : Math.round((n / STORY_SPAN_DAYS) * runwayDays);
  const when = seedRunAt
    .subtract(scaled, 'day')
    .startOf('day')
    .add(8 + (STORY_SPAN_DAYS - n), 'hour');
  // never date a document in the future, however tight the runway
  return (when.isAfter(seedRunAt) ? seedRunAt : when).toDate();
}

/* -------------------------------------------------------------------------- */
/* chart of accounts                                                          */
/* -------------------------------------------------------------------------- */
const CHART = [
  ['1001', 'Cash in Hand', 'ASSET', 'Current Asset'],
  ['1002', 'Bank - Current Account', 'ASSET', 'Current Asset'],
  ['1101', 'Trade Receivables', 'ASSET', 'Current Asset'],
  ['1201', 'Raw Material Inventory', 'ASSET', 'Inventory'],
  ['1202', 'Work in Process', 'ASSET', 'Inventory'],
  ['1203', 'Finished Goods Inventory', 'ASSET', 'Inventory'],
  ['1301', 'Input Sales Tax (recoverable)', 'ASSET', 'Tax'],
  ['1401', 'Plant and Machinery', 'ASSET', 'Fixed Asset'],
  ['2101', 'Trade Payables', 'LIABILITY', 'Current Liability'],
  ['2102', 'Accrued Payroll', 'LIABILITY', 'Current Liability'],
  ['2103', 'Goods Received Not Invoiced', 'LIABILITY', 'Current Liability'],
  ['2201', 'Output Sales Tax Payable', 'LIABILITY', 'Tax'],
  ['3001', 'Share Capital', 'EQUITY', 'Capital'],
  ['3002', 'Retained Earnings', 'EQUITY', 'Capital'],
  ['4001', 'Sales Revenue', 'INCOME', 'Operating Income'],
  ['4002', 'Scrap Sales', 'INCOME', 'Other Income'],
  ['5001', 'Cost of Goods Sold', 'EXPENSE', 'Cost of Sales'],
  ['5101', 'Direct Labour', 'EXPENSE', 'Manufacturing'],
  ['5102', 'Factory Overhead', 'EXPENSE', 'Manufacturing'],
  ['5201', 'Material Usage Variance', 'EXPENSE', 'Variance'],
  ['5202', 'Material Price Variance', 'EXPENSE', 'Variance'],
  ['5203', 'Direct Labour Variance', 'EXPENSE', 'Variance'],
  ['5204', 'Factory Overhead Variance', 'EXPENSE', 'Variance'],
  ['5205', 'Yield Loss / Normal Scrap', 'EXPENSE', 'Variance'],
  ['5301', 'Administrative Expenses', 'EXPENSE', 'Operating'],
  ['5302', 'Marketing and Distribution', 'EXPENSE', 'Operating'],
];

const USERS = [
  ['System Administrator', 'admin@biscuiterp.pk', 'Admin@123', ROLES.ADMIN, 'IT'],

  ['Usman Tariq', 'procurement@biscuiterp.pk', 'Procure@123', ROLES.PROCUREMENT_OFFICER, 'Procurement'],
  ['Farhan Malik', 'procurement.manager@biscuiterp.pk', 'Procure@456', ROLES.PROCUREMENT_MANAGER, 'Procurement'],

  ['Kamran Ali', 'warehouse@biscuiterp.pk', 'Store@123', ROLES.WAREHOUSE_OFFICER, 'Warehouse'],
  ['Zubair Khan', 'warehouse.manager@biscuiterp.pk', 'Store@456', ROLES.WAREHOUSE_MANAGER, 'Warehouse'],

  ['Ahmed Nawaz', 'production.officer@biscuiterp.pk', 'Produce@123', ROLES.PRODUCTION_OFFICER, 'Production'],
  ['Bilal Ahmed', 'production@biscuiterp.pk', 'Production@123', ROLES.PRODUCTION_MANAGER, 'Production'],

  ['Dr. Sana Yousaf', 'qa@biscuiterp.pk', 'Qa@123456', ROLES.QA_OFFICER, 'R&D / QA'],

  ['Hassan Raza', 'sales@biscuiterp.pk', 'Sales@123', ROLES.SALES_OFFICER, 'Sales'],
  ['Nadia Iqbal', 'sales.manager@biscuiterp.pk', 'Sales@456', ROLES.SALES_MANAGER, 'Sales'],

  ['Junaid Aslam', 'junior.accountant@biscuiterp.pk', 'Junior@123', ROLES.JUNIOR_ACCOUNTANT, 'Finance'],
  ['Saima Rauf', 'senior.accountant@biscuiterp.pk', 'Senior@123', ROLES.SENIOR_ACCOUNTANT, 'Finance'],
  ['Ayesha Siddiqui', 'finance@biscuiterp.pk', 'Finance@123', ROLES.FINANCE_MANAGER, 'Finance'],
  ['Imran Sheikh', 'controller@biscuiterp.pk', 'Control@123', ROLES.CONTROLLER, 'Finance'],

  ['Audit Viewer', 'viewer@biscuiterp.pk', 'Viewer@123', ROLES.VIEWER, 'Audit'],
];

const MATERIALS = [
  ['RM-0001', 'Wheat Flour (Maida)', 'RAW', 'KG', 150, 500, 18, 'RM Store'],
  ['RM-0002', 'Refined Sugar', 'RAW', 'KG', 180, 200, 18, 'RM Store'],
  ['RM-0003', 'Palm Oil / Shortening', 'RAW', 'KG', 500, 150, 18, 'RM Store'],
  ['RM-0004', 'Chocolate Cream Filling', 'RAW', 'KG', 400, 300, 18, 'RM Store'],
  ['RM-0005', 'Vanilla Flavour', 'RAW', 'KG', 2000, 5, 18, 'RM Store'],
  ['RM-0006', 'Baking Powder', 'RAW', 'KG', 320, 20, 18, 'RM Store'],
  ['RM-0007', 'Skimmed Milk Powder', 'RAW', 'KG', 950, 50, 18, 'RM Store'],
  ['RM-0008', 'Iodised Salt', 'RAW', 'KG', 60, 25, 18, 'RM Store'],
  ['PK-0001', 'Printed Wrapper', 'PACKAGING', 'PCS', 0.8, 20000, 18, 'Packaging Store'],
  ['PK-0002', 'Export Carton', 'PACKAGING', 'PCS', 30, 500, 18, 'Packaging Store'],
  ['PK-0003', 'Carton Tape Roll', 'CONSUMABLE', 'PCS', 55, 40, 18, 'Packaging Store'],
  ['FG-0001', 'Chocolate Cream Biscuit', 'FINISHED', 'PCS', 0, 0, 18, 'Finished Goods'],
  ['FG-0002', 'Vanilla Sandwich Biscuit', 'FINISHED', 'PCS', 0, 0, 18, 'Finished Goods'],
];

/** Opening stock: qty and the rate it came in at (drives moving average). */
const OPENING_STOCK = [
  ['RM-0001', 2400, 152],
  ['RM-0002', 900, 178],
  ['RM-0003', 600, 505],
  ['RM-0004', 1400, 404],
  ['RM-0005', 25, 2000],
  ['RM-0006', 60, 320],
  ['RM-0007', 120, 950],
  ['RM-0008', 80, 60],
  ['PK-0001', 260000, 0.82],
  ['PK-0002', 5200, 30],
  ['PK-0003', 90, 55],
];

/* -------------------------------------------------------------------------- */

async function wipe() {
  const models = [
    User, Counter, Material, Stock, StockMovement, Recipe, ProductionOrder,
    Account, JournalEntry, Party, Invoice, AuditLog, Setting,
    PurchaseOrder, Grn, Rfq, FiscalPeriod,
  ];
  for (const m of models) await m.deleteMany({});
  clearAccountCache();
  log('cleared existing collections');
}

async function seedAccounts() {
  const docs = CHART.map(([code, name, type, subType]) => ({
    code,
    name,
    type,
    subType,
    normalBalance: ['ASSET', 'EXPENSE'].includes(type) ? 'DEBIT' : 'CREDIT',
    isSystem: true,
  }));
  await Account.insertMany(docs);
  log('chart of accounts:', docs.length, 'accounts');
}

async function seedUsers() {
  const created = [];
  for (const [name, email, password, role, department] of USERS) {
    const u = new User({ name, email, role, department, isActive: true });
    await u.setPassword(password);
    await u.save();
    created.push(u);
  }
  log('users:', created.length);
  const byRole = (role) => created.find((u) => u.role === role);
  return {
    admin: byRole(ROLES.ADMIN),
    procurement: byRole(ROLES.PROCUREMENT_OFFICER),
    procurementManager: byRole(ROLES.PROCUREMENT_MANAGER),
    warehouse: byRole(ROLES.WAREHOUSE_OFFICER),
    warehouseManager: byRole(ROLES.WAREHOUSE_MANAGER),
    store: byRole(ROLES.WAREHOUSE_OFFICER),
    productionOfficer: byRole(ROLES.PRODUCTION_OFFICER),
    production: byRole(ROLES.PRODUCTION_MANAGER),
    qa: byRole(ROLES.QA_OFFICER),
    sales: byRole(ROLES.SALES_OFFICER),
    salesManager: byRole(ROLES.SALES_MANAGER),
    juniorAccountant: byRole(ROLES.JUNIOR_ACCOUNTANT),
    seniorAccountant: byRole(ROLES.SENIOR_ACCOUNTANT),
    finance: byRole(ROLES.FINANCE_MANAGER),
    controller: byRole(ROLES.CONTROLLER),
    viewer: byRole(ROLES.VIEWER),
  };
}

async function seedMaterials() {
  const docs = MATERIALS.map(([code, name, category, uom, standardRate, reorderLevel, taxRate, defaultLocation]) => ({
    code,
    name,
    category,
    uom,
    standardRate,
    movingAvgRate: standardRate,
    reorderLevel,
    taxRate,
    defaultLocation,
    isActive: true,
  }));
  await Material.insertMany(docs);
  const all = await Material.find();
  const byCode = new Map(all.map((m) => [m.code, m]));
  log('materials:', all.length);
  return byCode;
}

async function seedOpeningStock(byCode, user) {
  let total = 0;
  for (const [code, qty, rate] of OPENING_STOCK) {
    const mat = byCode.get(code);
    const { value } = await postMovement({
      material: mat,
      type: 'OPENING',
      qty,
      rate,
      refType: 'Opening',
      refCode: 'OPENING',
      remarks: 'Opening stock brought forward',
      userId: user._id,
    });
    total = round2(total + value);
  }

  await postJournal({
    narration: 'Opening stock brought forward',
    rawLines: [
      { code: ACC.RAW_MATERIAL, debit: total, description: 'Opening raw material and packaging' },
      { code: ACC.SHARE_CAPITAL, credit: total, description: 'Capital introduced as stock' },
    ],
    refType: 'Opening',
    refCode: 'OPENING',
    userId: user._id,
  });

  // a little working capital so the balance sheet is not all inventory
  await postJournal({
    narration: 'Capital introduced in bank',
    rawLines: [
      { code: ACC.BANK, debit: 2500000, description: 'Cash capital' },
      { code: ACC.SHARE_CAPITAL, credit: 2500000, description: 'Share capital' },
    ],
    refType: 'Opening',
    refCode: 'OPENING',
    userId: user._id,
  });

  log('opening stock value: Rs.', total.toLocaleString());
  return total;
}

async function seedRecipe(byCode, users) {
  const spec = [
    ['RM-0001', 8, 1],
    ['RM-0002', 3, 0],
    ['RM-0003', 2, 0],
    ['RM-0004', 5, 2],
    ['RM-0005', 0.1, 0],
    ['RM-0006', 0.15, 0],
    ['RM-0007', 0.4, 0],
    ['RM-0008', 0.05, 0],
    ['PK-0001', 1000, 1],
    ['PK-0002', 20, 0],
  ];

  const lines = spec.map(([code, qty, wastagePercent]) => {
    const m = byCode.get(code);
    return {
      material: m._id,
      materialCode: m.code,
      materialName: m.name,
      qty,
      uom: m.uom,
      rate: m.standardRate,
      wastagePercent,
      lineCost: 0,
      remarks: '',
    };
  });

  const code = await nextCode('REC');
  const recipe = new Recipe({
    code,
    version: '1.0',
    versionNo: 1,
    productName: 'Chocolate Cream Biscuit',
    product: byCode.get('FG-0001')._id,
    baseBatchQty: 1000,
    baseBatchUom: 'PCS',
    yieldPercent: 98,
    lines,
    labourCostPerUnit: 0.32,
    factoryOverheadPerUnit: 0.68,
    adminOverheadPerUnit: 0.25,
    marketingOverheadPerUnit: 0.3,
    status: 'APPROVED',
    preparedBy: users.qa._id,
    submittedBy: users.qa._id,
    submittedAt: daysAgo(6),
    approvedBy: users.finance._id,
    approvedAt: daysAgo(5),
    effectiveDate: daysAgo(5),
    changeNote: 'Initial approved formula',
  });
  applyRecipeCost(recipe);
  await recipe.save();
  log('recipe', recipe.code, 'v1.0 approved -', 'Rs.', recipe.materialCostPerUnit, '/ unit material');

  // a second version sitting in the approval queue, to demonstrate the workflow
  const v2 = new Recipe({
    ...recipe.toObject(),
    _id: undefined,
    versionNo: 2,
    version: '2.0',
    status: 'PENDING_APPROVAL',
    parent: recipe._id,
    preparedBy: users.qa._id,
    submittedBy: users.qa._id,
    submittedAt: new Date(),
    approvedBy: undefined,
    approvedAt: undefined,
    effectiveDate: undefined,
    changeNote: 'Cream reduced from 5.0 to 4.6 KG per batch after the panel tasting',
    createdAt: undefined,
    updatedAt: undefined,
  });
  const creamLine = v2.lines.find((l) => l.materialCode === 'RM-0004');
  creamLine.qty = 4.6;
  applyRecipeCost(v2);
  await v2.save();
  log('recipe', v2.code, 'v2.0 pending approval');

  // a second product, still a draft
  const vanillaSpec = [
    ['RM-0001', 8.5, 1],
    ['RM-0002', 3.4, 0],
    ['RM-0003', 2.1, 0],
    ['RM-0005', 0.18, 0],
    ['RM-0007', 0.6, 0],
    ['PK-0001', 1000, 1],
    ['PK-0002', 20, 0],
  ];
  const code2 = await nextCode('REC');
  const vanilla = new Recipe({
    code: code2,
    version: '1.0',
    versionNo: 1,
    productName: 'Vanilla Sandwich Biscuit',
    product: byCode.get('FG-0002')._id,
    baseBatchQty: 1000,
    baseBatchUom: 'PCS',
    yieldPercent: 97,
    lines: vanillaSpec.map(([c, qty, w]) => {
      const m = byCode.get(c);
      return {
        material: m._id, materialCode: m.code, materialName: m.name,
        qty, uom: m.uom, rate: m.standardRate, wastagePercent: w, lineCost: 0, remarks: '',
      };
    }),
    labourCostPerUnit: 0.3,
    factoryOverheadPerUnit: 0.65,
    adminOverheadPerUnit: 0.25,
    marketingOverheadPerUnit: 0.3,
    status: 'DRAFT',
    preparedBy: users.qa._id,
    changeNote: 'New line under development',
  });
  applyRecipeCost(vanilla);
  await vanilla.save();
  log('recipe', vanilla.code, 'v1.0 draft (Vanilla Sandwich)');

  return recipe;
}

async function seedProduction(recipe, byCode, users) {
  const plannedQty = 100000;
  const { lines, scaleFactor, cost } = explodeRecipe(recipe, plannedQty);
  const code = await nextCode('PO');
  const startedAt = daysAgo(3);

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
    scheduledDate: startedAt,
    shift: 'A',
    lineNo: 'Line-1',
    status: 'RELEASED',
    lines,
    standardLabourCost: round2(cost.labourCostPerUnit * plannedQty),
    standardOverheadCost: round2(cost.factoryOverheadPerUnit * plannedQty),
    createdBy: users.production._id,
  });
  recalcProductionOrder(order);
  await order.save();

  // --- issue materials (deliberate over-consumption on flour and cream) -----
  const overUse = { 'RM-0001': 1.03, 'RM-0004': 1.02, 'PK-0001': 1.008 };
  for (const line of order.lines) {
    const factor = overUse[line.materialCode] || 1.004;
    const actualQty = round3(line.standardQty * factor);
    const { valuedRate } = await postMovement({
      material: line.material,
      type: 'PRODUCTION_ISSUE',
      qty: actualQty,
      refType: 'ProductionOrder',
      refId: order._id,
      refCode: order.code,
      remarks: 'Issued to ' + order.code,
      date: startedAt,
      userId: users.store._id,
    });
    line.actualQty = actualQty;
    line.actualRate = round4(valuedRate);
    line.issued = true;
  }
  recalcProductionOrder(order);

  const jeIssue = await postJournal({
    date: startedAt,
    narration: 'Material issued to production order ' + order.code,
    rawLines: [
      { code: ACC.WIP, debit: order.actualMaterialCost, description: 'Material consumed - ' + order.code },
      { code: ACC.RAW_MATERIAL, credit: order.actualMaterialCost, description: 'Issued to ' + order.code },
    ],
    refType: 'ProductionOrder',
    refId: order._id,
    refCode: order.code,
    userId: users.store._id,
  });
  order.journalEntries.push(jeIssue._id);
  order.status = 'IN_PROGRESS';
  order.materialsIssuedAt = startedAt;
  order.startedAt = startedAt;
  await order.save();

  // --- complete ------------------------------------------------------------
  const completedAt = daysAgo(2);
  const goodQty = 98500;
  const rejectQty = 900;
  order.goodQty = goodQty;
  order.rejectQty = rejectQty;
  order.actualLabourCost = 34200;   // standard 32,000 - overtime on shift A
  order.actualOverheadCost = 71500; // standard 68,000 - extra oven fuel
  recalcProductionOrder(order);

  const conversion = round2(order.actualLabourCost + order.actualOverheadCost);
  const jeConv = await postJournal({
    date: completedAt,
    narration: 'Conversion cost absorbed into WIP for ' + order.code,
    rawLines: [
      { code: ACC.WIP, debit: conversion, description: 'Labour and factory overhead - ' + order.code },
      { code: ACC.ACCRUED_PAYROLL, credit: order.actualLabourCost, description: 'Direct labour accrued' },
      { code: ACC.FACTORY_OVERHEAD, credit: order.actualOverheadCost, description: 'Factory overhead applied' },
    ],
    refType: 'ProductionOrder',
    refId: order._id,
    refCode: order.code,
    userId: users.production._id,
  });

  const stdUnit = order.standardUnitCost;
  const fgValue = round2(goodQty * stdUnit);
  const yieldLossUnits = round3(order.plannedQty - goodQty);
  const yieldLossValue = round2(yieldLossUnits * stdUnit);
  const usageVar = round2(sum(order.lines, (l) => l.usageVarianceCost));
  const priceVar = round2(sum(order.lines, (l) => l.priceVarianceCost));
  const labourVar = round2(order.actualLabourCost - order.standardLabourCost);
  const overheadVar = round2(order.actualOverheadCost - order.standardOverheadCost);

  const varLine = (accCode, amount, description) => {
    if (Math.abs(amount) < 0.01) return null;
    return amount > 0
      ? { code: accCode, debit: round2(amount), description: description + ' (adverse)' }
      : { code: accCode, credit: round2(-amount), description: description + ' (favourable)' };
  };

  const rawLines = [
    { code: ACC.FINISHED_GOODS, debit: fgValue, description: goodQty + ' units at standard ' + stdUnit },
    varLine(ACC.YIELD_LOSS, yieldLossValue, 'Yield loss ' + yieldLossUnits + ' units'),
    varLine(ACC.MATERIAL_USAGE_VARIANCE, usageVar, 'Material usage variance'),
    varLine(ACC.MATERIAL_PRICE_VARIANCE, priceVar, 'Material price variance'),
    varLine(ACC.LABOUR_VARIANCE, labourVar, 'Direct labour variance'),
    varLine(ACC.OVERHEAD_VARIANCE, overheadVar, 'Factory overhead variance'),
    { code: ACC.WIP, credit: order.actualTotalCost, description: 'WIP cleared for ' + order.code },
  ].filter(Boolean);

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
    date: completedAt,
    narration: 'Production completed ' + order.code + ' - ' + goodQty + ' good units',
    rawLines,
    refType: 'ProductionOrder',
    refId: order._id,
    refCode: order.code,
    userId: users.production._id,
  });

  await postMovement({
    material: recipe.product,
    type: 'PRODUCTION_RECEIPT',
    qty: goodQty,
    rate: stdUnit,
    location: 'Finished Goods',
    refType: 'ProductionOrder',
    refId: order._id,
    refCode: order.code,
    remarks: 'Output of ' + order.code,
    date: completedAt,
    userId: users.production._id,
  });

  order.status = 'COMPLETED';
  order.completedAt = completedAt;
  order.completedBy = users.production._id;
  order.journalEntries.push(jeConv._id, jeFg._id);
  await order.save();

  log(
    'production', order.code, '-', goodQty.toLocaleString(), 'good units,',
    'std', order.standardUnitCost, 'vs act', order.actualUnitCost, '/ unit'
  );

  // a second order still open, to give the board something in progress
  const open = await ProductionOrder.create({
    ...order.toObject(),
    _id: undefined,
    code: await nextCode('PO'),
    plannedQty: 50000,
    goodQty: 0,
    rejectQty: 0,
    status: 'RELEASED',
    scheduledDate: new Date(),
    shift: 'B',
    lines: explodeRecipe(recipe, 50000).lines,
    standardLabourCost: round2(cost.labourCostPerUnit * 50000),
    standardOverheadCost: round2(cost.factoryOverheadPerUnit * 50000),
    actualLabourCost: 0,
    actualOverheadCost: 0,
    journalEntries: [],
    materialsIssuedAt: undefined,
    startedAt: undefined,
    completedAt: undefined,
    completedBy: undefined,
    createdAt: undefined,
    updatedAt: undefined,
  });
  recalcProductionOrder(open);
  await open.save();
  log('production', open.code, '- released, awaiting material issue');

  return order;
}


/* -------------------------------------------------------------------------- */
/* Procurement -> Warehouse: RFQ -> PO -> approval -> GRN -> matched invoice   */
/* -------------------------------------------------------------------------- */

async function seedProcurement(byCode, parties, users) {
  const taxRate = 18;
  const flour = byCode.get('RM-0001');
  const sugar = byCode.get('RM-0002');

  /* --------------------------------- RFQ --------------------------------- */
  const rfq = await Rfq.create({
    code: await nextCode('RFQ'),
    title: 'Q3 flour and sugar supply',
    date: daysAgo(12),
    closingDate: daysAgo(9),
    suppliers: parties.suppliers.map((x) => x._id),
    status: 'OPEN',
    createdBy: users.procurement._id,
    lines: [
      {
        material: flour._id, materialCode: flour.code, materialName: flour.name, uom: flour.uom, qty: 2000,
        quotes: [
          { supplier: parties.suppliers[0]._id, supplierName: parties.suppliers[0].name, rate: 154, leadTimeDays: 5 },
          { supplier: parties.suppliers[2]._id, supplierName: parties.suppliers[2].name, rate: 158, leadTimeDays: 3 },
        ],
      },
      {
        material: sugar._id, materialCode: sugar.code, materialName: sugar.name, uom: sugar.uom, qty: 800,
        quotes: [
          { supplier: parties.suppliers[0]._id, supplierName: parties.suppliers[0].name, rate: 181, leadTimeDays: 5 },
          { supplier: parties.suppliers[2]._id, supplierName: parties.suppliers[2].name, rate: 179, leadTimeDays: 4 },
        ],
      },
    ],
  });
  log('rfq', rfq.code, '- 2 items quoted by 2 suppliers');

  /* ------------------------- approved purchase order --------------------- */
  const supplier = parties.suppliers[0];
  const poLines = [
    { material: flour, qty: 2000, rate: 154 },
    { material: sugar, qty: 800, rate: 181 },
  ].map((x) => {
    const amount = round2(x.qty * x.rate);
    const taxAmount = round2((amount * taxRate) / 100);
    return {
      material: x.material._id,
      materialCode: x.material.code,
      materialName: x.material.name,
      uom: x.material.uom,
      qty: x.qty,
      rate: x.rate,
      taxRate,
      amount,
      taxAmount,
      lineTotal: round2(amount + taxAmount),
      receivedQty: 0,
      invoicedQty: 0,
    };
  });

  const po = await PurchaseOrder.create({
    code: await nextCode('PO-P'),
    supplier: supplier._id,
    supplierName: supplier.name,
    date: daysAgo(8),
    expectedDate: daysAgo(5),
    reference: 'Awarded from ' + rfq.code,
    rfq: rfq._id,
    lines: poLines,
    subtotal: round2(sum(poLines, (l) => l.amount)),
    taxTotal: round2(sum(poLines, (l) => l.taxAmount)),
    grandTotal: round2(sum(poLines, (l) => l.lineTotal)),
    status: 'APPROVED',
    deliveryLocation: 'RM Store',
    createdBy: users.procurement._id,
    submittedBy: users.procurement._id,
    submittedAt: daysAgo(8),
    approvedBy: users.procurementManager._id,
    approvedAt: daysAgo(7),
  });

  rfq.status = 'AWARDED';
  rfq.awardedTo = supplier._id;
  rfq.awardedPurchaseOrder = po._id;
  await rfq.save();
  log('purchase order', po.code, 'Rs.', po.grandTotal.toLocaleString(), 'approved by', users.procurementManager.name);

  /* ------------------------------ goods receipt -------------------------- */
  const grnDate = daysAgo(6);
  const grnLines = po.lines.map((l) => {
    // the flour delivery arrived 40 KG short, and 10 KG was rejected at the gate
    const received = l.materialCode === 'RM-0001' ? 1960 : l.qty;
    const rejected = l.materialCode === 'RM-0001' ? 10 : 0;
    const accepted = round3(received - rejected);
    return {
      material: l.material,
      materialCode: l.materialCode,
      materialName: l.materialName,
      uom: l.uom,
      orderedQty: l.qty,
      previouslyReceived: 0,
      receivedQty: received,
      acceptedQty: accepted,
      rejectedQty: rejected,
      rate: l.rate,
      value: round2(accepted * l.rate),
      qcStatus: rejected > 0 ? 'PARTIAL' : 'PASSED',
      batchNo: 'B-4471',
      remarks: rejected > 0 ? 'Torn bags rejected at the gate' : '',
    };
  });

  const totalValue = round2(sum(grnLines, (l) => l.value));
  const grn = await Grn.create({
    code: await nextCode('GRN'),
    purchaseOrder: po._id,
    purchaseOrderCode: po.code,
    supplier: supplier._id,
    supplierName: supplier.name,
    date: grnDate,
    location: 'RM Store',
    deliveryNote: 'PFM-DN-4471',
    vehicleNo: 'LES-8823',
    lines: grnLines,
    totalValue,
    totalAccepted: round3(sum(grnLines, (l) => l.acceptedQty)),
    totalRejected: round3(sum(grnLines, (l) => l.rejectedQty)),
    status: 'DRAFT',
    receivedBy: users.warehouse._id,
  });

  for (const line of grnLines) {
    await postMovement({
      material: line.material,
      type: 'PURCHASE_RECEIPT',
      qty: line.acceptedQty,
      rate: line.rate,
      location: 'RM Store',
      refType: 'Grn',
      refId: grn._id,
      refCode: grn.code,
      remarks: 'Received against ' + po.code,
      date: grnDate,
      userId: users.warehouse._id,
    });
  }

  const jeGrn = await postJournal({
    date: grnDate,
    narration: 'Goods received ' + grn.code + ' against ' + po.code + ' from ' + supplier.name,
    rawLines: [
      { code: ACC.RAW_MATERIAL, debit: totalValue, description: 'Materials received into RM Store' },
      { code: ACC.GRNI, credit: totalValue, description: 'Goods received not invoiced - ' + supplier.name },
    ],
    refType: 'Grn',
    refId: grn._id,
    refCode: grn.code,
    userId: users.warehouse._id,
  });

  grn.status = 'POSTED';
  grn.postedAt = new Date();
  grn.journalEntry = jeGrn._id;
  await grn.save();

  for (const line of grnLines) {
    const poLine = po.lines.find((l) => l.materialCode === line.materialCode);
    if (poLine) poLine.receivedQty = line.acceptedQty;
  }
  po.status = po.receiptState();
  await po.save();
  log('goods receipt', grn.code, 'Rs.', totalValue.toLocaleString(), 'into GRNI;', po.code, 'is now', po.status);

  /* ------------------- supplier invoice, three-way matched --------------- */
  const invDate = daysAgo(4);
  const invLines = grnLines.map((l) => {
    const amount = round2(l.acceptedQty * l.rate);
    const tax = round2((amount * taxRate) / 100);
    return {
      material: l.material,
      materialCode: l.materialCode,
      materialName: l.materialName,
      uom: l.uom,
      qty: l.acceptedQty,
      rate: l.rate,
      discountPercent: 0,
      amount,
      taxRate,
      taxAmount: tax,
      lineTotal: round2(amount + tax),
    };
  });

  const subtotal = round2(sum(invLines, (l) => l.amount));
  const taxTotal = round2(sum(invLines, (l) => l.taxAmount));

  const invoice = await Invoice.create({
    code: await nextCode('PINV'),
    kind: 'PURCHASE',
    party: supplier._id,
    partyName: supplier.name,
    date: invDate,
    reference: 'PFM-INV-9012',
    purchaseOrder: po._id,
    purchaseOrderCode: po.code,
    grns: [grn._id],
    lines: invLines,
    subtotal,
    taxTotal,
    grandTotal: round2(subtotal + taxTotal),
    status: 'DRAFT',
    createdBy: users.juniorAccountant._id,
  });

  const jeInv = await postJournal({
    date: invDate,
    narration: 'Purchase invoice ' + invoice.code + ' from ' + supplier.name + ' matched to ' + po.code,
    rawLines: [
      { code: ACC.GRNI, debit: totalValue, description: 'Clearing goods received not invoiced' },
      { code: ACC.INPUT_TAX, debit: taxTotal, description: 'Recoverable input sales tax' },
      { code: ACC.PAYABLE, credit: round2(subtotal + taxTotal), description: supplier.name },
    ],
    refType: 'Invoice',
    refId: invoice._id,
    refCode: invoice.code,
    userId: users.juniorAccountant._id,
  });

  invoice.status = 'POSTED';
  invoice.postedAt = new Date();
  invoice.journalEntry = jeInv._id;
  invoice.matchStatus = 'MATCHED';
  invoice.matchVariance = 0;
  await invoice.save();

  grn.matched = true;
  grn.invoice = invoice._id;
  await grn.save();

  await Party.findByIdAndUpdate(supplier._id, { $inc: { balance: invoice.grandTotal } });
  log('supplier invoice', invoice.code, '- three-way matched, GRNI cleared to nil');

  return { rfq, po, grn, invoice };
}

async function seedParties() {
  const rows = [
    ['CUSTOMER', 'Metro Cash and Carry', 'Karachi', '2233445-6', '32-11-2233-445-66', 'FILER', 5000000, 30],
    ['CUSTOMER', 'Al-Fatah Superstore', 'Lahore', '3344556-7', '32-11-3344-556-77', 'FILER', 2000000, 15],
    ['CUSTOMER', 'Shaheen Distributors', 'Multan', '4455667-8', '', 'NON_FILER', 800000, 7],
    ['SUPPLIER', 'Punjab Flour Mills', 'Faisalabad', '5566778-9', '32-11-5566-778-99', 'FILER', 0, 30],
    ['SUPPLIER', 'Indus Packaging (Pvt) Ltd', 'Karachi', '6677889-0', '32-11-6677-889-00', 'FILER', 0, 45],
    ['SUPPLIER', 'Crescent Sugar Traders', 'Lahore', '7788990-1', '', 'FILER', 0, 21],
  ];

  const created = [];
  for (const [type, name, city, ntn, strn, filerStatus, creditLimit, creditDays] of rows) {
    const code = await nextCode(type === 'CUSTOMER' ? 'CUS' : 'SUP', 4);
    created.push(
      await Party.create({ code, type, name, city, ntn, strn, filerStatus, creditLimit, creditDays, isActive: true })
    );
  }
  log('parties:', created.length);
  return {
    customers: created.filter((p) => p.type === 'CUSTOMER'),
    suppliers: created.filter((p) => p.type === 'SUPPLIER'),
  };
}

async function seedInvoices(byCode, parties, users) {
  const taxRate = 18;

  /* ---------------------------- purchase ---------------------------------- */
  const flour = byCode.get('RM-0001');
  const pQty = 1500;
  const pRate = 154;
  const pAmount = round2(pQty * pRate);
  const pTax = round2((pAmount * taxRate) / 100);

  const purchase = await Invoice.create({
    code: await nextCode('PINV'),
    kind: 'PURCHASE',
    party: parties.suppliers[0]._id,
    partyName: parties.suppliers[0].name,
    date: daysAgo(4),
    reference: 'PFM-INV-8841',
    lines: [
      {
        material: flour._id, materialCode: flour.code, materialName: flour.name, uom: flour.uom,
        qty: pQty, rate: pRate, discountPercent: 0, amount: pAmount,
        taxRate, taxAmount: pTax, lineTotal: round2(pAmount + pTax),
      },
    ],
    subtotal: pAmount,
    taxTotal: pTax,
    grandTotal: round2(pAmount + pTax),
    status: 'DRAFT',
    createdBy: users.finance._id,
  });

  await postMovement({
    material: flour,
    type: 'PURCHASE_RECEIPT',
    qty: pQty,
    rate: pRate,
    refType: 'Invoice',
    refId: purchase._id,
    refCode: purchase.code,
    remarks: 'Purchased from ' + purchase.partyName,
    date: purchase.date,
    userId: users.store._id,
  });

  const jeP = await postJournal({
    date: purchase.date,
    narration: 'Purchase invoice ' + purchase.code + ' from ' + purchase.partyName,
    rawLines: [
      { code: ACC.RAW_MATERIAL, debit: pAmount, description: 'Wheat flour received' },
      { code: ACC.INPUT_TAX, debit: pTax, description: 'Recoverable input sales tax' },
      { code: ACC.PAYABLE, credit: round2(pAmount + pTax), description: purchase.partyName },
    ],
    refType: 'Invoice',
    refId: purchase._id,
    refCode: purchase.code,
    userId: users.finance._id,
  });
  purchase.status = 'POSTED';
  purchase.postedAt = new Date();
  purchase.journalEntry = jeP._id;
  await purchase.save();
  await Party.findByIdAndUpdate(parties.suppliers[0]._id, { $inc: { balance: purchase.grandTotal } });

  /* ------------------------------ sales ----------------------------------- */
  const fg = byCode.get('FG-0001');
  const salesSpec = [
    [parties.customers[0], 42000, 10.5, 1],
    [parties.customers[1], 21000, 10.9, 1],
  ];

  const salesDocs = [];
  for (const [customer, qty, rate, agoDays] of salesSpec) {
    const amount = round2(qty * rate);
    const tax = round2((amount * taxRate) / 100);
    const invoice = await Invoice.create({
      code: await nextCode('INV'),
      kind: 'SALES',
      party: customer._id,
      partyName: customer.name,
      date: daysAgo(agoDays),
      reference: 'DO-' + Math.floor(1000 + Math.random() * 8999),
      lines: [
        {
          material: fg._id, materialCode: fg.code, materialName: fg.name, uom: fg.uom,
          qty, rate, discountPercent: 0, amount, taxRate, taxAmount: tax, lineTotal: round2(amount + tax),
        },
      ],
      subtotal: amount,
      taxTotal: tax,
      grandTotal: round2(amount + tax),
      status: 'DRAFT',
      createdBy: users.sales._id,
    });

    const { value: cogs } = await postMovement({
      material: fg,
      type: 'SALE_ISSUE',
      qty,
      location: 'Finished Goods',
      refType: 'Invoice',
      refId: invoice._id,
      refCode: invoice.code,
      remarks: 'Sold to ' + customer.name,
      date: invoice.date,
      userId: users.sales._id,
    });

    const je = await postJournal({
      date: invoice.date,
      narration: 'Sales invoice ' + invoice.code + ' to ' + customer.name,
      rawLines: [
        { code: ACC.RECEIVABLE, debit: invoice.grandTotal, description: customer.name },
        { code: ACC.SALES, credit: amount, description: 'Revenue - ' + invoice.code },
        { code: ACC.OUTPUT_TAX, credit: tax, description: 'Output sales tax' },
        { code: ACC.COGS, debit: cogs, description: 'Cost of goods sold - ' + invoice.code },
        { code: ACC.FINISHED_GOODS, credit: cogs, description: 'Finished goods relieved' },
      ],
      refType: 'Invoice',
      refId: invoice._id,
      refCode: invoice.code,
      userId: users.sales._id,
    });

    invoice.cogsAmount = round2(cogs);
    invoice.grossProfit = round2(amount - cogs);
    invoice.status = 'POSTED';
    invoice.postedAt = new Date();
    invoice.journalEntry = je._id;
    await invoice.save();
    await Party.findByIdAndUpdate(customer._id, { $inc: { balance: invoice.grandTotal } });
    salesDocs.push(invoice);
  }

  /* ---------------------- period operating expenses ----------------------- */
  await postJournal({
    narration: 'Administration and marketing expenses for the period',
    rawLines: [
      { code: ACC.ADMIN_EXPENSE, debit: 185000, description: 'Salaries, utilities, office' },
      { code: ACC.MARKETING_EXPENSE, debit: 96000, description: 'Trade promotion and freight' },
      { code: ACC.BANK, credit: 281000, description: 'Paid from bank' },
    ],
    refType: 'Manual',
    userId: users.finance._id,
  });

  log('invoices: 1 purchase, ' + salesDocs.length + ' sales posted');
  return { purchase, sales: salesDocs };
}

async function seedSettings() {
  await Setting.create({ key: 'company' });
  log('company settings created');
}

/* -------------------------------------------------------------------------- */

async function main() {
  await connectDb();
  console.log('');
  console.log('Seeding Biscuit Manufacturing ERP demo data');
  console.log('-------------------------------------------');

  await wipe();
  await seedSettings();
  await seedAccounts();
  const users = await seedUsers();
  const byCode = await seedMaterials();
  await seedOpeningStock(byCode, users.admin);
  const recipe = await seedRecipe(byCode, users);
  await seedProduction(recipe, byCode, users);
  const parties = await seedParties();
  await seedProcurement(byCode, parties, users);
  await seedInvoices(byCode, parties, users);

  // proof: the books must balance
  const { trialBalance } = await import('../services/accounting.js');
  const tb = await trialBalance();
  const balanced = Math.abs(tb.totalDebit - tb.totalCredit) < 0.01;
  console.log('-------------------------------------------');
  log('trial balance  Dr', tb.totalDebit.toLocaleString(), ' Cr', tb.totalCredit.toLocaleString(), balanced ? '-> BALANCED' : '-> OUT OF BALANCE');

  console.log('');
  console.log('Sign in with any of these accounts:');
  for (const [name, email, password, role] of USERS) {
    console.log('   ' + email.padEnd(28) + password.padEnd(14) + role + '   (' + name + ')');
  }
  console.log('');

  await mongoose.disconnect();
  process.exit(balanced ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSeed failed:', err);
  process.exit(1);
});
