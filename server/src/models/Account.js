import mongoose from 'mongoose';

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

const accountSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true, index: true },
    subType: { type: String, default: '' },
    normalBalance: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    openingBalance: { type: Number, default: 0 },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Account = mongoose.model('Account', accountSchema);
