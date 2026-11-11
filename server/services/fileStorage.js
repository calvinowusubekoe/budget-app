import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';

/**
 * Local-disk storage for user uploads (receipts, Susu proof). Files live under
 * UPLOAD_DIR/<workspaceId>/ with random names and are only ever served through
 * authenticated, workspace-checked endpoints.
 *
 * With UPLOAD_STORAGE=mongodb, files are stored in the database instead
 * (keys start with "db:"), for hosts whose disks don't survive a restart.
 * Either kind of key can always be read, so switching modes keeps old files.
 * Callers only use the functions below.
 */

const StoredFile = mongoose.models.StoredFile ?? mongoose.model('StoredFile', new mongoose.Schema({ owner: { type: String, required: true, index: true }, data: { type: Buffer, required: true } }, { timestamps: { createdAt: true, updatedAt: false } }));
const DB_PREFIX = 'db:';
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uploadRoot = () => path.resolve(serverRoot, env.uploads.dir);

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** The declared MIME type is not trusted; the first bytes must match an allowed format. */
export function sniffType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** Filenames are display-only; strip paths and control characters. */
export function cleanName(name) {
  const base = path.basename(String(name ?? 'file')).replace(/[\u0000-\u001f\u007f"\\/]/g, '').trim();
  return base.slice(0, 200) || 'file';
}

/** Validates and stores an uploaded file. Returns metadata to save on the owning record. */
export async function saveUpload(workspaceId, file, { storage = env.uploads.storage } = {}) {
  if (!file) throw ApiError.badRequest('Choose a file to attach.');
  const mimeType = sniffType(file.buffer);
  if (!mimeType) throw new ApiError(415, 'UNSUPPORTED_FILE', 'Attach a JPG, PNG, WebP image or a PDF.');
  let storageKey;
  if (storage === 'mongodb') {
    const doc = await StoredFile.create({ owner: String(workspaceId), data: file.buffer });
    storageKey = `${DB_PREFIX}${doc._id}`;
  } else {
    storageKey = path.join(String(workspaceId), `${crypto.randomUUID()}.bin`);
    const target = path.join(uploadRoot(), storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.buffer, { flag: 'wx' });
  }
  return {
    storageKey,
    originalName: cleanName(file.originalname),
    mimeType,
    size: file.size,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
  };
}

const dbId = (key) => {
  const id = key.slice(DB_PREFIX.length);
  return mongoose.isValidObjectId(id) ? id : null;
};

export async function readUpload(storageKey) {
  if (storageKey.startsWith(DB_PREFIX)) {
    const doc = dbId(storageKey) && (await StoredFile.findById(dbId(storageKey)).lean());
    if (!doc) throw ApiError.notFound('File not found.');
    return Buffer.from(doc.data.buffer ?? doc.data);
  }
  const file = path.join(uploadRoot(), storageKey);
  // Defence in depth: never read outside the upload root.
  if (!file.startsWith(uploadRoot() + path.sep)) throw ApiError.notFound('File not found.');
  return fs.readFile(file);
}

export async function removeUpload(storageKey) {
  if (storageKey.startsWith(DB_PREFIX)) {
    if (dbId(storageKey)) await StoredFile.deleteOne({ _id: dbId(storageKey) });
    return;
  }
  const file = path.join(uploadRoot(), storageKey);
  if (file.startsWith(uploadRoot() + path.sep)) await fs.rm(file, { force: true });
}

/** Sends a stored file as a download with headers that stop it running in the browser. */
export function sendUpload(res, meta, data) {
  res.setHeader('Content-Type', meta.mimeType);
  res.setHeader('Content-Length', data.length);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.originalName)}"; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(data);
}
