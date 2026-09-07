/**
 * Vercel serverless entry point for the whole API.
 *
 * vercel.json rewrites every /api/* request onto this one function, which
 * hands it to the same Express app the local server runs. There is no
 * app.listen() here: Vercel invokes the exported handler directly.
 */
import { app } from '../server/src/app.js';

export default app;
