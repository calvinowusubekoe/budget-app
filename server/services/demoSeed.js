/**
 * The shared demo account for testers: a fictional person ("Efua Owusu") with
 * a personal workspace, a Susu group and a small catering business.
 *
 * Everything is created through Kontaa's own API, on a private port in this
 * process, so every figure goes through the same validation and calculations
 * as real use. All names and amounts are invented sample data.
 *
 * Used by scripts/seed-demo.js (by hand) and, for APP_STAGE=test, at server
 * start when the demo account doesn't exist yet.
 */
import mongoose from 'mongoose';
import { createApp } from '../config/express.js';
import { logger } from '../utils/logger.js';
import { addDays, addMonths, todayIn } from '../utils/periods.js';
import { User } from '../modules/users/user.model.js';
import { Workspace } from '../modules/workspaces/workspace.model.js';
import { SusuGroup } from '../modules/susu/group.models.js';

let EMAIL = '';
let PASSWORD = '';
let RESET = false;
let TODAY = todayIn('Africa/Accra');
const day = (n) => addDays(TODAY, n);
export const validDemoPassword = (p) => /^(?=.*[A-Za-z])(?=.*\d).{10,72}$/.test(p ?? '');

/* Small deterministic randomness, so every reset gives the same demo. */
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (min, max) => (min + rand() * (max - min)).toFixed(2);

