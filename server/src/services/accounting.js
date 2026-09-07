import { Account } from '../models/Account.js';
import { JournalEntry } from '../models/JournalEntry.js';
import { nextCode } from '../utils/numbering.js';
import { ApiError } from '../utils/apiError.js';
import { round2 } from '../utils/money.js';
import { assertPeriodOpen } from './periods.js';

/** Well-known account codes the automatic postings rely on. */
export const ACC = {
  RAW_MATERIAL: '1201',
  WIP: '1202',
  FINISHED_GOODS: '1203',
  RECEIVABLE: '1101',
  CASH: '1001',
  BANK: '1002',
  INPUT_TAX: '1301',
  PAYABLE: '2101',
  OUTPUT_TAX: '2201',
  ACCRUED_PAYROLL: '2102',
  GRNI: '2103',
  SHARE_CAPITAL: '3001',
  RETAINED: '3002',
  SALES: '4001',
  COGS: '5001',
  DIRECT_LABOUR: '5101',
  FACTORY_OVERHEAD: '5102',
  MATERIAL_USAGE_VARIANCE: '5201',
  MATERIAL_PRICE_VARIANCE: '5202',
  LABOUR_VARIANCE: '5203',
  OVERHEAD_VARIANCE: '5204',
  YIELD_LOSS: '5205',
  ADMIN_EXPENSE: '5301',
  MARKETING_EXPENSE: '5302',
};

/**
 * Accounts are looked up fresh on every posting rather than cached.
 * `code` is uniquely indexed, so this is a single cheap lookup, and it means a
 * chart of accounts edited elsewhere (another process, a re-seed) can never
 * leave this process writing journal lines against stale account ids.
 */
export async function accountByCode(code) {
  const acc = await Account.findOne({ code });
  if (!acc) throw ApiError.badRequest('Chart of accounts is missing account ' + code + '. Run the seed script.');
  return acc;
}

/** Kept for call-site compatibility; there is no cache to clear any more. */
export function clearAccountCache() {}

/**
 * Posts a balanced journal entry.
 * @param {Array<{code:string, debit?:number, credit?:number, description?:string}>} rawLines
 */
export async function postJournal({ date, narration, rawLines, refType, refId, refCode, userId, system = true, isAdjusting = false, skipPeriodCheck = false }) {
  const when = date || new Date();
  if (!skipPeriodCheck) await assertPeriodOpen(when, 'this journal entry');

  const lines = [];
  for (const l of rawLines) {
    const debit = round2(l.debit || 0);
    const credit = round2(l.credit || 0);
    if (debit === 0 && credit === 0) continue;
    const acc = await accountByCode(l.code);
    lines.push({
      account: acc._id,
      accountCode: acc.code,
      accountName: acc.name,
      debit,
      credit,
      description: l.description || '',
    });
  }
  if (!lines.length) throw ApiError.badRequest('Journal entry has no lines with a value');

  const code = await nextCode('JE');
  return JournalEntry.create({
    code,
    date: when,
    narration,
    lines,
    status: 'POSTED',
    refType: refType || 'Manual',
    refId,
    refCode: refCode || '',
    isSystemGenerated: system,
    isAdjusting,
    createdBy: userId,
    postedAt: new Date(),
  });
}

/** Trial balance across all posted entries, plus opening balances. */
export async function trialBalance({ from, to } = {}) {
  const match = { status: 'POSTED' };
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = new Date(from);
    if (to) match.date.$lte = new Date(to);
  }

  const agg = await JournalEntry.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.account',
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' },
      },
    },
  ]);

  const byAccount = new Map(agg.map((a) => [String(a._id), a]));
  const accounts = await Account.find({ isActive: true }).sort({ code: 1 }).lean();

  const rows = accounts.map((a) => {
    const m = byAccount.get(String(a._id)) || { debit: 0, credit: 0 };
    const opening = a.openingBalance || 0;
    const openingDr = a.normalBalance === 'DEBIT' ? opening : 0;
    const openingCr = a.normalBalance === 'CREDIT' ? opening : 0;
    const debit = round2(m.debit + openingDr);
    const credit = round2(m.credit + openingCr);
    const net = round2(debit - credit);
    return {
      accountId: a._id,
      code: a.code,
      name: a.name,
      type: a.type,
      subType: a.subType,
      normalBalance: a.normalBalance,
      debit,
      credit,
      balanceDebit: net > 0 ? net : 0,
      balanceCredit: net < 0 ? round2(-net) : 0,
      net,
    };
  });

  const active = rows.filter((r) => r.debit !== 0 || r.credit !== 0);
  return {
    rows: active,
    totalDebit: round2(active.reduce((s, r) => s + r.balanceDebit, 0)),
    totalCredit: round2(active.reduce((s, r) => s + r.balanceCredit, 0)),
  };
}

/** Ledger detail for one account with a running balance. */
export async function accountLedger(accountId, { from, to } = {}) {
  const account = await Account.findById(accountId).lean();
  if (!account) throw ApiError.notFound('Account not found');

  const match = { status: 'POSTED', 'lines.account': account._id };
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = new Date(from);
    if (to) match.date.$lte = new Date(to);
  }

  const entries = await JournalEntry.find(match).sort({ date: 1, createdAt: 1 }).lean();
  let running = account.openingBalance || 0;
  if (account.normalBalance === 'CREDIT') running = -running;

  const rows = [];
  for (const e of entries) {
    for (const l of e.lines.filter((x) => String(x.account) === String(account._id))) {
      running = round2(running + (l.debit || 0) - (l.credit || 0));
      rows.push({
        date: e.date,
        entryCode: e.code,
        narration: l.description || e.narration,
        refType: e.refType,
        refCode: e.refCode,
        debit: l.debit || 0,
        credit: l.credit || 0,
        balance: running,
      });
    }
  }

  return { account, rows, closingBalance: running };
}

/** Income statement + balance sheet roll-up. */
export async function financialSummary(range = {}) {
  const tb = await trialBalance(range);
  const pick = (type) => tb.rows.filter((r) => r.type === type);
  const total = (rows) => round2(rows.reduce((s, r) => s + Math.abs(r.net), 0));

  const income = pick('INCOME');
  const expense = pick('EXPENSE');
  const revenue = total(income);
  const expenses = total(expense);

  const cogsRow = tb.rows.find((r) => r.code === ACC.COGS);
  const cogs = cogsRow ? Math.abs(cogsRow.net) : 0;

  return {
    revenue,
    cogs: round2(cogs),
    grossProfit: round2(revenue - cogs),
    totalExpenses: expenses,
    netProfit: round2(revenue - expenses),
    assets: total(pick('ASSET')),
    liabilities: total(pick('LIABILITY')),
    equity: total(pick('EQUITY')),
    trialBalance: tb,
  };
}
