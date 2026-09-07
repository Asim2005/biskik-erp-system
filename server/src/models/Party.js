import mongoose from 'mongoose';

const partySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    type: { type: String, enum: ['CUSTOMER', 'SUPPLIER'], required: true, index: true },
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    ntn: { type: String, default: '' },
    strn: { type: String, default: '' },
    filerStatus: { type: String, enum: ['FILER', 'NON_FILER', 'UNKNOWN'], default: 'UNKNOWN' },
    creditLimit: { type: Number, default: 0 },
    creditDays: { type: Number, default: 0 },
    openingBalance: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Party = mongoose.model('Party', partySchema);
