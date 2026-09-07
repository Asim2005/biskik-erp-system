import PDFDocument from 'pdfkit';

const COLORS = {
  ink: '#111827',
  muted: '#6b7280',
  line: '#e5e7eb',
  headBg: '#f3f4f6',
  accent: '#b45309',
  accentSoft: '#fef3c7',
  danger: '#b91c1c',
  good: '#15803d',
};

/**
 * Streams a landscape/portrait table report straight to the HTTP response.
 *
 * @param {object} res         express response
 * @param {object} opts
 *  - filename, title, subtitle
 *  - company  {companyName,address,ntn,strn}
 *  - meta     [{label,value}]
 *  - columns  [{key,title,width,align,format}]
 *  - rows     [object]
 *  - totals   [{label,value}]
 *  - notes    string[]
 *  - landscape boolean
 */
export function sendPdfReport(res, opts) {
  const {
    filename = 'report.pdf',
    title = 'Report',
    subtitle = '',
    company = {},
    meta = [],
    columns = [],
    rows = [],
    totals = [],
    notes = [],
    landscape = false,
  } = opts;

  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margin: 36,
    bufferPages: true,
    info: { Title: title, Author: company.companyName || 'Biscuit ERP' },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  doc.pipe(res);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const usable = right - left;

  // ---- header ---------------------------------------------------------
  doc.rect(left, 30, usable, 52).fill(COLORS.accentSoft);
  doc.fillColor(COLORS.accent).fontSize(15).font('Helvetica-Bold')
    .text(company.companyName || 'Biscuit Manufacturing ERP', left + 12, 40);
  doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica')
    .text(company.address || '', left + 12, 58, { width: usable - 24 });
  const taxLine = [company.ntn ? 'NTN: ' + company.ntn : '', company.strn ? 'STRN: ' + company.strn : '']
    .filter(Boolean).join('    ');
  doc.text(taxLine, left + 12, 69);

  doc.moveDown(2);
  let y = 96;
  doc.fillColor(COLORS.ink).fontSize(13).font('Helvetica-Bold').text(title, left, y);
  y += 17;
  if (subtitle) {
    doc.fillColor(COLORS.muted).fontSize(8.5).font('Helvetica').text(subtitle, left, y, { width: usable });
    y += 13;
  }

  // ---- meta strip -----------------------------------------------------
  if (meta.length) {
    const perRow = landscape ? 5 : 3;
    const cellW = usable / perRow;
    meta.forEach((m, i) => {
      const cx = left + (i % perRow) * cellW;
      const cy = y + Math.floor(i / perRow) * 24;
      doc.fillColor(COLORS.muted).fontSize(7).font('Helvetica').text(String(m.label).toUpperCase(), cx, cy);
      doc.fillColor(COLORS.ink).fontSize(9).font('Helvetica-Bold').text(String(m.value ?? '-'), cx, cy + 9, {
        width: cellW - 8, ellipsis: true,
      });
    });
    y += Math.ceil(meta.length / perRow) * 24 + 6;
  }

  // ---- table ----------------------------------------------------------
  const totalWidthUnits = columns.reduce((s, c) => s + (c.width || 1), 0) || 1;
  const colX = [];
  let acc = left;
  const widths = columns.map((c) => {
    const w = ((c.width || 1) / totalWidthUnits) * usable;
    colX.push(acc);
    acc += w;
    return w;
  });

  const ROW_H = 16;
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 40;

  function drawHead() {
    doc.rect(left, y, usable, ROW_H + 3).fill(COLORS.headBg);
    doc.fillColor(COLORS.ink).fontSize(7.6).font('Helvetica-Bold');
    columns.forEach((c, i) => {
      doc.text(String(c.title), colX[i] + 4, y + 5, {
        width: widths[i] - 8,
        align: c.align || 'left',
        lineBreak: false,
        ellipsis: true,
      });
    });
    y += ROW_H + 3;
  }

  drawHead();
  doc.font('Helvetica').fontSize(7.6);

  rows.forEach((row, idx) => {
    if (y + ROW_H > bottomLimit) {
      doc.addPage({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36 });
      y = 44;
      drawHead();
      doc.font('Helvetica').fontSize(7.6);
    }
    if (idx % 2 === 1) doc.rect(left, y, usable, ROW_H).fill('#fbfbfc');
    const isBold = row.__bold;
    doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(COLORS.ink);
    columns.forEach((c, i) => {
      const raw = typeof c.key === 'function' ? c.key(row) : row[c.key];
      const text = c.format ? c.format(raw, row) : raw ?? '';
      doc.text(String(text), colX[i] + 4, y + 4.5, {
        width: widths[i] - 8,
        align: c.align || 'left',
        lineBreak: false,
        ellipsis: true,
      });
    });
    doc.moveTo(left, y + ROW_H).lineTo(right, y + ROW_H).lineWidth(0.4).strokeColor(COLORS.line).stroke();
    y += ROW_H;
  });

  // ---- totals ---------------------------------------------------------
  if (totals.length) {
    if (y + 24 + totals.length * 14 > bottomLimit) {
      doc.addPage({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36 });
      y = 44;
    }
    y += 8;
    const boxW = landscape ? 300 : 240;
    const boxX = right - boxW;
    doc.rect(boxX, y, boxW, totals.length * 14 + 10).fill('#fafafa');
    doc.strokeColor(COLORS.line).lineWidth(0.6).rect(boxX, y, boxW, totals.length * 14 + 10).stroke();
    totals.forEach((t, i) => {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
        .text(t.label, boxX + 10, y + 7 + i * 14, { width: boxW / 2 });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(t.tone === 'bad' ? COLORS.danger : t.tone === 'good' ? COLORS.good : COLORS.ink)
        .text(String(t.value), boxX + boxW / 2, y + 7 + i * 14, { width: boxW / 2 - 10, align: 'right' });
    });
    y += totals.length * 14 + 18;
  }

  // ---- notes ----------------------------------------------------------
  if (notes.length) {
    if (y + notes.length * 11 > bottomLimit) {
      doc.addPage({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36 });
      y = 44;
    }
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink).text('Notes', left, y);
    y += 12;
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted);
    notes.forEach((n) => {
      doc.text('- ' + n, left, y, { width: usable });
      y += 11;
    });
  }

  // ---- page footers ---------------------------------------------------
  const range = doc.bufferedPageRange();
  const stamp = new Date().toLocaleString('en-PK');
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const fy = doc.page.height - doc.page.margins.bottom - 18;
    doc.moveTo(left, fy).lineTo(doc.page.width - doc.page.margins.right, fy)
      .lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text('Generated ' + stamp + '  -  Biscuit Manufacturing ERP', left, fy + 5, { width: usable / 2 });
    doc.text('Page ' + (i + 1) + ' of ' + range.count, left + usable / 2, fy + 5, {
      width: usable / 2, align: 'right',
    });
  }

  doc.end();
}
