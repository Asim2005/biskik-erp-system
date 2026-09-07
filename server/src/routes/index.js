import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

import * as auth from '../controllers/auth.controller.js';
import * as users from '../controllers/user.controller.js';
import * as materials from '../controllers/material.controller.js';
import * as recipes from '../controllers/recipe.controller.js';
import * as production from '../controllers/production.controller.js';
import * as inventory from '../controllers/inventory.controller.js';
import * as accounts from '../controllers/account.controller.js';
import * as invoices from '../controllers/invoice.controller.js';
import * as misc from '../controllers/misc.controller.js';
import * as reports from '../controllers/report.controller.js';
import * as procurement from '../controllers/procurement.controller.js';
import * as periods from '../controllers/period.controller.js';

const router = Router();

/* ------------------------------- public ---------------------------------- */
router.post('/auth/login', validateBody(auth.loginSchema), auth.login);

/* everything below requires a valid session */
router.use(authenticate);

router.get('/auth/me', auth.me);
router.post('/auth/change-password', validateBody(auth.changePasswordSchema), auth.changePassword);

/* -------------------------------- users ---------------------------------- */
router.get('/users', requirePermission('user.view'), users.listUsers);
router.get('/users/roles', users.getRoles);
router.get('/users/permission-matrix', requirePermission('user.view'), users.getPermissionMatrix);
router.post('/users', requirePermission('user.manage'), validateBody(users.createUserSchema), users.createUser);
router.put('/users/:id', requirePermission('user.manage'), validateBody(users.updateUserSchema), users.updateUser);
router.delete('/users/:id', requirePermission('user.manage'), users.deleteUser);

/* ------------------------------ materials -------------------------------- */
router.get('/materials', requirePermission('material.view'), materials.listMaterials);
router.get('/materials/:id', requirePermission('material.view'), materials.getMaterial);
router.post('/materials', requirePermission('material.manage'), validateBody(materials.materialSchema), materials.createMaterial);
router.put('/materials/:id', requirePermission('material.manage'), validateBody(materials.materialSchema.partial()), materials.updateMaterial);
router.delete('/materials/:id', requirePermission('material.manage'), materials.deleteMaterial);

/* ------------------------------- recipes --------------------------------- */
router.get('/recipes', requirePermission('recipe.view'), recipes.listRecipes);
router.get('/recipes/:id', requirePermission('recipe.view'), recipes.getRecipe);
router.get('/recipes/:id/simulate', requirePermission('recipe.view'), recipes.simulate);
router.post('/recipes', requirePermission('recipe.create'), validateBody(recipes.recipeSchema), recipes.createRecipe);
router.put('/recipes/:id', requirePermission('recipe.create'), validateBody(recipes.recipeSchema), recipes.updateRecipe);
router.post('/recipes/:id/submit', requirePermission('recipe.submit'), recipes.submitRecipe);
router.post('/recipes/:id/approve', requirePermission('recipe.approve'), recipes.approveRecipe);
router.post('/recipes/:id/reject', requirePermission('recipe.approve'), recipes.rejectRecipe);
router.post('/recipes/:id/new-version', requirePermission('recipe.create'), recipes.newVersion);
router.delete('/recipes/:id', requirePermission('recipe.delete'), recipes.deleteRecipe);

/* ------------------------------ production ------------------------------- */
router.get('/production', requirePermission('production.view'), production.listOrders);
router.get('/production/:id', requirePermission('production.view'), production.getOrder);
router.get('/production/:id/variance', requirePermission('production.view'), production.orderVariance);
router.post('/production', requirePermission('production.create'), validateBody(production.createOrderSchema), production.createOrder);
router.put('/production/:id', requirePermission('production.create'), production.updateOrder);
router.post('/production/:id/release', requirePermission('production.create'), production.releaseOrder);
router.post('/production/:id/issue', requirePermission('production.issue'), validateBody(production.issueSchema), production.issueMaterials);
router.post('/production/:id/complete', requirePermission('production.complete'), validateBody(production.completeSchema), production.completeOrder);
router.post('/production/:id/cancel', requirePermission('production.cancel'), production.cancelOrder);

/* ------------------------------ inventory -------------------------------- */
router.get('/inventory/valuation', requirePermission('inventory.view'), inventory.getValuation);
router.get('/inventory/movements', requirePermission('inventory.view'), inventory.getMovements);
router.get('/inventory/low-stock', requirePermission('inventory.view'), inventory.lowStock);
router.post('/inventory/adjust', requirePermission('inventory.adjust'), validateBody(inventory.adjustSchema), inventory.adjustStock);
router.post('/inventory/receive', requirePermission('inventory.receive'), validateBody(inventory.receiptSchema), inventory.receiveStock);

/* ------------------------------- accounts -------------------------------- */
router.get('/accounts', requirePermission('gl.view'), accounts.listAccounts);
router.post('/accounts', requirePermission('gl.manageAccounts'), validateBody(accounts.accountSchema), accounts.createAccount);
router.put('/accounts/:id', requirePermission('gl.manageAccounts'), validateBody(accounts.accountSchema.partial()), accounts.updateAccount);
router.delete('/accounts/:id', requirePermission('gl.manageAccounts'), accounts.deleteAccount);
router.get('/accounts/:id/ledger', requirePermission('gl.view'), accounts.getLedger);

