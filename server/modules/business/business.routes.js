import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { currency, email, objectId } from '../../validators/common.js';
import { amount, calendarDate, rate } from '../../validators/money.js';
import { created, ok, requestContext } from '../../utils/http.js';
import { todayIn } from '../../utils/periods.js';
import { csvCell } from '../transactions/csv.js';
import * as contacts from './contacts.service.js';
import * as docs from './documents.service.js';
import * as reports from './reports.service.js';
import { QTY_PATTERN, RATE_PATTERN } from './lines.js';
import { documentPdf, profitLossPdf } from './pdf.js';

/** Business tools only exist in business workspaces. */
function requireBusiness(req, _res, next) {
  if (req.workspace.type !== 'business') return next(ApiError.badRequest('Business tools are available in business workspaces. Create one from the workspace menu.'));
  next();
}

const today = (req) => todayIn(req.user.timezone);
const write = requirePermission('records.write');
const id = (name) => Joi.object({ [name]: objectId.required() });

const partyFields = {
  name: Joi.string().trim().min(1).max(120),
  email: email.allow(''),
  phone: Joi.string().trim().max(30).allow(''),
  address: Joi.string().trim().max(300).allow(''),
  taxId: Joi.string().trim().max(40).allow(''),
  notes: Joi.string().trim().max(1000).allow(''),
};

const line = Joi.object({
  description: Joi.string().trim().min(1).max(200).required(),
  quantity: Joi.string().trim().pattern(QTY_PATTERN).required().messages({ 'string.pattern.base': 'Enter a quantity like 1 or 2.5.', 'string.base': 'Send quantities as text.' }),
  unitPrice: amount.required(),
  taxRate: Joi.string().trim().pattern(RATE_PATTERN).allow(null, '').messages({ 'string.pattern.base': 'Enter a tax rate like 15 or 2.5.' }),
});
const docFields = {
  partyId: objectId,
  issueDate: calendarDate,
  dueDate: calendarDate,
  currency,
  lines: Joi.array().items(line).min(1).max(100),
  notes: Joi.string().trim().max(1000).allow(''),
  terms: Joi.string().trim().max(1000).allow(''),
  reference: Joi.string().trim().max(60).allow(''),
};
const range = Joi.object({ from: calendarDate.required(), to: calendarDate.required(), format: Joi.string().valid('json', 'csv', 'pdf').default('json') });

const sendFile = (res, type, name, body) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(body);
};

const businessInfo = (ws) => ({ name: ws.business?.legalName || ws.name, extra: [ws.business?.industry, ws.business?.country].filter(Boolean).join(', ') });

export const businessRouter = Router();
businessRouter.use(requireAuth, requireWorkspace('records.read'), requireBusiness);

/* customers and suppliers */
for (const [kind, path] of [['customer', 'customers'], ['supplier', 'suppliers']]) {
  businessRouter.get(`/${path}`, validate({ query: Joi.object({ includeArchived: Joi.boolean().default(false), q: Joi.string().trim().max(60).allow('') }) }), async (req, res) => ok(res, await contacts.listParties(kind, req.workspace, req.valid.query)));
  businessRouter.post(`/${path}`, write, validate({ body: Joi.object({ ...partyFields, name: partyFields.name.required() }) }), async (req, res) => created(res, await contacts.createParty(kind, req.workspace, req.valid.body, req.user, requestContext(req))));
  businessRouter.patch(`/${path}/:partyId`, write, validate({ params: id('partyId'), body: Joi.object({ ...partyFields, status: Joi.string().valid('active', 'archived') }).min(1) }), async (req, res) =>
    ok(res, await contacts.updateParty(kind, req.workspace, req.valid.params.partyId, req.valid.body, req.user, requestContext(req))),
  );
  businessRouter.delete(`/${path}/:partyId`, write, validate({ params: id('partyId') }), async (req, res) => {
    await contacts.deleteParty(kind, req.workspace, req.valid.params.partyId, req.user, requestContext(req));
    ok(res, { deleted: true });
  });
}

/* live totals for the editor: the server does the maths */
businessRouter.post('/documents/preview', validate({ body: Joi.object({ lines: Joi.array().items(line).min(1).max(100).required(), currency }) }), (req, res) => ok(res, docs.previewLines(req.valid.body.lines, req.valid.body.currency ?? req.workspace.baseCurrency)));

