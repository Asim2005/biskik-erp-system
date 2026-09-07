import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * Locally the configuration lives in server/.env. On Vercel there is no .env
 * file - the values are injected as real environment variables - so a missing
 * file here is expected and not an error.
 */
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isServerless = Boolean(process.env.VERCEL);

if (isServerless) {
  for (const key of ['MONGO_URI', 'JWT_SECRET']) {
    if (!process.env[key]) {
      throw new Error(
        `${key} is not set. Add it under Project Settings -> Environment Variables in Vercel.`
      );
    }
  }
}

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isServerless,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/biscuit_erp',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production',
  jwtExpires: process.env.JWT_EXPIRES || '12h',
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
