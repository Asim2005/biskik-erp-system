import mongoose from 'mongoose';

/**
 * An accounting period that can be locked.
 *
 * Once the controller closes a period, nothing may post into it - not a
 * journal entry, not a goods receipt, not an invoice. That is what makes a
 * signed-off trial balance mean anything.
 */
const fiscalPeriodSchema = new mongoose.Schema(
  {
    /** YYYY-MM */
    period: { type: String, required: true, unique: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN', index: true },

    /** snapshot taken at close, so a reopened-and-changed period is detectable */
    closingTrialBalanceDebit: { type: Number, default: 0 },
    closingTrialBalanceCredit: { type: Number, default: 0 },
    closingNetProfit: { type: Number, default: 0 },

    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    closedAt: Date,
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reopenedAt: Date,
    reopenReason: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

export const FiscalPeriod = mongoose.model('FiscalPeriod', fiscalPeriodSchema);

export function periodKey(date) {
  const d = new Date(date || Date.now());
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