/* invoices and bills */
for (const [kind, path] of [['invoice', 'invoices'], ['bill', 'bills']]) {
  businessRouter.get(`/${path}`, validate({ query: Joi.object({ status: Joi.string().valid('draft', 'open', 'overdue', 'partially_paid', 'paid', 'void', 'unpaid'), partyId: objectId }) }), async (req, res) =>
    ok(res, await docs.listDocs(kind, req.workspace, today(req), req.valid.query)),
  );
  businessRouter.post(
    `/${path}`,
    write,
    validate({ body: Joi.object({ ...docFields, partyId: objectId.required(), issueDate: calendarDate.required(), dueDate: calendarDate.required(), lines: docFields.lines.required(), issue: Joi.boolean().default(false) }) }),
    async (req, res) => created(res, await docs.createDoc(kind, req.workspace, req.valid.body, req.user, today(req), requestContext(req))),
  );
  businessRouter.get(`/${path}/:docId`, validate({ params: id('docId') }), async (req, res) => ok(res, await docs.getDoc(kind, req.workspace, req.valid.params.docId, today(req))));
  businessRouter.get(`/${path}/:docId/pdf`, validate({ params: id('docId') }), async (req, res) => {
    const d = await docs.getDoc(kind, req.workspace, req.valid.params.docId, today(req));
    sendFile(res, 'application/pdf', `${d.number}.pdf`, await documentPdf(d, businessInfo(req.workspace)));
  });
  businessRouter.patch(`/${path}/:docId`, write, validate({ params: id('docId'), body: Joi.object(docFields).min(1) }), async (req, res) =>
    ok(res, await docs.updateDoc(kind, req.workspace, req.valid.params.docId, req.valid.body, req.user, today(req), requestContext(req))),
  );
  businessRouter.post(`/${path}/:docId/issue`, write, validate({ params: id('docId') }), async (req, res) => ok(res, await docs.issueDoc(kind, req.workspace, req.valid.params.docId, req.user, today(req), requestContext(req))));
  businessRouter.post(`/${path}/:docId/void`, write, validate({ params: id('docId'), body: Joi.object({ reason: Joi.string().trim().max(300).required() }) }), async (req, res) =>
    ok(res, await docs.voidDoc(kind, req.workspace, req.valid.params.docId, req.valid.body.reason, req.user, today(req), requestContext(req))),
  );
  businessRouter.post(
    `/${path}/:docId/payments`,
    write,
    validate({ params: id('docId'), body: Joi.object({ amount: amount.required(), date: calendarDate.required(), accountId: objectId.required(), categoryId: objectId, exchangeRate: rate, notes: Joi.string().trim().max(500).allow('') }) }),
    async (req, res) => {
      const key = req.get('idempotency-key');
      if (key !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw ApiError.badRequest('Idempotency-Key must be 8–100 letters, numbers, dashes or underscores.');
      created(res, await docs.addPayment(kind, req.workspace, req.valid.params.docId, { ...req.valid.body, idempotencyKey: key }, req.user, today(req), requestContext(req)));
    },
  );
  businessRouter.delete(`/${path}/:docId/payments/:paymentId`, write, validate({ params: Joi.object({ docId: objectId.required(), paymentId: objectId.required() }), body: Joi.object({ reason: Joi.string().trim().max(300).required() }) }), async (req, res) =>
    ok(res, await docs.removePayment(kind, req.workspace, req.valid.params.docId, req.valid.params.paymentId, req.valid.body.reason, req.user, today(req), requestContext(req))),
  );
}

/* reports */
businessRouter.get('/overview', validate({ query: Joi.object({ from: calendarDate.required(), to: calendarDate.required() }) }), async (req, res) => ok(res, await reports.businessOverview(req.workspace, req.valid.query, today(req))));

businessRouter.get('/reports/profit-loss', validate({ query: range }), async (req, res) => {
  const pl = await reports.profitAndLoss(req.workspace, req.valid.query);
  const { from, to, format } = req.valid.query;
  if (format === 'pdf') return sendFile(res, 'application/pdf', `profit-and-loss-${from}-to-${to}.pdf`, await profitLossPdf(pl, businessInfo(req.workspace)));
  if (format === 'csv') {
    const rows = [['Section', 'Category', `Amount (${pl.currency})`], ...pl.income.byCategory.map((c) => ['Income', c.name, c.amount]), ['Income', 'Total', pl.income.total], ...pl.expenses.byCategory.map((c) => ['Expenses', c.name, c.amount]), ['Expenses', 'Total', pl.expenses.total], ['Net profit', '', pl.netProfit]];
    return sendFile(res, 'text/csv; charset=utf-8', `profit-and-loss-${from}-to-${to}.csv`, `﻿${rows.map((r) => r.map((v, i) => csvCell(v, { numeric: i === 2 && r !== rows[0] })).join(',')).join('\r\n')}\r\n`);
  }
  ok(res, pl);
});

businessRouter.get('/reports/cash-flow', validate({ query: range }), async (req, res) => {
  const cf = await reports.cashFlow(req.workspace, req.valid.query);
  if (req.valid.query.format === 'csv') {
    const rows = [['Month', `Money in (${cf.currency})`, 'Money out', 'Net', 'Running total'], ...cf.months.map((m) => [m.month, m.inflow, m.outflow, m.net, m.cumulative])];
    return sendFile(res, 'text/csv; charset=utf-8', `cash-flow-${req.valid.query.from}-to-${req.valid.query.to}.csv`, `﻿${rows.map((r, ri) => r.map((v, i) => csvCell(v, { numeric: ri > 0 && i > 0 })).join(',')).join('\r\n')}\r\n`);
  }
  ok(res, cf);
});

businessRouter.get('/reports/receivables', async (req, res) => ok(res, await reports.aging('receivables', req.workspace, today(req))));
businessRouter.get('/reports/payables', async (req, res) => ok(res, await reports.aging('payables', req.workspace, today(req))));
