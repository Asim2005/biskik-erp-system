import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export const CURRENCY = 'Rs.';

export function money(value, dp = 2) {
  const n = Number(value) || 0;
  return (
    CURRENCY +
    ' ' +
    n.toLocaleString('en-PK', { minimumFractionDigits: dp, maximumFractionDigits: dp })
  );
}

/** Compact form for dashboard tiles: Rs. 1.76 M */
export function moneyShort(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e7) return CURRENCY + ' ' + (n / 1e7).toFixed(2) + ' Cr';
  if (abs >= 1e5) return CURRENCY + ' ' + (n / 1e5).toFixed(2) + ' L';
  if (abs >= 1e3) return CURRENCY + ' ' + (n / 1e3).toFixed(1) + ' K';
  return CURRENCY + ' ' + n.toFixed(0);
}

export function num(value, dp = 2) {
  return (Number(value) || 0).toLocaleString('en-PK', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function qty(value) {
  return num(value, 3);
}

export function int(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-PK');
}

export function pct(value, dp = 1) {
  return (Number(value) || 0).toFixed(dp) + '%';
}

export function signed(value, dp = 2) {
  const n = Number(value) || 0;
  return (n > 0 ? '+' : '') + num(n, dp);
}

export function date(value, fmt = 'DD MMM YYYY') {
  return value ? dayjs(value).format(fmt) : '-';
}

export function dateTime(value) {
  return value ? dayjs(value).format('DD MMM YYYY, HH:mm') : '-';
}

export function fromNow(value) {
  return value ? dayjs(value).fromNow() : '-';
}

export function currentPeriod() {
  return dayjs().format('YYYY-MM');
}

export function periodLabel(period) {
  return period ? dayjs(period + '-01').format('MMMM YYYY') : '-';
}

/** Turns SNAKE_CASE / camelCase into readable text. */
export function humanise(value) {
  if (!value) return '';
  return String(value)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Adverse variances read red, favourable read teal. */
export function varianceColor(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) < 0.005) return 'gray';
  return n > 0 ? 'red' : 'teal';
}
