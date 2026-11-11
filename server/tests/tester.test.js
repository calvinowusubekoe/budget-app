import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { productionProblems } from '../config/production.js';
import { readUpload, removeUpload, saveUpload } from '../services/fileStorage.js';
import { seedDemo } from '../services/demoSeed.js';
import { User } from '../modules/users/user.model.js';
import { Workspace } from '../modules/workspaces/workspace.model.js';
import { Transaction } from '../modules/transactions/transaction.model.js';
import { Invoice } from '../modules/business/business.models.js';
import { Feedback } from '../modules/feedback/feedback.model.js';
import { api, registerUser } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image body')]);

describe('feedback', () => {
  it('lets any signed-in person send feedback, and only admins read it', async () => {
    const tester = await registerUser({ name: 'Kofi Tester' });
    const h = { ...tester.auth, 'X-Workspace-Id': tester.user.lastWorkspaceId };
    await api().post('/api/feedback').set(h).send({ category: 'confusing', message: 'What does "behind schedule" mean on Susu?', rating: 4, page: '/susu/plans/1', viewport: '390x844' }).expect(201);
    await api().post('/api/feedback').set(tester.auth).send({ category: 'nonsense', message: 'x' }).expect(422);
    await api().post('/api/feedback').send({ category: 'bug', message: 'no session' }).expect(401);

    // Not an admin: the inbox doesn't exist for them.
    await api().get('/api/feedback').set(tester.auth).expect(404);
    expect((await api().get('/api/auth/me').set(tester.auth)).body.data.user.isAdmin).toBe(false);

    const admin = await registerUser({ name: 'Owner', email: 'admin@example.com' });
    expect((await api().get('/api/auth/me').set(admin.auth)).body.data.user.isAdmin).toBe(true);
    const list = await api().get('/api/feedback').set(admin.auth).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ category: 'confusing', rating: 4, page: '/susu/plans/1', workspaceType: 'personal', status: 'new', from: { name: 'Kofi Tester' } });
    expect(list.body.meta.counts).toEqual({ new: 1 });

    const id = list.body.data[0].id;
    await api().patch(`/api/feedback/${id}`).set(tester.auth).send({ status: 'done' }).expect(404);
    await api().patch(`/api/feedback/${id}`).set(admin.auth).send({ status: 'done' }).expect(200);
    expect((await api().get('/api/feedback?status=done').set(admin.auth)).body.data).toHaveLength(1);
  });

  it('does not record a workspace the sender is not a member of', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await api().post('/api/feedback').set({ ...a.auth, 'X-Workspace-Id': b.user.lastWorkspaceId }).send({ category: 'idea', message: 'Dark mode on charts' }).expect(201);
    const admin = await registerUser({ email: 'admin@example.com' });
    expect((await api().get('/api/feedback').set(admin.auth)).body.data[0].workspaceType).toBeNull();
  });

  it('reports the stage in /api/meta', async () => {
    const meta = (await api().get('/api/meta').expect(200)).body.data;
    expect(meta).toMatchObject({ stage: 'live', demo: null });
  });
});

describe('uploads stored in MongoDB', () => {
  it('saves, reads and removes files in the database, alongside disk files', async () => {
    const ws = new mongoose.Types.ObjectId();
    const meta = await saveUpload(ws, { buffer: PNG, size: PNG.length, originalname: '../momo.png' }, { storage: 'mongodb' });
    expect(meta).toMatchObject({ mimeType: 'image/png', originalName: 'momo.png', size: PNG.length });
    expect(meta.storageKey).toMatch(/^db:[a-f0-9]{24}$/);
    expect((await readUpload(meta.storageKey)).equals(PNG)).toBe(true);
    await removeUpload(meta.storageKey);
    await expect(readUpload(meta.storageKey)).rejects.toThrow('File not found.');
    await expect(readUpload('db:not-an-id')).rejects.toThrow('File not found.');

    const disk = await saveUpload(ws, { buffer: PNG, size: PNG.length, originalname: 'a.png' }, { storage: 'disk' });
    expect((await readUpload(disk.storageKey)).equals(PNG)).toBe(true);
    await removeUpload(disk.storageKey);
  });
});

describe('test builds in production', () => {
  const base = { CLIENT_URL: 'https://kontaa-test.netlify.app', COOKIE_SECURE: true, SMTP_HOST: '', JWT_ACCESS_SECRET: 'a'.repeat(64), AI_PROVIDER: 'none', TRUST_PROXY: 2, UPLOAD_STORAGE: 'mongodb', UPLOAD_DIR: 'uploads', CORS_ORIGINS: '' };
  it('may run without SMTP when APP_STAGE=test, with a warning', () => {
    const { errors, warnings } = productionProblems({ ...base, APP_STAGE: 'test' }, { MONGODB_URI: 'mongodb+srv://x' });
    expect(errors).toEqual([]);
    expect(warnings.join(' ')).toMatch(/No SMTP/);
    expect(warnings.join(' ')).toMatch(/tester build/);
  });
  it('still requires SMTP for a live launch', () => {
    expect(productionProblems({ ...base, APP_STAGE: 'live' }, { MONGODB_URI: 'mongodb+srv://x' }).errors.join(' ')).toMatch(/SMTP_HOST/);
  });
});

describe('demo account', () => {
  it('creates a full demo once, and recreates it cleanly on reset', async () => {
    const opts = { email: 'Demo@Kontaa.app', password: 'kontaa demo 2026' };
    expect(await seedDemo(opts)).toBe('created');
    const user = await User.findOne({ email: 'demo@kontaa.app' });
    expect(user.emailVerifiedAt).toBeTruthy();
    expect(user.onboardingCompletedAt).toBeTruthy();
    const workspaces = await Workspace.find({ ownerId: user._id });
    expect(workspaces.map((w) => w.type).sort()).toEqual(['business', 'personal']);
    const txCount = await Transaction.countDocuments({ workspaceId: { $in: workspaces.map((w) => w._id) } });
    expect(txCount).toBeGreaterThan(40);
    expect(await Invoice.countDocuments()).toBe(4);

    expect(await seedDemo(opts)).toBe('exists');
    const login1 = await api().post('/api/auth/login').send({ email: 'demo@kontaa.app', password: 'kontaa demo 2026' }).expect(200);
    await api().post('/api/feedback').set({ Authorization: `Bearer ${login1.body.data.accessToken}` }).send({ category: 'idea', message: 'Keep me after a reset' }).expect(201);
    expect(await seedDemo({ ...opts, reset: true })).toBe('created');
    expect(await Feedback.countDocuments({ message: 'Keep me after a reset' })).toBe(1); // testers' notes survive a reset
    expect(await User.countDocuments({ email: 'demo@kontaa.app' })).toBe(1);
    expect(await Workspace.countDocuments({ ownerId: (await User.findOne({ email: 'demo@kontaa.app' }))._id })).toBe(2);
    expect(await Invoice.countDocuments()).toBe(4);

    const login = await api().post('/api/auth/login').send({ email: 'demo@kontaa.app', password: 'kontaa demo 2026' }).expect(200);
    expect(login.body.data.user.name).toBe('Efua Owusu');
  });

  it('refuses a weak demo password', async () => {
    await expect(seedDemo({ email: 'demo@kontaa.app', password: 'short' })).rejects.toThrow(/DEMO_PASSWORD/);
  });
});
