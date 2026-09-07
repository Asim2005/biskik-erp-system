import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'company', unique: true },
    companyName: { type: String, default: 'Demo Biscuit Industries (Pvt) Ltd' },
    address: { type: String, default: 'Plot 42, Industrial Estate, Lahore, Pakistan' },
    ntn: { type: String, default: '1234567-8' },
    strn: { type: String, default: '32-77-9900-123-45' },
    currency: { type: String, default: 'PKR' },
    currencySymbol: { type: String, default: 'Rs.' },
    fiscalYearStartMonth: { type: Number, default: 7 },
    defaultSalesTaxRate: { type: Number, default: 18 },
    furtherTaxRate: { type: Number, default: 3 },
    withholdingTaxRate: { type: Number, default: 0.5 },
    labourRatePerUnit: { type: Number, default: 0.32 },
    overheadRatePerUnit: { type: Number, default: 0.68 },
    adminRatePerUnit: { type: Number, default: 0.25 },
    marketingRatePerUnit: { type: Number, default: 0.3 },
    lowStockThresholdPercent: { type: Number, default: 20 },
  },
  { timestamps: true }
);

export const Setting = mongoose.model('Setting', settingSchema);

export async function getSettings() {
  let doc = await Setting.findOne({ key: 'company' });
  if (!doc) doc = await Setting.create({ key: 'company' });
  return doc;
}
