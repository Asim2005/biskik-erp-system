import { z } from 'zod';
import { Recipe } from '../models/Recipe.js';
import { Material } from '../models/Material.js';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';
import { nextCode } from '../utils/numbering.js';
import { applyRecipeCost, computeRecipeCost, explodeRecipe } from '../services/costing.js';
import { getSettings } from '../models/Setting.js';
import { round2, round3 } from '../utils/money.js';

const lineSchema = z.object({
  material: z.string().min(1, 'Pick a material'),
  qty: z.coerce.number().gt(0, 'Quantity must be greater than zero'),
  rate: z.coerce.number().min(0).optional(),
  wastagePercent: z.coerce.number().min(0).max(100).default(0),
  remarks: z.string().optional().default(''),
});

export const recipeSchema = z.object({
  productName: z.string().min(2, 'Product name is required'),
  product: z.string().optional().nullable(),
  baseBatchQty: z.coerce.number().gt(0).default(1000),
  baseBatchUom: z.string().default('PCS'),
  yieldPercent: z.coerce.number().min(1).max(100).default(98),
  lines: z.array(lineSchema).min(1, 'Add at least one recipe line'),
  labourCostPerUnit: z.coerce.number().min(0).default(0),
  factoryOverheadPerUnit: z.coerce.number().min(0).default(0),
  adminOverheadPerUnit: z.coerce.number().min(0).default(0),
  marketingOverheadPerUnit: z.coerce.number().min(0).default(0),
  effectiveDate: z.coerce.date().optional(),
  changeNote: z.string().optional().default(''),
});

/** Resolves material references into denormalised line data with live rates. */
async function hydrateLines(lines) {
  const ids = lines.map((l) => l.material);
  const materials = await Material.find({ _id: { $in: ids } });
  const map = new Map(materials.map((m) => [String(m._id), m]));

  return lines.map((l) => {
    const m = map.get(String(l.material));
    if (!m) throw ApiError.badRequest('Material ' + l.material + ' does not exist');
    return {
      material: m._id,
      materialCode: m.code,
      materialName: m.name,
      qty: round3(l.qty),
      uom: m.uom,
      rate: round2(l.rate ?? m.movingAvgRate ?? m.standardRate ?? 0),
      wastagePercent: l.wastagePercent || 0,
      remarks: l.remarks || '',
      lineCost: 0,
    };
  });
}

export const listRecipes = asyncHandler(async (req, res) => {
  const { status, search, latestOnly } = req.query;
  const q = {};
  if (status) q.status = status;
  if (search) q.$or = [{ productName: new RegExp(search, 'i') }, { code: new RegExp(search, 'i') }];

  let recipes = await Recipe.find(q)
    .populate('preparedBy approvedBy submittedBy', 'name role')
    .sort({ code: 1, versionNo: -1 })
    .lean();

  if (latestOnly === 'true') {
    const seen = new Set();
    recipes = recipes.filter((r) => {
      if (seen.has(r.code)) return false;
      seen.add(r.code);
      return true;
    });
  }

  res.json({ data: recipes });
});

export const getRecipe = asyncHandler(async (req, res) => {
  const recipe = await Recipe.findById(req.params.id)
    .populate('preparedBy approvedBy submittedBy', 'name role email')
    .populate('lines.material', 'code name uom standardRate movingAvgRate category');
  if (!recipe) throw ApiError.notFound('Recipe not found');

  const versions = await Recipe.find({ code: recipe.code })
    .populate('approvedBy submittedBy', 'name role')
    .sort({ versionNo: -1 })
    .select(
      'code version versionNo status effectiveDate approvedAt approvedBy submittedBy createdAt materialCostPerUnit manufacturingCostPerUnit changeNote'
    )
    .lean();

  res.json({ data: recipe, cost: computeRecipeCost(recipe), versions });
});

