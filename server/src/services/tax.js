import { Invoice } from '../models/Invoice.js';
import { round2 } from '../utils/money.js';

/**
 * Sales-tax position for a period (YYYY-MM) built from POSTED invoices.
 * Input tax on purchases is recoverable and never capitalised into inventory;
 * output tax on sales is a liability, kept out of revenue.
 */
export async function taxSummary(period) {
  const match = { status: 'POSTED' };
  if (period) match.period = period;

  const rows = await Invoice.find(match).lean();

  const sales = rows.filter((r) => r.kind === 'SALES');
  const purchases = rows.filter((r) => r.kind === 'PURCHASE');

  const outputTax = round2(sales.reduce((s, r) => s + (r.taxTotal || 0), 0));
  const inputTax = round2(purchases.reduce((s, r) => s + (r.taxTotal || 0), 0));
  const taxableSales = round2(sales.reduce((s, r) => s + (r.subtotal || 0), 0));
  const taxablePurchases = round2(purchases.reduce((s, r) => s + (r.subtotal || 0), 0));

  const net = round2(outputTax - inputTax);

  return {
    period: period || 'ALL',
    taxableSales,
    taxablePurchases,
    outputTax,
    inputTax,
    adjustments: 0,
    netPayable: net > 0 ? net : 0,
    refundable: net < 0 ? round2(-net) : 0,
    net,
    position: net > 0 ? 'PAYABLE' : net < 0 ? 'REFUNDABLE' : 'NIL',
    salesInvoiceCount: sales.length,
    purchaseInvoiceCount: purchases.length,
  };
}

/** Month-by-month ledger for the tax screen and the sales-tax report. */
export async function taxLedger({ from, to } = {}) {
  const match = { status: 'POSTED' };
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = new Date(from);
    if (to) match.date.$lte = new Date(to);
  }

  const agg = await Invoice.aggregate([
    { $match: match },
    {
      $group: {
        _id: { period: '$period', kind: '$kind' },
        taxable: { $sum: '$subtotal' },
        tax: { $sum: '$taxTotal' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.period': 1 } },
  ]);

  const byPeriod = new Map();
  for (const r of agg) {
    const p = r._id.period;
    if (!byPeriod.has(p)) {
      byPeriod.set(p, { period: p, taxableSales: 0, taxablePurchases: 0, outputTax: 0, inputTax: 0, invoices: 0 });
    }
    const bucket = byPeriod.get(p);
    if (r._id.kind === 'SALES') {
      bucket.taxableSales = round2(r.taxable);
      bucket.outputTax = round2(r.tax);
    } else {
      bucket.taxablePurchases = round2(r.taxable);
      bucket.inputTax = round2(r.tax);
    }
    bucket.invoices += r.count;
  }

  return [...byPeriod.values()]
    .map((b) => ({ ...b, net: round2(b.outputTax - b.inputTax) }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/** Detailed invoice-level tax register (the CSV/PDF the tax officer wants). */
export async function taxRegister(period) {
  const match = { status: 'POSTED' };
  if (period) match.period = period;
  const rows = await Invoice.find(match).populate('party', 'name ntn strn').sort({ date: 1 }).lean();
  return rows.map((r) => ({
    date: r.date,
    period: r.period,
    kind: r.kind,
    code: r.code,
    party: r.party?.name || r.partyName,
    ntn: r.party?.ntn || '',
    strn: r.party?.strn || '',
    taxable: round2(r.subtotal),
    taxRate: r.lines?.[0]?.taxRate ?? 0,
    inputTax: r.kind === 'PURCHASE' ? round2(r.taxTotal) : 0,
    outputTax: r.kind === 'SALES' ? round2(r.taxTotal) : 0,
    grandTotal: round2(r.grandTotal),
  }));
}
