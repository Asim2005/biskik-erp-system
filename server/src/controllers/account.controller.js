import { z } from 'zod';
import { Account, ACCOUNT_TYPES } from '../models/Account.js';
import { JournalEntry } from '../models/JournalEntry.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';
import { accountLedger, clearAccountCache, financialSummary, postJournal, trialBalance } from '../services/accounting.js';

export const accountSchema = z.object({
  code: z.string().min(3, 'Account code is required'),
  name: z.string().min(2),
  type: z.enum(ACCOUNT_TYPES),
  subType: z.string().optional().default(''),
  normalBalance: z.enum(['DEBIT', 'CREDIT']).optional(),
  openingBalance: z.coerce.number().default(0),
  description: z.string().optional().default(''),
  isActive: z.boolean().optional().default(true),
});

export const journalSchema = z.object({
  date: z.coerce.date().optional(),
  narration: z.string().min(3, 'Narration is required'),
  lines: z
    .array(
      z.object({
        code: z.string().min(1, 'Account is required'),
        debit: z.coerce.number().min(0).default(0),
        credit: z.coerce.number().min(0).default(0),
        description: z.string().optional().default(''),
      })
    )
    .min(2, 'A journal entry needs at least two lines'),
});

const defaultNormal = (type) => (['ASSET', 'EXPENSE'].includes(type) ? 'DEBIT' : 'CREDIT');

export const listAccounts = asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.type) q.type = req.query.type;
  if (req.query.search) {
    q.$or = [{ name: new RegExp(req.query.search, 'i') }, { code: new RegExp(req.query.search, 'i') }];
  }
  const accounts = await Account.find(q).sort({ code: 1 }).lean();
  res.json({ data: accounts, meta: { types: ACCOUNT_TYPES } });
});

export const createAccount = asyncHandler(async (req, res) => {
  const exists = await Account.findOne({ code: req.body.code });
  if (exists) throw ApiError.conflict('Account code ' + req.body.code + ' already exists');
  const account = await Account.create({
    ...req.body,
    normalBalance: req.body.normalBalance || defaultNormal(req.body.type),
  });
  clearAccountCache();
  recordAudit(req, { action: 'gl.accountCreate', entity: 'Account', entityId: account._id, entityCode: account.code });
  res.status(201).json({ data: account });
});

export const updateAccount = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.params.id);
  if (!account) throw ApiError.notFound('Account not found');
  if (account.isSystem && req.body.code && req.body.code !== account.code) {
    throw ApiError.badRequest('The code of a system account cannot be changed - automatic postings depend on it');
  }
  Object.assign(account, req.body);
  if (!req.body.normalBalance) account.normalBalance = defaultNormal(account.type);
  await account.save();
  clearAccountCache();
  recordAudit(req, { action: 'gl.accountUpdate', entity: 'Account', entityId: account._id, entityCode: account.code });
  res.json({ data: account });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.params.id);
  if (!account) throw ApiError.notFound('Account not found');
  if (account.isSystem) throw ApiError.badRequest('System accounts cannot be deleted');
  const used = await JournalEntry.findOne({ 'lines.account': account._id });
  if (used) throw ApiError.badRequest('Account has postings (' + used.code + ') - deactivate it instead');
  await account.deleteOne();
  clearAccountCache();
  recordAudit(req, { action: 'gl.accountDelete', entity: 'Account', entityCode: account.code });
  res.json({ message: 'Account removed' });
});

export const listJournals = asyncHandler(async (req, res) => {
  const { from, to, refType, search, limit } = req.query;
  const q = {};
  if (refType) q.refType = refType;
  if (search) q.$or = [{ code: new RegExp(search, 'i') }, { narration: new RegExp(search, 'i') }, { refCode: new RegExp(search, 'i') }];
  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = new Date(from);
    if (to) q.date.$lte = new Date(to);
  }

  const entries = await JournalEntry.find(q)
    .populate('createdBy', 'name role')
    .sort({ date: -1, createdAt: -1 })
    .limit(Number(limit) || 300)
    .lean();
  res.json({ data: entries });
});

export const getJournal = asyncHandler(async (req, res) => {
  const entry = await JournalEntry.findById(req.params.id).populate('createdBy', 'name role').lean();
  if (!entry) throw ApiError.notFound('Journal entry not found');
  res.json({ data: entry });
});

export const createJournal = asyncHandler(async (req, res) => {
  const dr = req.body.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const cr = req.body.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(dr - cr) > 0.01) {
    throw ApiError.badRequest('Entry is out of balance: debits ' + dr.toFixed(2) + ' vs credits ' + cr.toFixed(2));
  }

  const entry = await postJournal({
    date: req.body.date,
    narration: req.body.narration,
    rawLines: req.body.lines,
    refType: 'Manual',
    userId: req.user._id,
    system: false,
  });

  recordAudit(req, { action: 'gl.post', entity: 'JournalEntry', entityId: entry._id, entityCode: entry.code, detail: entry.narration });
  res.status(201).json({ data: entry });
});

/** Posts the mirror image of an entry rather than deleting it. */
export const reverseJournal = asyncHandler(async (req, res) => {
  const original = await JournalEntry.findById(req.params.id);
  if (!original) throw ApiError.notFound('Journal entry not found');
  if (original.status === 'REVERSED') throw ApiError.badRequest('Entry ' + original.code + ' has already been reversed');

  const entry = await postJournal({
    date: new Date(),
    narration: 'Reversal of ' + original.code + ' - ' + original.narration,
    rawLines: original.lines.map((l) => ({
      code: l.accountCode,
      debit: l.credit,
      credit: l.debit,
      description: 'Reversal: ' + (l.description || ''),
    })),
    refType: original.refType,
    refId: original.refId,
    refCode: original.refCode,
    userId: req.user._id,
    system: false,
  });

  entry.reversalOf = original._id;
  await entry.save();
  original.status = 'REVERSED';
  await original.save();

  recordAudit(req, { action: 'gl.reverse', entity: 'JournalEntry', entityId: original._id, entityCode: original.code });
  res.json({ data: entry, message: original.code + ' reversed by ' + entry.code });
});

export const getTrialBalance = asyncHandler(async (req, res) => {
  const result = await trialBalance({ from: req.query.from, to: req.query.to });
  res.json({ data: result.rows, summary: { totalDebit: result.totalDebit, totalCredit: result.totalCredit, balanced: Math.abs(result.totalDebit - result.totalCredit) < 0.01 } });
});

export const getLedger = asyncHandler(async (req, res) => {
  const result = await accountLedger(req.params.id, { from: req.query.from, to: req.query.to });
  res.json({ data: result.rows, account: result.account, closingBalance: result.closingBalance });
});

export const getFinancials = asyncHandler(async (req, res) => {
  const summary = await financialSummary({ from: req.query.from, to: req.query.to });
  res.json({ data: summary });
});
