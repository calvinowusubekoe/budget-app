import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission, requireWorkspace } from '../../middleware/workspace.js';
import { validate } from '../../middleware/validate.js';
import { currency, objectId } from '../../validators/common.js';
import { amount, calendarDate, rate } from '../../validators/money.js';
import { created, ok, requestContext } from '../../utils/http.js';
import { convert, fitsCurrency } from '../../utils/money.js';
import { ApiError } from '../../utils/ApiError.js';
import { activeProvider } from './providers.js';
import * as svc from './rates.service.js';

const listSchema = { query: Joi.object({ from: currency, to: currency, limit: Joi.number().integer().min(1).max(500).default(100) }) };
const createSchema = { body: Joi.object({ from: currency.required(), to: currency.required(), rate: rate.required(), effectiveDate: calendarDate.required() }) };
const fetchSchema = { body: Joi.object({ from: currency.required(), to: currency.required() }) };
const resolveSchema = { query: Joi.object({ from: currency.required(), to: currency, date: calendarDate.required(), amount }) };
const idSchema = { params: Joi.object({ rateId: objectId.required() }) };

export const ratesRouter = Router();
ratesRouter.use(requireAuth, requireWorkspace('records.read'));

ratesRouter.get('/', validate(listSchema), async (req, res) =>
  ok(res, await svc.listRates(req.workspace._id, req.valid.query), { meta: { provider: activeProvider()?.label ?? null } }),
);

/** Preview for forms: which rate would be used and what the amount converts to. */
ratesRouter.get('/resolve', validate(resolveSchema), async (req, res) => {
  const { from, date, amount: value } = req.valid.query;
  const to = req.valid.query.to ?? req.workspace.baseCurrency;
  const found = await svc.findRate(req.workspace._id, from, to, date);
  if (value && !fitsCurrency(value, from)) throw ApiError.badRequest(`${from} amounts can’t have that many decimal places.`);
  ok(res, {
    from,
    to,
    date,
    found: Boolean(found),
    ...(found ?? {}),
    convertedAmount: found && value ? convert(value, found.rate, to) : null,
    providerAvailable: Boolean(activeProvider()),
  });
});

ratesRouter.post('/', requirePermission('records.write'), validate(createSchema), async (req, res) =>
  created(res, await svc.saveManualRate(req.workspace, req.valid.body, req.user, requestContext(req))),
);

ratesRouter.post('/fetch', requirePermission('records.write'), validate(fetchSchema), async (req, res) =>
  created(res, await svc.fetchAndStoreProviderRate(req.workspace, req.valid.body, req.user, requestContext(req))),
);

ratesRouter.delete('/:rateId', requirePermission('records.write'), validate(idSchema), async (req, res) => {
  await svc.deleteRate(req.workspace, req.valid.params.rateId, req.user, requestContext(req));
  ok(res, { deleted: true });
});
