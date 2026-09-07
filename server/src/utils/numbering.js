import { Counter } from '../models/Counter.js';

/**
 * Atomically produces the next document number for a series.
 * nextCode('REC') -> "REC-00001"
 */
export async function nextCode(prefix, pad = 5) {
  const doc = await Counter.findByIdAndUpdate(
    prefix,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return prefix + '-' + String(doc.seq).padStart(pad, '0');
}

export async function peekSeq(prefix) {
  const doc = await Counter.findById(prefix);
  return doc ? doc.seq : 0;
}
