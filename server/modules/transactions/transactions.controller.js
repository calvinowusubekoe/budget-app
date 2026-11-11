import { ApiError } from '../../utils/ApiError.js';
import { created, ok, requestContext } from '../../utils/http.js';
import * as svc from './transactions.service.js';
import * as files from './attachments.service.js';
import { toCsv } from './csv.js';
import { sendUpload } from '../../services/fileStorage.js';
import { idempotencyKey } from './transactions.validators.js';

export async function list(req, res) {
  const { items, meta } = await svc.listTransactions(req.workspace._id, req.valid.query);
  ok(res, items, { meta });
}

export async function summary(req, res) {
  ok(res, await svc.summarize(req.workspace, req.valid.query));
}

export async function exportCsv(req, res) {
  const rows = await svc.exportRows(req.workspace._id, req.valid.query);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="kontaa-transactions-${stamp}.csv"`);
  res.send(toCsv(rows));
}

export async function create(req, res) {
  const key = req.get('idempotency-key');
  if (key !== undefined && idempotencyKey.validate(key).error) {
    throw ApiError.badRequest('Idempotency-Key must be 8–100 letters, numbers, dashes or underscores.');
  }
  const { transaction, replayed } = await svc.createTransaction(req.workspace, req.valid.body, req.user, requestContext(req), key);
  // A replay returns the original record with 200 so clients can tell it apart.
  if (replayed) return ok(res, transaction, { meta: { replayed: true } });
  created(res, transaction);
}

export async function get(req, res) {
  ok(res, await svc.getTransaction(req.workspace._id, req.valid.params.transactionId));
}

export async function update(req, res) {
  ok(res, await svc.updateTransaction(req.workspace, req.valid.params.transactionId, req.valid.body, req.user, requestContext(req)));
}

export async function remove(req, res) {
  await svc.deleteTransaction(req.workspace, req.valid.params.transactionId, req.valid.body?.reason, req.user, requestContext(req));
  ok(res, { deleted: true });
}

export async function reconcile(req, res) {
  ok(res, await svc.setReconciled(req.workspace, req.valid.params.transactionId, true, req.user, requestContext(req)));
}

export async function unreconcile(req, res) {
  ok(res, await svc.setReconciled(req.workspace, req.valid.params.transactionId, false, req.user, requestContext(req)));
}

export async function history(req, res) {
  ok(res, await svc.transactionHistory(req.workspace._id, req.valid.params.transactionId));
}

export async function listAttachments(req, res) {
  ok(res, await files.listAttachments(req.workspace._id, req.valid.params.transactionId));
}

export async function addAttachment(req, res) {
  created(res, await files.addAttachment(req.workspace, req.valid.params.transactionId, req.file, req.user, requestContext(req)));
}

export async function downloadAttachment(req, res) {
  const { transactionId, attachmentId } = req.valid.params;
  const { attachment, data } = await files.openAttachment(req.workspace._id, transactionId, attachmentId);
  sendUpload(res, attachment, data);
}

export async function removeAttachment(req, res) {
  const { transactionId, attachmentId } = req.valid.params;
  await files.removeAttachment(req.workspace, transactionId, attachmentId, req.user, requestContext(req));
  ok(res, { deleted: true });
}
