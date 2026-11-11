/**
 * Creates (or recreates) the shared demo account for testers.
 *
 *   npm run seed:demo --workspace server            # create if missing
 *   npm run seed:demo --workspace server -- --reset # delete the demo data and create it again
 *
 * Uses DEMO_EMAIL and DEMO_PASSWORD (and MONGODB_URI) from the environment or .env.
 * Real environment variables win, so you can seed a hosted database from your
 * computer by setting MONGODB_URI for this one command.
 */
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { seedDemo, validDemoPassword } from '../services/demoSeed.js';

const email = process.env.DEMO_EMAIL || 'demo@kontaa.app';
const password = process.env.DEMO_PASSWORD || '';
if (!validDemoPassword(password)) {
  console.error('Set DEMO_PASSWORD (10+ characters with a letter and a number) before seeding.');
  process.exit(1);
}

try {
  await connectDatabase();
  const result = await seedDemo({ email, password, reset: process.argv.includes('--reset') });
  if (result === 'exists') console.log(`The demo account ${email} already exists. Run with --reset to recreate it.`);
  else console.log(`Demo account ready: ${email}
It has a personal workspace, a Susu group and a business workspace ("Efua’s Catering").`);
  if (env.stage !== 'test') console.log('Note: APP_STAGE is not "test", so the sign-in page won’t offer the demo account.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
