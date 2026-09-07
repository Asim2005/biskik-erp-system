import mongoose from 'mongoose';

const jeLineSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    accountCode: String,
    accountName: String,
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    description: { type: String, default: '' },
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now, index: true },
    narration: { type: String, default: '' },
    lines: [jeLineSchema],
    totalDebit: { type: Number, default: 0 },
    totalCredit: { type: Number, default: 0 },
    status: { type: String, enum: ['DRAFT', 'POSTED', 'REVERSED'], default: 'POSTED', index: true },
    refType: { type: String, default: '' },
    refId: { type: mongoose.Schema.Types.ObjectId },
    refCode: { type: String, default: '' },
    isSystemGenerated: { type: Boolean, default: false },
    /** an adjusting entry made during the close - shown separately on the adjusted trial balance */
    isAdjusting: { type: Boolean, default: false, index: true },
    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    postedAt: Date,
  },
  { timestamps: true }
);

journalEntrySchema.pre('validate', function balanceCheck(next) {
  this.totalDebit = Number(this.lines.reduce((s, l) => s + (l.debit || 0), 0).toFixed(2));
  this.totalCredit = Number(this.lines.reduce((s, l) => s + (l.credit || 0), 0).toFixed(2));
  if (Math.abs(this.totalDebit - this.totalCredit) > 0.01) {
    return next(new Error('Journal entry is out of balance: Dr ' + this.totalDebit + ' vs Cr ' + this.totalCredit));
  }
  return next();
});

export const JournalEntry = mongoose.model('JournalEntry', journalEntrySchema);
