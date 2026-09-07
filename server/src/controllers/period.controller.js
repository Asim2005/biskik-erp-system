import { z } from 'zod';
import { FiscalPeriod } from '../models/FiscalPeriod.js';
import { JournalEntry } from '../models/JournalEntry.js';
import { PurchaseOrder } from '../models/PurchaseOrder.js';
import { Grn } from '../models/Grn.js';
import { Invoice } from '../models/Invoice.js';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';
import { ensurePeriod, listPeriods, summariseClose } from '../services/periods.js';
import { financialSummary, trialBalance } from '../services/accounting.js';
import { round2 } from '../utils/money.js';

export const closeSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must look like 2026-08'),
  notes: z.string().optional().default(''),
  force: z.boolean().optional().default(false),
});

export const reopenSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  reason: z.string().min(5, 'Give a reason for reopening a closed period'),
});

export const listFiscalPeriods = asyncHandler(async (req, res) => {
  const periods = await listPeriods(Number(req.query.count) || 12);
  res.json({ data: periods });
});

/**
 * Pre-close checklist.
 *
 * Everything that would make a signed-off trial balance misleading:
 * an unbalanced ledger, production still sitting in WIP, goods received but
 * never invoiced, draft invoices nobody posted.
 */
export const closeChecklist = asyncHandler(async (req, res) => {
  const period = req.params.period;
  const [year, month] = period.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  const range = { from: start, to: end };

  const [tb, fin, openProduction, unmatchedGrns, draftInvoices, pendingPos] = await Promise.all([
    trialBalance(range),
    financialSummary(range),
    ProductionOrder.countDocuments({ status: 'IN_PROGRESS' }),
    Grn.countDocuments({ status: 'POSTED', matched: false }),
    Invoice.countDocuments({ status: 'DRAFT', date: { $gte: start, $lte: end } }),
    PurchaseOrder.countDocuments({ status: 'PENDING_APPROVAL' }),
  ]);

  const entriesInPeriod = await JournalEntry.countDocuments({
    status: 'POSTED',
    date: { $gte: start, $lte: end },
  });
  const adjustingEntries = await JournalEntry.countDocuments({
    status: 'POSTED',
    isAdjusting: true,
    date: { $gte: start, $lte: end },
  });

  const balanced = Math.abs(tb.totalDebit - tb.totalCredit) < 0.01;
  const wipRow = tb.rows.find((r) => r.code === '1202');
  const wipBalance = round2(wipRow?.net || 0);

  const checks = [
    {
      key: 'balanced',
      label: 'Trial balance is in balance',
      ok: balanced,
      detail: 'Dr ' + tb.totalDebit.toLocaleString() + ' vs Cr ' + tb.totalCredit.toLocaleString(),
      blocking: true,
    },
    {
      key: 'production',
      label: 'No production orders still open in WIP',
      ok: openProduction === 0,
      detail: openProduction + ' order(s) in progress; WIP balance Rs. ' + wipBalance.toLocaleString(),
      blocking: false,
    },
    {
      key: 'grni',
      label: 'All goods received have been invoiced',
      ok: unmatchedGrns === 0,
      detail: unmatchedGrns + ' goods receipt(s) still sitting in GRNI',
      blocking: false,
    },
    {
      key: 'drafts',
      label: 'No unposted invoices dated in this period',
      ok: draftInvoices === 0,
      detail: draftInvoices + ' draft invoice(s)',
      blocking: false,
    },
    {
      key: 'pos',
      label: 'No purchase orders stuck awaiting approval',
      ok: pendingPos === 0,
      detail: pendingPos + ' purchase order(s) pending approval',
      blocking: false,
    },
    {
      key: 'entries',
      label: 'Period has activity to close',
      ok: entriesInPeriod > 0,
      detail: entriesInPeriod + ' journal entries, ' + adjustingEntries + ' of them adjusting',
      blocking: false,
    },
  ];

  res.json({
    data: {
      period,
      checks,
      canClose: checks.filter((c) => c.blocking).every((c) => c.ok),
      warnings: checks.filter((c) => !c.ok && !c.blocking).length,
      trialBalance: { totalDebit: tb.totalDebit, totalCredit: tb.totalCredit, balanced },
      financials: {
        revenue: fin.revenue,
        cogs: fin.cogs,
        grossProfit: fin.grossProfit,
        totalExpenses: fin.totalExpenses,
        netProfit: fin.netProfit,
      },
      entriesInPeriod,
      adjustingEntries,
    },
  });
});

export const closePeriod = asyncHandler(async (req, res) => {
  const key = req.body.period;
  const period = await ensurePeriod(key);
  if (period.status === 'CLOSED') throw ApiError.badRequest('Period ' + key + ' is already closed');

  const [year, month] = key.split('-').map(Number);
  const range = { from: new Date(year, month - 1, 1), to: new Date(year, month, 0, 23, 59, 59) };

  const tb = await trialBalance(range);
  if (Math.abs(tb.totalDebit - tb.totalCredit) > 0.01 && !req.body.force) {
    throw ApiError.badRequest(
      'Cannot close ' + key + ': the trial balance is out by Rs. ' +
        round2(tb.totalDebit - tb.totalCredit).toLocaleString() + '. Fix it before closing.'
    );
  }

  const fin = await financialSummary(range);
  Object.assign(period, summariseClose(tb, fin), {
    status: 'CLOSED',
    closedBy: req.user._id,
    closedAt: new Date(),
    notes: req.body.notes,
  });
  await period.save();

  recordAudit(req, {
    action: 'period.close',
    entity: 'FiscalPeriod',
    entityId: period._id,
    entityCode: key,
    detail:
      'Closed by ' + req.user.name + '; TB Dr ' + tb.totalDebit + ' Cr ' + tb.totalCredit +
      '; net profit ' + fin.netProfit,
  });

  res.json({
    data: period,
    message: 'Period ' + key + ' is closed. Nothing can post into it until it is reopened.',
  });
});

