/**
 * Copies every collection from one MongoDB database into another, documents
 * and indexes alike, preserving _id values so that every reference between
 * documents still resolves.
 *
 * The intended use is moving the local development database onto Atlas
 * before the first deployment, so the accounts, materials, recipes and books
 * you already have keep working in production.
 *
 *   npm run migrate -- --to "mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/biscuit_erp"
 *
 * Options
 *   --from <uri>   source database   (default: MONGO_URI, i.e. your local one)
 *   --to <uri>     destination       (required; may also be set as TARGET_URI)
 *   --drop         empty each destination collection before copying into it
 *   --dry-run      report what would be copied and change nothing
 *
 * Without --drop the copy refuses to touch a destination collection that
 * already has documents, so running it twice by accident cannot duplicate or
 * silently merge your data.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';

const { MongoClient } = mongoose.mongo;

const BATCH = 500;

/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = { drop: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--drop') args.drop = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--from=')) args.from = a.slice(7);
    else if (a.startsWith('--to=')) args.to = a.slice(5);
  }
  return args;
}

/** Hides the password so a connection string can safely go in a log. */
function redact(uri) {
  return uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:****@');
}

/**
 * mongodb+srv://user:pass@host/biscuit_erp?opts -> "biscuit_erp"
 * Atlas hands you a string with no database name at all, which would quietly
 * dump everything into "test", so that case is caught rather than guessed.
 */
function databaseNameOf(uri) {
  const withoutQuery = uri.split('?')[0];
  const afterScheme = withoutQuery.replace(/^mongodb(\+srv)?:\/\//, '');
  const at = afterScheme.lastIndexOf('@');
  const afterCredentials = at === -1 ? afterScheme : afterScheme.slice(at + 1);
  const slash = afterCredentials.indexOf('/');
  if (slash === -1) return '';
  return decodeURIComponent(afterCredentials.slice(slash + 1));
}

async function copyCollection(source, target, name, { drop, dryRun }) {
  const from = source.collection(name);
  const to = target.collection(name);

  const total = await from.countDocuments();
  const existing = await to.countDocuments().catch(() => 0);

  if (existing > 0 && !drop) {
    throw new Error(
      `destination collection "${name}" already holds ${existing} document(s). ` +
        'Re-run with --drop to replace it, or point --to at an empty database.'
    );
  }

  if (dryRun) {
    console.log(`   ${name.padEnd(22)} ${String(total).padStart(6)} document(s)  (dry run)`);
    return { name, total, copied: 0 };
  }

  if (existing > 0) await to.deleteMany({});

  let copied = 0;
  const cursor = from.find({}, { noCursorTimeout: false });
  let batch = [];

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH) {
      await to.insertMany(batch, { ordered: false });
      copied += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await to.insertMany(batch, { ordered: false });
    copied += batch.length;
  }

  // Indexes matter: unique email on users, the compound keys the reports
  // rely on. _id_ is created automatically and cannot be re-declared.
  const indexes = await from.indexes();
  let indexCount = 0;
  for (const index of indexes) {
    if (index.name === '_id_') continue;
    const { key, name: indexName, v, ns, background, ...options } = index;
    try {
      await to.createIndex(key, { name: indexName, ...options });
      indexCount += 1;
    } catch (err) {
      console.warn(`     ! index "${indexName}" on ${name}: ${err.message}`);
    }
  }

  console.log(
    `   ${name.padEnd(22)} ${String(copied).padStart(6)} document(s), ${indexCount} index(es)`
  );
  return { name, total, copied };
}

/* -------------------------------------------------------------------------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fromUri = args.from || env.mongoUri;
  const toUri = args.to || process.env.TARGET_URI;

  if (!toUri) {
    console.error('\nNothing to copy into. Pass a destination:\n');
    console.error('  npm run migrate -- --to "mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/biscuit_erp"\n');
    process.exit(1);
  }

  const toDbName = databaseNameOf(toUri);
  if (!toDbName) {
    console.error('\nThe destination string has no database name on the end.');
    console.error('Atlas gives you  ...mongodb.net/  - add the database yourself, for example:');
    console.error('  ...mongodb.net/biscuit_erp?retryWrites=true&w=majority\n');
    process.exit(1);
  }

  console.log('');
  console.log('Copying MongoDB database');
  console.log('------------------------');
  console.log('  from  ' + redact(fromUri));
  console.log('  to    ' + redact(toUri));
  if (args.dryRun) console.log('  mode  dry run - nothing will be written');
  console.log('');

  const sourceClient = new MongoClient(fromUri, { serverSelectionTimeoutMS: 8000 });
  const targetClient = new MongoClient(toUri, { serverSelectionTimeoutMS: 15000 });

  try {
    await sourceClient.connect();
    await targetClient.connect();

    const source = sourceClient.db(databaseNameOf(fromUri) || undefined);
    const target = targetClient.db(toDbName);

    const collections = (await source.listCollections().toArray())
      .filter((c) => c.type !== 'view' && !c.name.startsWith('system.'))
      .map((c) => c.name)
      .sort();

    if (!collections.length) {
      console.log('  the source database is empty - nothing to do');
      return;
    }

    let documents = 0;
    for (const name of collections) {
      const result = await copyCollection(source, target, name, args);
      documents += result.copied;
    }

    console.log('');
    console.log(
      args.dryRun
        ? `  dry run complete - ${collections.length} collection(s) would be copied`
        : `  done - ${collections.length} collection(s), ${documents} document(s) now in "${toDbName}"`
    );
    console.log('');
  } finally {
    await sourceClient.close().catch(() => {});
    await targetClient.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
