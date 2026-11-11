import { ApiError } from '../../utils/ApiError.js';
import { D, normalize } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { Bill, Customer, Invoice, Supplier } from './business.models.js';
import { balances } from './documents.service.js';

export const PARTIES = {
  customer: { Model: Customer, Doc: Invoice, field: 'customerId', label: 'Customer' },
  supplier: { Model: Supplier, Doc: Bill, field: 'supplierId', label: 'Supplier' },
};

const FIELDS = ['name', 'email', 'phone', 'address', 'taxId', 'notes'];

/** Outstanding per currency on issued documents. Never mixed across currencies. */
async function outstanding(kind, workspaceId, ids) {
  const p = PARTIES[kind];
  const docs = await p.Doc.find({ workspaceId, [p.field]: { $in: ids }, status: 'issued' });
  const out = new Map();
  for (const d of docs) {
    const key = String(d[p.field]);
    const byCur = out.get(key) ?? new Map();
    byCur.set(d.currency, (byCur.get(d.currency) ?? new D(0)).plus(balances(d).balance));
    out.set(key, byCur);
  }
  return out;
}

function present(c, owed) {
  return {
    id: String(c._id),
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    taxId: c.taxId,
    notes: c.notes,
    status: c.status,
    outstanding: owed ? [...owed.entries()].filter(([, v]) => !v.isZero()).map(([currency, v]) => ({ currency, amount: normalize(v.toString(), currency) })) : [],
    createdAt: c.createdAt,
  };
}

export async function listParties(kind, workspace, { includeArchived = false, q } = {}) {
  const p = PARTIES[kind];
  const filter = { workspaceId: workspace._id };
  if (!includeArchived) filter.status = 'active';
  if (q) filter.name = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const rows = await p.Model.find(filter).sort({ name: 1 }).limit(1000);
  const owed = await outstanding(kind, workspace._id, rows.map((r) => r._id));
  return rows.map((r) => present(r, owed.get(String(r._id))));
}

export async function createParty(kind, workspace, input, actor, ctx) {
  const p = PARTIES[kind];
  const doc = await p.Model.create({ workspaceId: workspace._id, ...Object.fromEntries(FIELDS.map((f) => [f, input[f] ?? ''])), createdBy: actor._id });
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `${kind}.created`, entityType: p.label, entityId: doc._id, metadata: { name: doc.name }, ctx });
  return present(doc);
}

/** Contacts with documents can be archived but never deleted, so history keeps its names. */
export async function updateParty(kind, workspace, id, changes, actor, ctx) {
  const p = PARTIES[kind];
  const doc = await p.Model.findOne({ _id: id, workspaceId: workspace._id });
  if (!doc) throw ApiError.notFound(`${p.label} not found.`);
  for (const f of [...FIELDS, 'status']) if (changes[f] !== undefined) doc[f] = changes[f];
  await doc.save();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: changes.status === 'archived' ? `${kind}.archived` : `${kind}.updated`, entityType: p.label, entityId: doc._id, metadata: { name: doc.name, fields: Object.keys(changes) }, ctx });
  const owed = await outstanding(kind, workspace._id, [doc._id]);
  return present(doc, owed.get(String(doc._id)));
}

export async function deleteParty(kind, workspace, id, actor, ctx) {
  const p = PARTIES[kind];
  const doc = await p.Model.findOne({ _id: id, workspaceId: workspace._id });
  if (!doc) throw ApiError.notFound(`${p.label} not found.`);
  if (await p.Doc.exists({ [p.field]: doc._id })) throw ApiError.conflict(`This ${kind} has ${kind === 'customer' ? 'invoices' : 'bills'}, so it can only be archived.`, 'HAS_DOCUMENTS');
  await doc.deleteOne();
  await recordAudit({ workspaceId: workspace._id, actorId: actor._id, action: `${kind}.deleted`, entityType: p.label, entityId: doc._id, metadata: { name: doc.name }, ctx });
}
