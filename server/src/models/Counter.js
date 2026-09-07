import mongoose from 'mongoose';

/** Atomic sequence generator used for document numbering (REC-00001, PO-00007 ...). */
const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

export const Counter = mongoose.model('Counter', counterSchema);
