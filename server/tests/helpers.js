import request from 'supertest';
import { createApp } from '../config/express.js';
import { outbox } from '../services/mailer.js';

export const app = createApp();
export const api = () => request(app);

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}${counter}.${Date.now()}@example.com`;
}

export const PASSWORD = 'correct horse 42';

export async function registerUser(overrides = {}) {
  const body = {
    name: 'Ama Mensah',
    email: uniqueEmail(),
    password: PASSWORD,
    defaultCurrency: 'GHS',
    acceptTerms: true,
    acceptPrivacy: true,
    ...overrides,
  };
  const res = await api().post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    user: res.body.data.user,
    token: res.body.data.accessToken,
    cookie: res.headers['set-cookie'],
    email: body.email,
    auth: { Authorization: `Bearer ${res.body.data.accessToken}` },
  };
}

/** Pulls the token query parameter out of the last email sent to an address. */
export function tokenFromEmail(to, path) {
  const mail = [...outbox].reverse().find((m) => m.to === to && m.text.includes(path));
  if (!mail) throw new Error(`No email to ${to} containing ${path}`);
  return new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
}

export function refreshCookieValue(setCookie) {
  const raw = [].concat(setCookie).find((c) => c.startsWith('bf_rt='));
  return raw?.split(';')[0];
}
