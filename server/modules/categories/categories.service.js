import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../audit/audit.service.js';
import { Category } from './category.model.js';

/* ---------------- defaults ---------------- */

export const DEFAULT_CATEGORIES = {
  income: [
    ['salary', 'Salary', 'briefcase'],
    ['business_revenue', 'Business revenue', 'store'],
    ['freelance', 'Freelance', 'laptop'],
    ['rental', 'Rental income', 'house'],
    ['investments', 'Investments', 'trending-up'],
    ['gifts', 'Gifts', 'gift'],
    ['other_income', 'Other income', 'circle-plus'],
  ],
  expense: [
    ['housing', 'Housing', 'house'],
    ['food', 'Food', 'utensils'],
    ['transport', 'Transportation', 'bus'],
    ['utilities', 'Utilities', 'zap'],
    ['education', 'Education', 'graduation-cap'],
    ['healthcare', 'Healthcare', 'heart-pulse'],
    ['entertainment', 'Entertainment', 'clapperboard'],
    ['subscriptions', 'Subscriptions', 'calendar-clock'],
    ['business_expenses', 'Business expenses', 'briefcase'],
    ['other_expense', 'Other expenses', 'circle-minus'],
  ],
};

const keyOf = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** Seeds the built-in categories the first time a workspace needs them. */
export async function ensureDefaultCategories(workspaceId) {
  if (await Category.exists({ workspaceId })) return;
  const docs = Object.entries(DEFAULT_CATEGORIES).flatMap(([kind, list]) =>
    list.map(([systemKey, name, icon]) => ({ workspaceId, kind, name, nameKey: keyOf(name), icon, systemKey })),
  );
  try {
    await Category.insertMany(docs, { ordered: false });
  } catch (err) {
    // A concurrent request seeded first; duplicates are expected and harmless.
    if (err?.code !== 11000 && !err?.writeErrors?.every((e) => e.code === 11000)) throw err;
  }
}

export function presentCategory(c) {
  return { id: c._id.toString(), kind: c.kind, name: c.name, icon: c.icon, systemKey: c.systemKey, archived: c.archived };
}

/* ---------------- service ---------------- */

export async function listCategories(workspaceId, { kind, includeArchived = false } = {}) {
  await ensureDefaultCategories(workspaceId);
  const q = { workspaceId };
  if (kind) q.kind = kind;
  if (!includeArchived) q.archived = false;
  const rows = await Category.find(q).sort({ kind: 1, systemKey: -1, name: 1 });
  return rows.map(presentCategory);
}

export async function createCategory(workspace, input, actor, ctx) {
  const nameKey = keyOf(input.name);
  const existing = await Category.findOne({ workspaceId: workspace._id, kind: input.kind, nameKey });
  if (existing && !existing.archived) throw ApiError.conflict('A category with this name already exists.', 'DUPLICATE');
  let category;
  if (existing) {
    existing.archived = false;
    existing.icon = input.icon ?? existing.icon;
    category = await existing.save();
  } else {
    category = await Category.create({ workspaceId: workspace._id, kind: input.kind, name: input.name.trim(), nameKey, icon: input.icon ?? 'tag' });
  }
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'category.created', entityType: 'Category', entityId: category._id, metadata: { name: category.name, kind: category.kind }, ctx });
  return presentCategory(category);
}

export async function updateCategory(workspace, id, changes, actor, ctx) {
  const category = await Category.findOne({ _id: id, workspaceId: workspace._id });
  if (!category) throw ApiError.notFound('Category not found.');
  const before = presentCategory(category);
  if (changes.name) {
    const nameKey = keyOf(changes.name);
    if (nameKey !== category.nameKey && (await Category.exists({ workspaceId: workspace._id, kind: category.kind, nameKey }))) {
      throw ApiError.conflict('A category with this name already exists.', 'DUPLICATE');
    }
    category.name = changes.name.trim();
    category.nameKey = nameKey;
  }
  if (changes.icon) category.icon = changes.icon;
  // Archiving hides a category from pickers; existing transactions keep it.
  if (changes.archived !== undefined) category.archived = changes.archived;
  await category.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: 'category.updated', entityType: 'Category', entityId: category._id, metadata: { before, after: presentCategory(category) }, ctx });
  return presentCategory(category);
}
