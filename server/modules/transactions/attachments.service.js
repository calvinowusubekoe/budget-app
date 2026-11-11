import { ApiError } from '../../utils/ApiError.js';
import { readUpload, removeUpload, saveUpload } from '../../services/fileStorage.js';
import { recordAudit } from '../audit/audit.service.js';
import { Attachment } from './attachment.model.js';
import { Transaction } from './transaction.model.js';

export { sniffType } from '../../services/fileStorage.js';
export const MAX_ATTACHMENTS = 5;

export function presentAttachment(a) {
  return { id: String(a._id), name: a.originalName, mimeType: a.mimeType, size: a.size, createdAt: a.createdAt };
}

async function liveTransaction(workspaceId, transactionId) {
  const tx = await Transaction.findOne({ _id: transactionId, workspaceId, deletedAt: null });
  if (!tx) throw ApiError.notFound('Transaction not found.');
  return tx;
}

export async function listAttachments(workspaceId, transactionId) {
  await liveTransaction(workspaceId, transactionId);
  const rows = await Attachment.find({ workspaceId, transactionId }).sort({ createdAt: 1 });
  return rows.map(presentAttachment);
}

export async function addAttachment(workspace, transactionId, file, actor, ctx) {
  const tx = await liveTransaction(workspace._id, transactionId);
  const count = await Attachment.countDocuments({ workspaceId: workspace._id, transactionId: tx._id });
  if (count >= MAX_ATTACHMENTS) throw ApiError.badRequest(`A transaction can have up to ${MAX_ATTACHMENTS} attachments.`);

  const stored = await saveUpload(workspace._id, file);
  try {
    const attachment = await Attachment.create({ workspaceId: workspace._id, transactionId: tx._id, ...stored, uploadedBy: actor._id });
    await Transaction.updateOne({ _id: tx._id }, { $inc: { attachmentCount: 1 } });
    await recordAudit({
      workspaceId: workspace._id,
      actorId: actor._id,
      action: 'transaction.attachment_added',
      entityType: 'Transaction',
      entityId: tx._id,
      metadata: { name: attachment.originalName, size: attachment.size, mimeType: attachment.mimeType },
      ctx,
    });
    return presentAttachment(attachment);
  } catch (err) {
    await removeUpload(stored.storageKey);
    throw err;
  }
}

export async function openAttachment(workspaceId, transactionId, attachmentId) {
  await liveTransaction(workspaceId, transactionId);
  const a = await Attachment.findOne({ _id: attachmentId, workspaceId, transactionId });
  if (!a) throw ApiError.notFound('Attachment not found.');
  return { attachment: a, data: await readUpload(a.storageKey) };
}

export async function removeAttachment(workspace, transactionId, attachmentId, actor, ctx) {
  const tx = await liveTransaction(workspace._id, transactionId);
  if (tx.status === 'reconciled') {
    throw new ApiError(409, 'RECORD_LOCKED', 'This transaction is reconciled, so its receipts can’t be removed.');
  }
  const a = await Attachment.findOneAndDelete({ _id: attachmentId, workspaceId: workspace._id, transactionId: tx._id });
  if (!a) throw ApiError.notFound('Attachment not found.');
  await Transaction.updateOne({ _id: tx._id }, { $inc: { attachmentCount: -1 } });
  await removeUpload(a.storageKey);
  await recordAudit({
    workspaceId: workspace._id,
    actorId: actor._id,
    action: 'transaction.attachment_removed',
    entityType: 'Transaction',
    entityId: tx._id,
    metadata: { name: a.originalName },
    ctx,
  });
}
