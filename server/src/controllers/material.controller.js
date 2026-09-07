import { z } from 'zod';
import { Material, MATERIAL_CATEGORIES, UOMS } from '../models/Material.js';
import { Stock } from '../models/Stock.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';
import { recordAudit } from '../middleware/audit.js';
import { nextCode } from '../utils/numbering.js';

export const materialSchema = z.object({
  code: z.string().trim().optional(),
  name: z.string().min(2, 'Name is required'),
  category: z.enum(MATERIAL_CATEGORIES).default('RAW'),
  uom: z.enum(UOMS).default('KG'),
  standardRate: z.coerce.number().min(0).default(0),
  reorderLevel: z.coerce.number().min(0).default(0),
  shelfLifeDays: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(18),
  hsCode: z.string().optional().default(''),
  defaultLocation: z.string().optional().default('RM Store'),
  isActive: z.boolean().optional().default(true),
  notes: z.string().optional().default(''),
});

export const listMaterials = asyncHandler(async (req, res) => {
  const { search, category, active } = req.query;
  const q = {};
  if (category) q.category = category;
  if (active === 'true') q.isActive = true;
  if (search) q.$or = [{ name: new RegExp(search, 'i') }, { code: new RegExp(search, 'i') }];

  const materials = await Material.find(q).sort({ category: 1, name: 1 }).lean();
  const stocks = await Stock.find().lean();
  const stockMap = new Map();
  for (const s of stocks) {
    const k = String(s.material);
    const cur = stockMap.get(k) || { qty: 0, value: 0 };
    stockMap.set(k, { qty: cur.qty + s.qty, value: cur.value + s.value });
  }

  res.json({
    data: materials.map((m) => ({
      ...m,
      onHand: Math.round(((stockMap.get(String(m._id))?.qty) || 0) * 1000) / 1000,
      stockValue: Math.round(((stockMap.get(String(m._id))?.value) || 0) * 100) / 100,
    })),
    meta: { categories: MATERIAL_CATEGORIES, uoms: UOMS },
  });
});

export const getMaterial = asyncHandler(async (req, res) => {
  const material = await Material.findById(req.params.id);
  if (!material) throw ApiError.notFound('Material not found');
  const stock = await Stock.find({ material: material._id }).lean();
  res.json({ data: material, stock });
});

export const createMaterial = asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body.code) {
    const prefix = { RAW: 'RM', PACKAGING: 'PK', CONSUMABLE: 'CN', FINISHED: 'FG', WIP: 'WP' }[body.category] || 'RM';
    body.code = await nextCode(prefix, 4);
  }
  const exists = await Material.findOne({ code: body.code.toUpperCase() });
  if (exists) throw ApiError.conflict('Material code ' + body.code + ' already exists');

  const material = await Material.create({ ...body, movingAvgRate: body.standardRate });
  recordAudit(req, { action: 'material.create', entity: 'Material', entityId: material._id, entityCode: material.code, detail: material.name });
  res.status(201).json({ data: material });
});

export const updateMaterial = asyncHandler(async (req, res) => {
  const material = await Material.findById(req.params.id);
  if (!material) throw ApiError.notFound('Material not found');
  Object.assign(material, req.body);
  await material.save();
  recordAudit(req, { action: 'material.update', entity: 'Material', entityId: material._id, entityCode: material.code });
  res.json({ data: material });
});

export const deleteMaterial = asyncHandler(async (req, res) => {
  const material = await Material.findById(req.params.id);
  if (!material) throw ApiError.notFound('Material not found');
  const stock = await Stock.findOne({ material: material._id, qty: { $gt: 0 } });
  if (stock) throw ApiError.badRequest('Cannot delete ' + material.name + ' - it still has stock on hand. Deactivate it instead.');
  await material.deleteOne();
  recordAudit(req, { action: 'material.delete', entity: 'Material', entityCode: material.code, detail: material.name });
  res.json({ message: 'Material removed' });
});
