import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';

import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());

/*
 * CORS.
 *
 * In development the client runs on :5173 and the API on :5000, so the origin
 * has to be allow-listed explicitly. In production both are served from the
 * same Vercel deployment, and every preview deployment gets its own hostname
 * that nobody can know in advance - so rather than trying to keep a list of
 * them in CLIENT_ORIGIN, a request whose Origin matches the host it arrived
 * on is treated as same-origin and allowed.
 */
app.use(
  cors((req, done) => {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (env.isServerless ? 'https' : 'http');

    const sameOrigin = Boolean(origin && host && origin === `${proto}://${host}`);
    const allowed =
      !origin || sameOrigin || env.clientOrigin.includes(origin) || env.clientOrigin.includes('*');

    done(null, { origin: allowed, credentials: true });
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
if (env.nodeEnv !== 'test' && !env.isServerless) app.use(morgan('dev'));

/*
 * Health check.
 *
 * Deliberately registered before the database middleware below, and it never
 * fails: if the API is running but cannot reach MongoDB, the useful answer is
 * "the API is up, the database is not", not a 500 that looks identical to the
 * whole deployment being broken.
 */
const DB_STATE = ['disconnected', 'connected', 'connecting', 'disconnecting'];

const health = (_req, res) =>
  res.json({
    status: 'ok',
    service: 'biscuit-erp-api',
    env: env.nodeEnv,
    database: DB_STATE[mongoose.connection.readyState] ?? 'unknown',
    time: new Date().toISOString(),
  });

app.get('/api/health', health);
app.get('/health', health);

/*
 * Every request opens (or reuses) the database connection before it reaches a
 * route. On a long-lived server this is a no-op after the first request; on
 * serverless it is what makes a cold start work at all, because there is no
 * boot phase in which to connect.
 */
app.use(async (_req, _res, next) => {
  try {
    await connectDb();
    next();
  } catch (err) {
    next(err);
  }
});

/*
 * Brute-force protection on the login route.
 *
 * Two deliberate choices, because a factory normally sits behind a single
 * shared public address:
 *
 *  - only FAILED attempts count. Signing in successfully is not an attack,
 *    and counting it locks out legitimate users for no security benefit.
 *  - the limit is keyed on the ADDRESS + the ACCOUNT being targeted, so one
 *    person fat-fingering their password cannot lock their colleagues out of
 *    the system. Guessing at one account still trips after 10 tries.
 *
 * Note for serverless: the counter lives in the memory of one instance, so
 * under heavy traffic an attacker gets a few more tries than the limit
 * suggests. Move to a shared store if this ever becomes the only defence.
 */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const account = String(req.body?.email || 'unknown').toLowerCase().trim();
    return (req.ip || 'unknown-ip') + '|' + account;
  },
  message: {
    error:
      'Too many failed sign-in attempts for this account. Wait a few minutes, or ask an administrator to reset the password.',
  },
});


/*
 * The router is mounted twice on purpose.
 *
 * Locally the API owns the whole origin, so the paths are /api/*. On Vercel
 * the platform rewrites /api/* onto this function, and whether the function
 * sees the original path or the path with the /api prefix already consumed
 * is an implementation detail of the router layer. Mounting at both means
 * the same code serves either shape. Nothing but /api/* is ever routed here,
 * so the bare mount cannot shadow a front-end route.
 */
app.use('/api/auth/login', loginLimiter);
app.use('/auth/login', loginLimiter);

app.use('/api', routes);
app.use('/', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
