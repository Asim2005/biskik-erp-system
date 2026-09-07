/** Minimal RFC-4180 CSV serializer (no dependency). */
function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * @param {Array<{key:string,title:string,format?:Function}>} columns
 * @param {Array<object>} rows
 */
export function toCsv(columns, rows) {
  const header = columns.map((c) => escapeCell(c.title)).join(',');
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const raw = typeof c.key === 'function' ? c.key(row) : row[c.key];
        return escapeCell(c.format ? c.format(raw, row) : raw);
      })
      .join(',')
  );
  return [header, ...body].join('\r\n');
}

export function sendCsv(res, filename, columns, rows) {
  const csv = toCsv(columns, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  // BOM so Excel opens UTF-8 correctly
  res.send('\uFEFF' + csv);
}
