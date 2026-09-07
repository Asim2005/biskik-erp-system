import mongoose from 'mongoose';

export const PO_STATUS = ['DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const poLineSchema = new mongoose.Schema(
  {
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    materialCode: String,
    materialName: String,
    uom: String,
    /** frozen from the approved recipe at order creation */
    standardQty: { type: Number, default: 0 },
    standardRate: { type: Number, default: 0 },
    standardCost: { type: Number, default: 0 },
    /** entered by the shop floor / store when materials are issued */
    actualQty: { type: Number, default: 0 },
    actualRate: { type: Number, default: 0 },
    actualCost: { type: Number, default: 0 },
    // variance analysis
    usageVarianceQty: { type: Number, default: 0 },
    usageVarianceCost: { type: Number, default: 0 },
    priceVarianceCost: { type: Number, default: 0 },
    totalVarianceCost: { type: Number, default: 0 },
    issued: { type: Boolean, default: false },
  },
  { _id: false }
);

const productionOrderSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    recipe: { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe', required: true },
    recipeCode: String,
    recipeVersion: String,
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
    productName: String,
    plannedQty: { type: Number, required: true, min: 1 },
    baseBatchQty: { type: Number, default: 1000 },
    scaleFactor: { type: Number, default: 1 },
    goodQty: { type: Number, default: 0 },
    rejectQty: { type: Number, default: 0 },
    scheduledDate: { type: Date, default: Date.now },
    shift: { type: String, enum: ['A', 'B', 'C', 'GENERAL'], default: 'GENERAL' },
    lineNo: { type: String, default: 'Line-1' },
    status: { type: String, enum: PO_STATUS, default: 'DRAFT', index: true },

    lines: [poLineSchema],

    // conversion cost: standard is recipe rate x planned qty, actual is entered
    standardLabourCost: { type: Number, default: 0 },
    actualLabourCost: { type: Number, default: 0 },
    standardOverheadCost: { type: Number, default: 0 },
    actualOverheadCost: { type: Number, default: 0 },

    // roll-ups
    standardMaterialCost: { type: Number, default: 0 },
    actualMaterialCost: { type: Number, default: 0 },
    standardTotalCost: { type: Number, default: 0 },
    actualTotalCost: { type: Number, default: 0 },
    standardUnitCost: { type: Number, default: 0 },
    actualUnitCost: { type: Number, default: 0 },
    totalVariance: { type: Number, default: 0 },

    materialsIssuedAt: Date,
    startedAt: Date,
    completedAt: Date,
    journalEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    remarks: { type: String, default: '' },
  },
  { timestamps: true }
);

export const ProductionOrder = mongoose.model('ProductionOrder', productionOrderSchema);
