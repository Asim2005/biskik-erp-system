import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

/*
 * On a normal server this module would just connect once at boot. On Vercel
 * the API runs as a serverless function: the process is frozen between
 * requests and thawed again for the next one, so a fresh connection per
 * request would exhaust the Atlas connection limit within minutes.
 *
 * The connection (and the in-flight promise for it) is therefore parked on
 * globalThis, which survives across invocations of the same warm instance.
 * A second concurrent request awaits the same promise instead of dialling
 * MongoDB again.
 */
const cache = (globalThis.__biscuitErpMongo ??= { conn: null, promise: null });

export async function connectDb() {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(env.mongoUri, {
        serverSelectionTimeoutMS: 8000,
        // A serverless instance handles one request at a time, so a large
        // pool buys nothing and costs Atlas connection slots.
        maxPoolSize: env.isServerless ? 5 : 10,
      })
      .catch((err) => {
        // Let the next request retry rather than caching a rejected promise.
        cache.promise = null;
        throw err;
      });
  }

  cache.conn = await cache.promise;
  const { host, name } = mongoose.connection;
  if (!env.isServerless) console.log(`[db] connected -> ${host}/${name}`);
  return cache.conn;
}