let base = '';
let token = '';
async function call(method, path, body, { workspaceId } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json.error ?? json)}`);
  return json.data;
}

async function removeExisting() {
  const user = await User.findOne({ email: EMAIL });
  if (!user) return false;
  if (!RESET) return true;
  const workspaces = (await Workspace.find({ ownerId: user._id }).select('_id').lean()).map((w) => w._id);
  const groups = (await SusuGroup.find({ createdBy: user._id }).select('_id').lean()).map((g) => g._id);
  for (const model of Object.values(mongoose.models)) {
    const paths = model.schema.paths;
    if (paths.workspaceId && workspaces.length) await model.deleteMany({ workspaceId: { $in: workspaces } });
    if (paths.groupId && groups.length) await model.deleteMany({ groupId: { $in: groups } });
    // Feedback sent from the demo account is kept: resetting the demo must never lose testers' notes.
    if (paths.userId && !['User', 'Feedback'].includes(model.modelName)) await model.deleteMany({ userId: user._id });
  }
  await Workspace.deleteMany({ _id: { $in: workspaces } });
  await SusuGroup.deleteMany({ _id: { $in: groups } });
  await User.deleteOne({ _id: user._id });
  logger.info('demo: removed the old demo data');
  return false;
}

async function personal(wsId) {
  const w = { workspaceId: wsId };
  const cats = await call('GET', '/categories', null, w);
  const cat = (kind, key) => cats.find((c) => c.kind === kind && c.systemKey === key)?.id;
  const momo = await call('POST', '/accounts', { name: 'MTN MoMo', type: 'mobile_money', currency: 'GHS', openingBalance: '850.00', openingDate: day(-90) }, w);
  const bank = await call('POST', '/accounts', { name: 'GCB Savings', type: 'bank', currency: 'GHS', institution: 'GCB Bank', openingBalance: '4200.00', openingDate: day(-90) }, w);
  const cash = await call('POST', '/accounts', { name: 'Cash', type: 'cash', currency: 'GHS', openingBalance: '600.00', openingDate: day(-90) }, w);
  const usd = await call('POST', '/accounts', { name: 'Dollar card', type: 'bank', currency: 'USD', openingBalance: '120.00', openingDate: day(-90) }, w);
  const tx = (body) => call('POST', '/transactions', body, w);

  for (let m = 2; m >= 0; m -= 1) {
    // Paid on the 1st, so the current month always has income to compare against.
    const first = addMonths(`${TODAY.slice(0, 7)}-01`, -m);
    const on = (d) => (addDays(first, d) <= TODAY ? addDays(first, d) : first);
    if (first <= TODAY) {
      await tx({ type: 'income', accountId: bank.id, categoryId: cat('income', 'salary'), amount: '6500.00', date: first, description: 'Salary, Adom Logistics', payee: 'Adom Logistics' });
      await tx({ type: 'expense', accountId: bank.id, categoryId: cat('expense', 'housing'), amount: '1500.00', date: on(2), description: 'Rent, East Legon flat', payee: 'Landlord' });
      await tx({ type: 'expense', accountId: momo.id, categoryId: cat('expense', 'utilities'), amount: between(180, 260), date: on(3), description: 'ECG prepaid', payee: 'ECG' });
      await tx({ type: 'expense', accountId: momo.id, categoryId: cat('expense', 'subscriptions'), amount: '99.00', date: on(5), description: 'Data bundle', payee: 'MTN' });
      await tx({ type: 'transfer', accountId: bank.id, toAccountId: momo.id, amount: '1200.00', date: on(1), description: 'Top up MoMo' });
    }
  }
  for (let d = -80; d <= 0; d += 3) {
    await tx({ type: 'expense', accountId: rand() > 0.3 ? momo.id : cash.id, categoryId: cat('expense', 'transport'), amount: between(8, 45), date: day(d), description: rand() > 0.5 ? 'Trotro' : 'Bolt ride' });
  }
  for (let d = -84; d <= 0; d += 7) {
    await tx({ type: 'expense', accountId: momo.id, categoryId: cat('expense', 'food'), amount: between(180, 340), date: day(d), description: 'Groceries, Makola', payee: 'Makola market' });
    if (rand() > 0.5) await tx({ type: 'expense', accountId: momo.id, categoryId: cat('expense', 'entertainment'), amount: between(60, 180), date: day(d + 2 > 0 ? d : d + 2), description: 'Dinner with friends' });
  }
  await tx({ type: 'income', accountId: momo.id, categoryId: cat('income', 'freelance'), amount: '1800.00', date: day(-40), description: 'Logo design job', payee: 'Ama Boutique' });
  await tx({ type: 'expense', accountId: momo.id, categoryId: cat('expense', 'healthcare'), amount: '320.00', date: day(-26), description: 'Pharmacy and consultation' });
  await tx({ type: 'expense', accountId: usd.id, categoryId: cat('expense', 'subscriptions'), amount: '15.99', date: day(-12), description: 'Design software', payee: 'Canva', exchangeRate: '15.40' });
  await tx({ type: 'expense', accountId: bank.id, categoryId: cat('expense', 'education'), amount: '2400.00', date: day(-8), description: 'School fees, first term', payee: 'Ridge Academy' });

  await call('POST', '/budgets', { name: 'Food', period: 'monthly', scope: 'categories', categoryIds: [cat('expense', 'food')], amount: '1200', alertAt: 80 }, w);
  await call('POST', '/budgets', { name: 'Getting around', period: 'monthly', scope: 'categories', categoryIds: [cat('expense', 'transport')], amount: '400', alertAt: 80 }, w);
  await call('POST', '/budgets', { name: 'Fun', period: 'monthly', scope: 'categories', categoryIds: [cat('expense', 'entertainment')], amount: '300', alertAt: 75 }, w);

  const goal = await call('POST', '/savings-goals', { name: 'Emergency fund', targetAmount: '10000', currency: 'GHS', targetDate: addMonths(TODAY, 8), contributionFrequency: 'monthly' }, w);
  for (const [d, a] of [[-75, '800'], [-45, '800'], [-15, '1000']]) await call('POST', `/savings-goals/${goal.id}/entries`, { type: 'contribution', amount: a, date: day(d) }, w);
  await call('POST', '/savings-goals', { name: 'New laptop', targetAmount: '9000', currency: 'GHS', contributionFrequency: 'none' }, w);

  const debt = await call('POST', '/debts', { name: 'Loan from Auntie Esi', direction: 'i_owe', counterparty: 'Auntie Esi', principal: '2000', currency: 'GHS', startDate: day(-60), dueDate: day(30) }, w);
  await call('POST', `/debts/${debt.id}/payments`, { amount: '500', date: day(-20) }, w);

  await call('POST', '/recurring', { type: 'expense', accountId: momo.id, categoryId: cat('expense', 'subscriptions'), amount: '99.00', description: 'Data bundle', frequency: 'monthly', startDate: addMonths(`${TODAY.slice(0, 7)}-05`, 1) }, w);

  const plan = await call('POST', '/susu/plans', { name: 'Daily market susu', currency: 'GHS', contributionAmount: '20', frequency: 'daily', startDate: day(-24), location: { type: 'collector', label: 'Auntie Akos' }, targetAmount: '600' }, w);
  for (let d = -24; d <= -1; d += 1) if (rand() > 0.2) await call('POST', `/susu/plans/${plan.id}/contributions`, { amount: '20', date: day(d) }, w);
}

async function group() {
  const g = await call('POST', '/susu/groups', { name: 'Osu Traders Susu', currency: 'GHS', contributionAmount: '200', frequency: 'weekly', startDate: day(-21), description: 'Weekly susu among stall owners at Osu market' });
  for (const name of ['Maame Efua', 'Kojo Asante', 'Adwoa Mensah']) await call('POST', `/susu/groups/${g.id}/members`, { displayName: name });
  const cycles = await call('POST', `/susu/groups/${g.id}/cycles`, { generate: true });
  const members = await call('GET', `/susu/groups/${g.id}/members`);
  for (const c of cycles.filter((x) => x.dueDate <= TODAY)) {
    for (const m of members) if (rand() > 0.15) await call('POST', `/susu/groups/${g.id}/cycles/${c.id}/contributions`, { memberId: m.id, amount: '200', date: c.dueDate });
    if (c.dueDate < TODAY) await call('POST', `/susu/groups/${g.id}/cycles/${c.id}/payouts`, { actualAmount: '800', payoutDate: c.dueDate, confirmationDetails: 'Cash at the stall' });
  }
}

async function business() {
  const ws = await call('POST', '/workspaces', { name: 'Efua’s Catering', type: 'business', baseCurrency: 'GHS', business: { legalName: 'Efua’s Catering Services', industry: 'Food and catering', country: 'GH' } });
  const w = { workspaceId: ws.id };
  const cats = await call('GET', '/categories', null, w);
  const cat = (kind, key) => cats.find((c) => c.kind === kind && c.systemKey === key)?.id;
  const momo = await call('POST', '/accounts', { name: 'Business MoMo', type: 'mobile_money', currency: 'GHS', openingBalance: '1500.00', openingDate: day(-60) }, w);
  const bank = await call('POST', '/accounts', { name: 'Ecobank current', type: 'bank', currency: 'GHS', openingBalance: '8000.00', openingDate: day(-60) }, w);
  const c1 = await call('POST', '/business/customers', { name: 'Labadi Beach Hotel', email: 'events@labadi.example' }, w);
  const c2 = await call('POST', '/business/customers', { name: 'Kanda Church', phone: '+233 24 000 0000' }, w);
  const s1 = await call('POST', '/business/suppliers', { name: 'Makola Wholesale Foods' }, w);

  const paidInv = await call('POST', '/business/invoices', { partyId: c1.id, issueDate: day(-35), dueDate: day(-21), lines: [{ description: 'Wedding buffet, 120 guests', quantity: '120', unitPrice: '85.50', taxRate: '15' }, { description: 'Serving staff', quantity: '8', unitPrice: '45' }], issue: true }, w);
  await call('POST', `/business/invoices/${paidInv.id}/payments`, { amount: paidInv.total, date: day(-20), accountId: bank.id }, w);
  const partInv = await call('POST', '/business/invoices', { partyId: c2.id, issueDate: day(-18), dueDate: day(-4), lines: [{ description: 'Harvest thanksgiving lunch, 80 plates', quantity: '80', unitPrice: '60' }], issue: true }, w);
  await call('POST', `/business/invoices/${partInv.id}/payments`, { amount: '2000.00', date: day(-10), accountId: momo.id }, w);
  await call('POST', '/business/invoices', { partyId: c1.id, issueDate: day(-3), dueDate: day(11), lines: [{ description: 'Conference lunch, 2 days', quantity: '2', unitPrice: '3500' }], issue: true }, w);
  await call('POST', '/business/invoices', { partyId: c2.id, issueDate: TODAY, dueDate: day(14), lines: [{ description: 'Youth camp catering (draft)', quantity: '1', unitPrice: '4200' }] }, w);

  const bill = await call('POST', '/business/bills', { partyId: s1.id, reference: 'MWF-2291', issueDate: day(-25), dueDate: day(5), lines: [{ description: 'Rice, oil and spices', quantity: '1', unitPrice: '3150' }], issue: true }, w);
  await call('POST', `/business/bills/${bill.id}/payments`, { amount: '1500.00', date: day(-15), accountId: bank.id }, w);
  for (const [d, a, desc] of [[-30, '420.00', 'Gas refill'], [-14, '650.00', 'Van fuel and repairs'], [-5, '380.00', 'Packaging']]) {
    await call('POST', '/transactions', { type: 'expense', accountId: momo.id, categoryId: cat('expense', 'business_expenses'), amount: a, date: day(d), description: desc }, w);
  }
}

/**
 * Creates the demo account. Returns 'created', or 'exists' when it's already
 * there and reset is false. With reset, the old demo data is deleted first.
 */
export async function seedDemo({ email, password, reset = false }) {
  if (!validDemoPassword(password)) throw new Error('DEMO_PASSWORD must be 10+ characters with a letter and a number.');
  EMAIL = email.toLowerCase();
  PASSWORD = password;
  RESET = reset;
  TODAY = todayIn('Africa/Accra');
  seed = 42;
  token = '';
  if (await removeExisting()) return 'exists';
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    const reg = await call('POST', '/auth/register', { name: 'Efua Owusu', email: EMAIL, password: PASSWORD, defaultCurrency: 'GHS', acceptTerms: true, acceptPrivacy: true });
    token = reg.accessToken;
    await User.updateOne({ _id: reg.user.id }, { $set: { emailVerifiedAt: new Date() } });
    await call('PATCH', '/users/me', { onboardingCompleted: true });
    await personal(reg.user.lastWorkspaceId);
    await group();
    await business();
    return 'created';
  } finally {
    server.close();
  }
}
