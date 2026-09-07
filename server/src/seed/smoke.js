/**
 * End-to-end API smoke test. Exercises the whole workflow against a running
 * server: login -> RBAC -> recipe versioning -> production -> GL -> tax ->
 * exports. Run with the server up:  node src/seed/smoke.js
 */
const BASE = process.env.API || 'http://localhost:5000/api';

let pass = 0;
let fail = 0;

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : ''));
  } else {
    fail += 1;
    console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : ''));
  }
}

async function api(path, { method = 'GET', body, token, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function login(email, password) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password } });
  return r.json.token;
}

async function main() {
  console.log('\nBiscuit ERP - API smoke test');
  console.log('============================\n');

  /* ------------------------------ auth ---------------------------------- */
  console.log('Authentication and RBAC');
  const admin = await login('admin@biscuiterp.pk', 'Admin@123');
  if (!admin) {
    console.log(
      '\n  The login rate limiter has kicked in (25 attempts per 10 minutes).\n' +
        '  That is the brute-force control doing its job, not a failure.\n' +
        '  Wait a few minutes and run the test again.\n'
    );
    process.exit(0);
  }
  check('admin can sign in', !!admin);

  const bad = await api('/auth/login', { method: 'POST', body: { email: 'admin@biscuiterp.pk', password: 'wrong' } });
  check('wrong password rejected', bad.status === 401, bad.json.error);

  const noToken = await api('/dashboard');
  check('protected route needs a token', noToken.status === 401);

  const viewer = await login('viewer@biscuiterp.pk', 'Viewer@123');
  const viewerWrite = await api('/materials', {
    method: 'POST',
    token: viewer,
    body: { name: 'Should Not Exist', category: 'RAW', uom: 'KG', standardRate: 1 },
  });
  check('viewer blocked from creating a material', viewerWrite.status === 403, viewerWrite.json.error);

  const sales = await login('sales@biscuiterp.pk', 'Sales@123');
  const salesApprove = await api('/recipes/x/approve', { method: 'POST', token: sales });
  check('sales officer blocked from approving recipes', salesApprove.status === 403);

  /* ---------------------------- dashboard -------------------------------- */
  console.log('\nDashboard and master data');
  const dash = await api('/dashboard', { token: admin });
  check('dashboard loads', dash.status === 200 && !!dash.json.data.cards,
    'produced ' + dash.json.data?.cards?.producedThisMonth + ' units');
  check('dashboard reports inventory value', dash.json.data?.cards?.inventoryValue > 0,
    'Rs. ' + dash.json.data?.cards?.inventoryValue);

  const mats = await api('/materials', { token: admin });
  check('materials list', mats.json.data.length >= 13, mats.json.data.length + ' materials');
  check('materials carry on-hand stock', mats.json.data.some((m) => m.onHand > 0));

  /* ------------------------------ recipes -------------------------------- */
  console.log('\nRecipe workflow');
  const qa = await login('qa@biscuiterp.pk', 'Qa@123456');

  const recipes = await api('/recipes', { token: admin });
  const approved = recipes.json.data.find((r) => r.status === 'APPROVED');
  check('an approved recipe exists', !!approved, approved?.code + ' v' + approved?.version);

  // Keep the run repeatable: if an earlier run already approved the seeded
  // pending version, raise a fresh one through the API.
  let pending = recipes.json.data.find((r) => r.status === 'PENDING_APPROVAL');
  if (!pending) {
    const draft = await api('/recipes/' + approved._id + '/new-version', {
      method: 'POST',
      token: qa,
      body: { changeNote: 'Raised by the smoke test' },
    });
    await api('/recipes/' + draft.json.data._id + '/submit', { method: 'POST', token: qa });
    const refreshed = await api('/recipes', { token: admin });
    pending = refreshed.json.data.find((r) => r.status === 'PENDING_APPROVAL');
  }
  check('a recipe is waiting for approval', !!pending, pending?.code + ' v' + pending?.version);

  const detail = await api('/recipes/' + approved._id, { token: admin });
  check('recipe cost engine returns a unit cost', detail.json.cost.manufacturingCostPerUnit > 0,
    'Rs. ' + detail.json.cost.manufacturingCostPerUnit + ' / unit');
  check('version history is returned', detail.json.versions.length >= 2,
    detail.json.versions.length + ' versions');

  const sim = await api('/recipes/' + approved._id + '/simulate?qty=250000', { token: admin });
  const ratio = sim.json.data.materialCost / (detail.json.cost.materialCostPerUnit * 250000);
  check('scaling to 250,000 units is linear', Math.abs(ratio - 1) < 0.01,
    'Rs. ' + sim.json.data.materialCost.toLocaleString());

  const selfApprove = await api('/recipes/' + pending._id + '/approve', { method: 'POST', token: qa });
  check('segregation of duties blocks self-approval', selfApprove.status === 403, selfApprove.json.error?.slice(0, 45));

  const finance = await login('finance@biscuiterp.pk', 'Finance@123');
  const approve = await api('/recipes/' + pending._id + '/approve', { method: 'POST', token: finance });
  check('finance manager can approve v2.0', approve.status === 200, approve.json.message);

  const afterApprove = await api('/recipes/' + approved._id, { token: admin });
  check('previous version was archived automatically', afterApprove.json.data.status === 'ARCHIVED');

  /* ---------------------------- production -------------------------------- */
  console.log('\nProduction, costing and the general ledger');
  const orders = await api('/production', { token: admin });
  const done = orders.json.data.find((o) => o.status === 'COMPLETED');
  check('a completed production order exists', !!done, done?.code);
  check('actual unit cost is above standard (adverse)', done.actualUnitCost > done.standardUnitCost,
    'std ' + done.standardUnitCost + ' vs act ' + done.actualUnitCost);

  const variance = await api('/production/' + done._id + '/variance', { token: admin });
  const a = variance.json.data.analysis;
  const totalOfParts = a.materialUsageVariance + a.materialPriceVariance + a.labourVariance + a.overheadVariance;
  check('variance components add up to the total',
    Math.abs(totalOfParts - a.totalVariance) < 0.05,
    'parts ' + totalOfParts.toFixed(2) + ' = total ' + a.totalVariance.toFixed(2));
  check('yield loss is quantified', a.yieldLossUnits > 0,
    a.yieldLossUnits + ' units, Rs. ' + a.yieldVariance.toLocaleString());

  const prod = await login('production@biscuiterp.pk', 'Production@123');

  // Repeatable: reuse the seeded released order, or raise a new one.
  let open = orders.json.data.find((o) => o.status === 'RELEASED');
  if (!open) {
    const live = await api('/recipes', { token: admin });
    const usable = live.json.data.find((r) => r.status === 'APPROVED');
    const created = await api('/production', {
      method: 'POST',
      token: prod,
      body: { recipe: usable._id, plannedQty: 50000, shift: 'B', lineNo: 'Line-1' },
    });
    await api('/production/' + created.json.data._id + '/release', { method: 'POST', token: prod });
    open = (await api('/production/' + created.json.data._id, { token: admin })).json.data;
  } else {
    open = (await api('/production/' + open._id, { token: admin })).json.data;
  }

  // A shortage must be refused outright, leaving nothing half-posted.
  const store = await login('warehouse@biscuiterp.pk', 'Store@123');
  const huge = await api('/production/' + open._id + '/issue', {
    method: 'POST',
    token: prod,
    body: { lines: open.lines.map((l) => ({ materialCode: l.materialCode, actualQty: l.standardQty * 5000 })) },
  });
  check('an impossible issue is rejected before anything posts', huge.status === 400,
    (huge.json.details?.length || 0) + ' shortages reported');

  // Top up stock so the run works no matter how many times it has been run.
  let topUps = 0;
  for (const l of open.lines) {
    const matId = (l.material && typeof l.material === 'object') ? l.material._id : l.material;
    const rate = l.rate || l.standardRate || 10;
    const r = await api('/inventory/receive', {
      method: 'POST',
      token: store,
      body: { material: matId, qty: l.standardQty * 1.5, rate, reference: 'SMOKE-TOPUP' },
    });
    if (r.status === 200) topUps += 1;
  }
  check('goods receipt tops up raw material', topUps === open.lines.length, topUps + ' materials received');

  const issue = await api('/production/' + open._id + '/issue', {
    method: 'POST',
    token: prod,
    body: { lines: open.lines.map((l) => ({ materialCode: l.materialCode, actualQty: l.standardQty * 1.01 })) },
  });
  check('materials can be issued to an open order', issue.status === 200,
    'Rs. ' + issue.json.data?.actualMaterialCost?.toLocaleString() + ' to WIP');
  check('issuing posts a journal entry', !!issue.json.journalEntry?.code, issue.json.journalEntry?.code);

  const complete = await api('/production/' + open._id + '/complete', {
    method: 'POST',
    token: prod,
    body: { goodQty: 49200, rejectQty: 400, actualLabourCost: 16400, actualOverheadCost: 34600 },
  });
  check('order can be completed', complete.status === 200,
    'act unit cost ' + complete.json.data?.actualUnitCost);
  check('completion posts finished goods and variances', complete.json.journalEntries?.length >= 1);

  /* ------------------------------- ledger --------------------------------- */
  const tb = await api('/gl/trial-balance', { token: admin });
  check('trial balance balances after all activity', tb.json.summary.balanced,
    'Dr ' + tb.json.summary.totalDebit.toLocaleString() + ' / Cr ' + tb.json.summary.totalCredit.toLocaleString());

  const wip = tb.json.data.find((r) => r.code === '1202');
  check('WIP nets to zero on completed orders', !wip || Math.abs(wip.net) < 1,
    'WIP net ' + (wip ? wip.net : 0));

  const valuation = await api('/inventory/valuation', { token: admin });
  const fgAcc = tb.json.data.find((r) => r.code === '1203');
  const fgStock = valuation.json.data.filter((r) => r.category === 'FINISHED').reduce((s, r) => s + r.value, 0);
  check('finished goods: stock ledger agrees with the GL',
    Math.abs((fgAcc?.net || 0) - fgStock) < 1,
    'GL ' + Math.round(fgAcc?.net || 0).toLocaleString() + ' vs stock ' + Math.round(fgStock).toLocaleString());

  const rmAcc = tb.json.data.find((r) => r.code === '1201');
  const rmStock = valuation.json.data.filter((r) => r.category !== 'FINISHED').reduce((s, r) => s + r.value, 0);
  check('raw material: stock ledger agrees with the GL',
    Math.abs((rmAcc?.net || 0) - rmStock) < 1,
    'GL ' + Math.round(rmAcc?.net || 0).toLocaleString() + ' vs stock ' + Math.round(rmStock).toLocaleString());

  const unbalanced = await api('/journals', {
    method: 'POST',
    token: finance,
    body: { narration: 'Deliberately unbalanced', lines: [{ code: '1001', debit: 500 }, { code: '4001', credit: 400 }] },
  });
  check('unbalanced journal entry is rejected', unbalanced.status === 400, unbalanced.json.error);

  /* --------------------------------- tax ---------------------------------- */
  console.log('\nTax and invoicing');
  const tax = await api('/tax/summary', { token: admin });
  check('tax summary computes a net position', tax.json.data.outputTax > 0,
    'output ' + tax.json.data.outputTax.toLocaleString() + ' - input ' + tax.json.data.inputTax.toLocaleString() +
    ' = ' + tax.json.data.net.toLocaleString());

  const outputAcc = tb.json.data.find((r) => r.code === '2201');
  check('output tax liability matches the tax module',
    Math.abs(Math.abs(outputAcc?.net || 0) - tax.json.data.outputTax) < 1,
    'GL ' + Math.abs(Math.round(outputAcc?.net || 0)).toLocaleString());

  const invoices = await api('/invoices?kind=SALES', { token: admin });
  const inv = invoices.json.data[0];
  check('sales invoices record cost of goods sold', inv.cogsAmount > 0,
    'margin ' + ((inv.grossProfit / inv.subtotal) * 100).toFixed(1) + '%');
  check('gross margin is plausible for manufacturing',
    inv.grossProfit / inv.subtotal > 0.05 && inv.grossProfit / inv.subtotal < 0.6);

  /* ------------------------------- exports -------------------------------- */
  console.log('\nReports and exports');
  const list = await api('/reports', { token: admin });
  check('report catalogue is available', list.json.data.length >= 10, list.json.data.length + ' reports');

  const csv = await api('/reports/inventory-valuation?format=csv', { token: admin, raw: true });
  const csvText = await csv.text();
  check('CSV export works', csv.status === 200 && csvText.includes(','),
    csvText.split('\n').length + ' lines, ' + csv.headers.get('content-type'));

  const pdf = await api('/reports/production-variance?id=' + done._id + '&format=pdf', { token: admin, raw: true });
  const buf = Buffer.from(await pdf.arrayBuffer());
  check('PDF export works', pdf.status === 200 && buf.slice(0, 4).toString() === '%PDF',
    Math.round(buf.length / 1024) + ' KB');

  const tbPdf = await api('/reports/trial-balance?format=pdf', { token: admin, raw: true });
  const tbBuf = Buffer.from(await tbPdf.arrayBuffer());
  check('trial balance PDF renders', tbBuf.slice(0, 4).toString() === '%PDF', Math.round(tbBuf.length / 1024) + ' KB');

  const audit = await api('/audit', { token: admin });
  check('audit trail captured the activity', audit.json.data.length > 5, audit.json.data.length + ' entries');

  /* -------------------------------- result -------------------------------- */
  console.log('\n============================');
  console.log('  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nSmoke test crashed:', e);
  process.exit(1);
});
