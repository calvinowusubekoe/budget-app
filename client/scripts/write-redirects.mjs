// Writes client/public/_redirects for Netlify from KONTAA_API_ORIGIN.
// /api/* is proxied (status 200) to the API, so cookies stay first-party; everything else is the app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = (process.env.KONTAA_API_ORIGIN || '').trim().replace(/\/+$/, '');
if (!/^https:\/\/[^/\s]+$/.test(origin)) {
  console.error('Set KONTAA_API_ORIGIN to the API address, e.g. https://kontaa-api.onrender.com (https, no path).');
  process.exit(1);
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', '_redirects');
fs.writeFileSync(out, `/api/*  ${origin}/api/:splat  200!\n/*  /index.html  200\n`);
console.log(`Wrote ${out} -> ${origin}`);