export const createRecipe = asyncHandler(async (req, res) => {
  const body = req.body;
  const settings = await getSettings();
  const lines = await hydrateLines(body.lines);
  const code = await nextCode('REC');

  const recipe = new Recipe({
    ...body,
    code,
    version: '1.0',
    versionNo: 1,
    lines,
    labourCostPerUnit: body.labourCostPerUnit || settings.labourRatePerUnit,
    factoryOverheadPerUnit: body.factoryOverheadPerUnit || settings.overheadRatePerUnit,
    adminOverheadPerUnit: body.adminOverheadPerUnit || settings.adminRatePerUnit,
    marketingOverheadPerUnit: body.marketingOverheadPerUnit || settings.marketingRatePerUnit,
    status: 'DRAFT',
    preparedBy: req.user._id,
    product: body.product || undefined,
  });
  applyRecipeCost(recipe);
  await recipe.save();

  recordAudit(req, {
    action: 'recipe.create',
    entity: 'Recipe',
    entityId: recipe._id,
    entityCode: recipe.code,
    detail: recipe.productName,
  });
  res.status(201).json({ data: recipe });
});

export const updateRecipe = asyncHandler(async (req, res) => {
  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) throw ApiError.notFound('Recipe not found');
  if (!['DRAFT', 'REJECTED'].includes(recipe.status)) {
    throw ApiError.badRequest(
      'Recipe ' + recipe.code + ' v' + recipe.version + ' is ' + recipe.status +
        ' and is locked. Create a new version to change the formula.'
    );
  }

  const lines = await hydrateLines(req.body.lines);
  Object.assign(recipe, req.body, { lines, product: req.body.product || undefined });
  if (recipe.status === 'REJECTED') recipe.status = 'DRAFT';
  applyRecipeCost(recipe);
  await recipe.save();

  recordAudit(req, { action: 'recipe.update', entity: 'Recipe', entityId: recipe._id, entityCode: recipe.code });
  res.json({ data: recipe });
});

export const submitRecipe = asyncHandler(async (req, res) => {
  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) throw ApiError.notFound('Recipe not found');
  if (!['DRAFT', 'REJECTED'].includes(recipe.status)) {
    throw ApiError.badRequest('Only a draft or rejected recipe can be submitted for approval');
  }
  if (!recipe.lines.length) throw ApiError.badRequest('Cannot submit a recipe with no lines');

  recipe.status = 'PENDING_APPROVAL';
  recipe.submittedBy = req.user._id;
  recipe.submittedAt = new Date();
  recipe.rejectionReason = '';
  await recipe.save();

  recordAudit(req, { action: 'recipe.submit', entity: 'Recipe', entityId: recipe._id, entityCode: recipe.code });
  res.json({ data: recipe, message: 'Sent for approval' });
});

export const approveRecipe = asyncHandler(async (req, res) => {
  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) throw ApiError.notFound('Recipe not found');
  if (recipe.status !== 'PENDING_APPROVAL') {
    throw ApiError.badRequest('Only a recipe pending approval can be approved');
  }
  // Segregation of duties: whoever submitted the formula cannot approve their own work.
  if (String(recipe.submittedBy) === String(req.user._id)) {
    throw ApiError.forbidden(
      'Segregation of duties: you submitted this recipe, so another authorised user must approve it'
    );
  }

  await Recipe.updateMany(
    { code: recipe.code, status: 'APPROVED', _id: { $ne: recipe._id } },
    { $set: { status: 'ARCHIVED', isActive: false } }
  );

  recipe.status = 'APPROVED';
  recipe.approvedBy = req.user._id;
  recipe.approvedAt = new Date();
  recipe.effectiveDate = recipe.effectiveDate || new Date();
  recipe.isActive = true;
  applyRecipeCost(recipe);
  await recipe.save();

  recordAudit(req, {
    action: 'recipe.approve',
    entity: 'Recipe',
    entityId: recipe._id,
    entityCode: recipe.code,
    detail: 'v' + recipe.version + ' approved; earlier versions archived',
  });
  res.json({ data: recipe, message: 'Recipe ' + recipe.code + ' v' + recipe.version + ' approved' });
});