export const reopenPeriod = asyncHandler(async (req, res) => {
  const key = req.body.period;
  const period = await FiscalPeriod.findOne({ period: key });
  if (!period) throw ApiError.notFound('Period ' + key + ' does not exist');
  if (period.status !== 'CLOSED') throw ApiError.badRequest('Period ' + key + ' is already open');

  period.status = 'OPEN';
  period.reopenedBy = req.user._id;
  period.reopenedAt = new Date();
  period.reopenReason = req.body.reason;
  await period.save();

  recordAudit(req, {
    action: 'period.reopen',
    entity: 'FiscalPeriod',
    entityId: period._id,
    entityCode: key,
    detail: req.body.reason,
  });

  res.json({ data: period, message: 'Period ' + key + ' reopened - the audit trail records why.' });
});

/**
 * Trial balance in three columns: as posted, adjustments, and adjusted.
 * This is the bridge from the raw ledger to the financial statements.
 */
export const adjustedTrialBalance = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const range = {};
  if (from) range.from = from;
  if (to) range.to = to;

  const match = { status: 'POSTED' };
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = new Date(from);
    if (to) match.date.$lte = new Date(to);
  }

  const adjustingAgg = await JournalEntry.aggregate([
    { $match: { ...match, isAdjusting: true } },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.accountCode',
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' },
      },
    },
  ]);
  const adjustments = new Map(adjustingAgg.map((a) => [a._id, a]));

  const full = await trialBalance(range);

  const rows = full.rows.map((r) => {
    const adj = adjustments.get(r.code) || { debit: 0, credit: 0 };
    const adjNet = round2(adj.debit - adj.credit);
    const unadjustedNet = round2(r.net - adjNet);
    return {
      code: r.code,
      name: r.name,
      type: r.type,
      unadjustedDebit: unadjustedNet > 0 ? unadjustedNet : 0,
      unadjustedCredit: unadjustedNet < 0 ? round2(-unadjustedNet) : 0,
      adjustmentDebit: round2(adj.debit),
      adjustmentCredit: round2(adj.credit),
      adjustedDebit: r.balanceDebit,
      adjustedCredit: r.balanceCredit,
      hasAdjustment: Math.abs(adjNet) > 0.001,
    };
  });

  res.json({
    data: rows,
    summary: {
      unadjustedDebit: round2(rows.reduce((s, r) => s + r.unadjustedDebit, 0)),
      unadjustedCredit: round2(rows.reduce((s, r) => s + r.unadjustedCredit, 0)),
      adjustmentDebit: round2(rows.reduce((s, r) => s + r.adjustmentDebit, 0)),
      adjustmentCredit: round2(rows.reduce((s, r) => s + r.adjustmentCredit, 0)),
      adjustedDebit: full.totalDebit,
      adjustedCredit: full.totalCredit,
      balanced: Math.abs(full.totalDebit - full.totalCredit) < 0.01,
      accountsAdjusted: rows.filter((r) => r.hasAdjustment).length,
    },
  });
});

/** Income statement and balance sheet, built from the adjusted ledger. */
export const financialStatements = asyncHandler(async (req, res) => {
  const range = {};
  if (req.query.from) range.from = req.query.from;
  if (req.query.to) range.to = req.query.to;

  const fin = await financialSummary(range);
  const rows = fin.trialBalance.rows;
  const byType = (t) => rows.filter((r) => r.type === t);

  const group = (list) =>
    list.map((r) => ({ code: r.code, name: r.name, subType: r.subType, amount: round2(Math.abs(r.net)) }));

  const assets = group(byType('ASSET'));
  const liabilities = group(byType('LIABILITY'));
  const equity = group(byType('EQUITY'));
  const income = group(byType('INCOME'));
  const expenses = group(byType('EXPENSE'));

  const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
  const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0));
  const retained = fin.netProfit;

  res.json({
    data: {
      incomeStatement: {
        revenue: income,
        totalRevenue: fin.revenue,
        cogs: fin.cogs,
        grossProfit: fin.grossProfit,
        expenses: expenses.filter((e) => e.code !== '5001'),
        totalExpenses: round2(fin.totalExpenses - fin.cogs),
        netProfit: fin.netProfit,
      },
      balanceSheet: {
        assets,
        totalAssets,
        liabilities,
        totalLiabilities,
        equity,
        totalEquity,
        retainedEarnings: retained,
        totalEquityAndLiabilities: round2(totalLiabilities + totalEquity + retained),
        /** assets should equal liabilities + equity + profit for the period */
        balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity + retained)) < 1,
        difference: round2(totalAssets - (totalLiabilities + totalEquity + retained)),
      },
    },
  });
});
