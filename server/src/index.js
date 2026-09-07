/**
 * Local development entry point.
 *
 * Vercel does not use this file - it imports the app from ./app.js through
 * api/index.js at the repository root. Everything here is about running a
 * real long-lived listener on your own machine.
 */
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';

try {
  await connectDb();
} catch (err) {
  console.error('[db] connection failed:', err.message);
  console.error('[db] Is MongoDB running?  Check MONGO_URI in server/.env');
  process.exit(1);
}

app.listen(env.port, () => {
  console.log('');
  console.log('  Biscuit Manufacturing ERP - API');
  console.log('  http://localhost:' + env.port + '/api');
  console.log('  env: ' + env.nodeEnv + '   client origin: ' + env.clientOrigin.join(', '));
  console.log('');
});
