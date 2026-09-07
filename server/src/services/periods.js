import { FiscalPeriod, periodKey } from '../models/FiscalPeriod.js';
import { ApiError } from '../utils/apiError.js';
import { round2 } from '../utils/money.js';

/**
 * Refuses any posting dated inside a closed period.
 *
 * Called by every routine that writes to the ledger or moves stock, so a
 * closed period cannot be altered from any direction - not through a journal
 * entry, a goods receipt, a production completion or an invoice.
 */
export async function assertPeriodOpen(date, what = 'this transaction') {
  const key = periodKey(date);
  const period = await FiscalPeriod.findOne({ period: key });
  if (period && period.status === 'CLOSED') {
    throw ApiError.badRequest(
      'Accounting period ' + key + ' is closed - ' + what + ' cannot be posted into it. ' +
        'Ask the financial controller to reopen the period, or date the entry in an open one.'
    );
  }
  return key;
}

export async function isPeriodClosed(date) {
  const period = await FiscalPeriod.findOne({ period: periodKey(date) });
  return period?.status === 'CLOSED';
}

/** Creates the period row on demand so every month is listable. */
export async function ensurePeriod(key) {
  let period = await FiscalPeriod.findOne({ period: key });
  if (period) return period;

  const [year, month] = key.split('-').map(Number);
  period = await FiscalPeriod.create({
    period: key,
    startDate: new Date(year, month - 1, 1),
    endDate: new Date(year, month, 0, 23, 59, 59),
    status: 'OPEN',
  });
  return period;
}

/** Lists the last N periods, creating any that do not exist yet. */
export async function listPeriods(count = 12) {
  const now = new Date();
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  for (const k of keys) await ensurePeriod(k);

  return FiscalPeriod.find({ period: { $in: keys } })
    .populate('closedBy reopenedBy', 'name role')
    .sort({ period: -1 })
    .lean();
}

export function summariseClose(trialBalance, financials) {
  return {
    closingTrialBalanceDebit: round2(trialBalance.totalDebit),
    closingTrialBalanceCredit: round2(trialBalance.totalCredit),
    closingNetProfit: round2(financials.netProfit),
  };
}