export const rejectRecipe = asyncHandler(async (req, res) => {
  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) throw ApiError.notFound('Recipe not found');
  if (recipe.status !== 'PENDING_APPROVAL') throw ApiError.badRequest('Only a pending recipe can be rejected');

  recipe.status = 'REJECTED';
  recipe.rejectionReason = req.body.reason || 'No reason supplied';
  await recipe.save();

  recordAudit(req, {
    action: 'recipe.reject',
    entity: 'Recipe',
    entityId: recipe._id,
    entityCode: recipe.code,
    detail: recipe.rejectionReason,
  });
  res.json({ data: recipe, message: 'Recipe rejected' });
});

export const newVersion = asyncHandler(async (req, res) => {
  const source = await Recipe.findById(req.params.id);
  if (!source) throw ApiError.notFound('Recipe not found');

  const open = await Recipe.findOne({ code: source.code, status: { $in: ['DRAFT', 'PENDING_APPROVAL'] } });
  if (open) {
    throw ApiError.conflict('Version ' + open.version + ' of ' + source.code + ' is still open (' + open.status + ')');
  }

  const latest = await Recipe.findOne({ code: source.code }).sort({ versionNo: -1 });
  const versionNo = latest.versionNo + 1;

  const clone = new Recipe({
    ...source.toObject(),
    _id: undefined,
    versionNo,
    version: versionNo + '.0',
    status: 'DRAFT',
    parent: source._id,
    preparedBy: req.user._id,
    submittedBy: undefined,
    submittedAt: undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    rejectionReason: '',
    changeNote: req.body.changeNote || '',
    effectiveDate: undefined,
    createdAt: undefined,
    updatedAt: undefined,
  });
  await clone.save();

  recordAudit(req, {
    action: 'recipe.newVersion',
    entity: 'Recipe',
    entityId: clone._id,
    entityCode: clone.code,
    detail: 'v' + clone.version + ' created from v' + source.version,
  });
  res.status(201).json({ data: clone });
});

export const deleteRecipe = asyncHandler(async (req, res) => {
  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) throw ApiError.notFound('Recipe not found');
  if (recipe.status === 'APPROVED') {
    throw ApiError.badRequest('An approved recipe cannot be deleted - supersede it with a new version');
  }
  const used = await ProductionOrder.findOne({ recipe: recipe._id });
  if (used) throw ApiError.badRequest('Recipe is referenced by production order ' + used.code);

  await recipe.deleteOne();
  recordAudit(req, { action: 'recipe.delete', entity: 'Recipe', entityCode: recipe.code });
  res.json({ message: 'Recipe deleted' });
});

/** Scale preview: what does this formula look like for N units? */
export const simulate = asyncHandler(async (req, res) => {
  const recipe = await Recipe.findById(req.params.id);
  if (!recipe) throw ApiError.notFound('Recipe not found');
  const qty = Number(req.query.qty) || recipe.baseBatchQty;
  if (qty <= 0) throw ApiError.badRequest('Quantity must be greater than zero');

  const { lines, scaleFactor, cost } = explodeRecipe(recipe, qty);
  res.json({
    data: {
      requestedQty: qty,
      scaleFactor,
      lines,
      materialCost: round2(lines.reduce((s, l) => s + l.standardCost, 0)),
      labourCost: round2(cost.labourCostPerUnit * qty),
      overheadCost: round2(cost.factoryOverheadPerUnit * qty),
      adminCost: round2(cost.adminOverheadPerUnit * qty),
      marketingCost: round2(cost.marketingOverheadPerUnit * qty),
      manufacturingCost: round2(cost.manufacturingCostPerUnit * qty),
      fullCost: round2(cost.fullCostPerUnit * qty),
      perUnit: cost,
    },
  });
});
