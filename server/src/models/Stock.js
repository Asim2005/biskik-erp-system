import mongoose from 'mongoose';

/** Current on-hand balance per material + location, valued at moving average. */
const stockSchema = new mongoose.Schema(
  {
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
    location: { type: String, default: 'RM Store', index: true },
    qty: { type: Number, default: 0 },
    avgRate: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
  },
  { timestamps: true }
);

stockSchema.index({ material: 1, location: 1 }, { unique: true });

export const Stock = mongoose.model('Stock', stockSchema);
