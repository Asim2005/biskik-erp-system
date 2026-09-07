/** Rounding helpers - all monetary values are stored to 2dp, quantities to 3dp. */
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
export const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

export const sum = (arr, pick) =>
  arr.reduce((s, x) => s + (Number(pick ? pick(x) : x) || 0), 0);

export function fmtMoney(n, symbol = 'Rs.') {
  const v = Number(n) || 0;
  return symbol + ' ' + v.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtNumber(n, dp = 2) {
  return (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