router.get('/journals', requirePermission('gl.view'), accounts.listJournals);
router.get('/journals/:id', requirePermission('gl.view'), accounts.getJournal);
router.post('/journals', requirePermission('gl.post'), validateBody(accounts.journalSchema), accounts.createJournal);
router.post('/journals/:id/reverse', requirePermission('gl.post'), accounts.reverseJournal);

router.get('/gl/trial-balance', requirePermission('gl.view'), accounts.getTrialBalance);
router.get('/gl/financials', requirePermission('gl.view'), accounts.getFinancials);

/* -------------------------------- parties -------------------------------- */
router.get('/parties', requirePermission('party.view'), misc.listParties);
router.post('/parties', requirePermission('party.manage'), validateBody(misc.partySchema), misc.createParty);
router.put('/parties/:id', requirePermission('party.manage'), validateBody(misc.partySchema.partial()), misc.updateParty);
router.delete('/parties/:id', requirePermission('party.manage'), misc.deleteParty);

/* ------------------------------- invoices -------------------------------- */
router.get('/invoices', requirePermission('sales.view', 'purchase.view'), invoices.listInvoices);
router.get('/invoices/:id', requirePermission('sales.view', 'purchase.view'), invoices.getInvoice);
router.post('/invoices', requirePermission('sales.manage', 'purchase.manage'), validateBody(invoices.invoiceSchema), invoices.createInvoice);
router.put('/invoices/:id', requirePermission('sales.manage', 'purchase.manage'), validateBody(invoices.invoiceSchema.partial()), invoices.updateInvoice);
router.post('/invoices/:id/post', requirePermission('sales.manage', 'purchase.manage'), invoices.postInvoice);
router.post('/invoices/:id/cancel', requirePermission('sales.manage', 'purchase.manage'), invoices.cancelInvoice);

/* ---------------------------------- tax ---------------------------------- */
router.get('/tax/summary', requirePermission('tax.view'), misc.getTaxSummary);
router.get('/tax/register', requirePermission('tax.view'), misc.getTaxRegister);

/* -------------------------------- reports -------------------------------- */
router.get('/reports', requirePermission('report.view'), reports.listReports);
router.get('/reports/:key', requirePermission('report.view'), reports.runReport);


/* ------------------------------ procurement ------------------------------ */
router.get('/rfqs', requirePermission('rfq.view'), procurement.listRfqs);
router.post('/rfqs', requirePermission('rfq.manage'), validateBody(procurement.rfqSchema), procurement.createRfq);
router.post('/rfqs/:id/quote', requirePermission('rfq.manage'), validateBody(procurement.quoteSchema), procurement.recordQuote);
router.post('/rfqs/:id/award', requirePermission('rfq.manage'), procurement.awardRfq);

router.get('/purchase-orders', requirePermission('po.view'), procurement.listPurchaseOrders);
router.get('/purchase-orders/:id', requirePermission('po.view'), procurement.getPurchaseOrder);
router.get('/purchase-orders/:id/match', requirePermission('po.view'), procurement.threeWayMatch);
router.post('/purchase-orders', requirePermission('po.create'), validateBody(procurement.poSchema), procurement.createPurchaseOrder);
router.put('/purchase-orders/:id', requirePermission('po.create'), validateBody(procurement.poSchema), procurement.updatePurchaseOrder);
router.post('/purchase-orders/:id/submit', requirePermission('po.submit'), procurement.submitPurchaseOrder);
router.post('/purchase-orders/:id/approve', requirePermission('po.approve'), procurement.approvePurchaseOrder);
router.post('/purchase-orders/:id/reject', requirePermission('po.approve'), procurement.rejectPurchaseOrder);
router.post('/purchase-orders/:id/cancel', requirePermission('po.cancel'), procurement.cancelPurchaseOrder);
router.post('/purchase-orders/:id/close', requirePermission('po.close'), procurement.closePurchaseOrder);

/* ------------------------- warehouse: goods receipt ---------------------- */
router.get('/grns', requirePermission('grn.view'), procurement.listGrns);
router.get('/grns/:id', requirePermission('grn.view'), procurement.getGrn);
router.post('/grns', requirePermission('grn.create'), validateBody(procurement.grnSchema), procurement.createGrn);

/* ---------------------------- period and close --------------------------- */
router.get('/periods', requirePermission('period.view'), periods.listFiscalPeriods);
router.get('/periods/:period/checklist', requirePermission('period.view'), periods.closeChecklist);
router.post('/periods/close', requirePermission('period.close'), validateBody(periods.closeSchema), periods.closePeriod);
router.post('/periods/reopen', requirePermission('period.reopen'), validateBody(periods.reopenSchema), periods.reopenPeriod);
router.get('/gl/adjusted-trial-balance', requirePermission('gl.view'), periods.adjustedTrialBalance);
router.get('/gl/statements', requirePermission('gl.view'), periods.financialStatements);

/* -------------------------------- system --------------------------------- */
router.get('/dashboard', requirePermission('dashboard.view'), misc.dashboard);
router.get('/audit', requirePermission('audit.view'), misc.listAudit);
router.get('/settings', requirePermission('settings.view'), misc.getSettingsHandler);
router.put('/settings', requirePermission('settings.manage'), validateBody(misc.settingsSchema), misc.updateSettings);

export default router;
