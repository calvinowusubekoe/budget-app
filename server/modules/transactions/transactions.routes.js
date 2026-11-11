import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { singleFile } from '../../middleware/upload.js';
import * as c from './transactions.controller.js';
import * as v from './transactions.validators.js';

const write = requirePermission('records.write');

export const transactionsRouter = Router();
transactionsRouter.use(requireAuth, requireWorkspace('records.read'));

transactionsRouter.get('/', validate(v.listSchema), c.list);
transactionsRouter.get('/summary', validate(v.summarySchema), c.summary);
transactionsRouter.get('/export.csv', validate(v.exportSchema), c.exportCsv);
transactionsRouter.post('/', write, validate(v.createSchema), c.create);
transactionsRouter.get('/:transactionId', validate(v.idSchema), c.get);
transactionsRouter.patch('/:transactionId', write, validate(v.updateSchema), c.update);
transactionsRouter.delete('/:transactionId', write, validate(v.deleteSchema), c.remove);
transactionsRouter.post('/:transactionId/reconcile', write, validate(v.idSchema), c.reconcile);
// Unlocking a reconciled record is a correction, so it needs admin rights.
transactionsRouter.post('/:transactionId/unreconcile', requirePermission('workspace.update'), validate(v.idSchema), c.unreconcile);
transactionsRouter.get('/:transactionId/history', validate(v.idSchema), c.history);

transactionsRouter.get('/:transactionId/attachments', validate(v.idSchema), c.listAttachments);
transactionsRouter.post('/:transactionId/attachments', write, validate(v.idSchema), singleFile, c.addAttachment);
transactionsRouter.get('/:transactionId/attachments/:attachmentId', validate(v.attachmentParamSchema), c.downloadAttachment);
transactionsRouter.delete('/:transactionId/attachments/:attachmentId', write, validate(v.attachmentParamSchema), c.removeAttachment);
