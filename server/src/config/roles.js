/**
 * ---------------------------------------------------------------------------
 * Role-based access control
 * ---------------------------------------------------------------------------
 * One system, one database, one login per person. What a user can do is
 * decided by ACTIONS, not by which department they sit in - a warehouse
 * officer may receive stock (which moves inventory and writes a journal
 * entry) without ever being able to edit that journal entry.
 *
 * A permission is a plain "<domain>.<action>" string. Routes declare the
 * permission they need; `requirePermission` checks it against the role.
 *
 * Approval limits add a second dimension: a role may be allowed to approve
 * a purchase order, but only up to a value. Above that it escalates.
 */

export const DEPARTMENTS = {
  SYSTEM: 'System',
  PROCUREMENT: 'Procurement',
  WAREHOUSE: 'Warehouse',
  PRODUCTION: 'Production',
  QUALITY: 'Quality / R&D',
  SALES: 'Sales',
  FINANCE: 'Finance',
  GENERAL: 'General',
};

export const ROLES = {
  ADMIN: 'admin',

  PROCUREMENT_OFFICER: 'procurement_officer',
  PROCUREMENT_MANAGER: 'procurement_manager',

  WAREHOUSE_OFFICER: 'warehouse_officer',
  WAREHOUSE_MANAGER: 'warehouse_manager',

  PRODUCTION_OFFICER: 'production_officer',
  PRODUCTION_MANAGER: 'production_manager',

  QA_OFFICER: 'qa_officer',

  SALES_OFFICER: 'sales_officer',
  SALES_MANAGER: 'sales_manager',

  JUNIOR_ACCOUNTANT: 'junior_accountant',
  SENIOR_ACCOUNTANT: 'senior_accountant',
  FINANCE_MANAGER: 'finance_manager',
  CONTROLLER: 'controller',

  VIEWER: 'viewer',
};

export const ROLE_META = {
  [ROLES.ADMIN]: {
    label: 'System Administrator',
    department: DEPARTMENTS.SYSTEM,
    description:
      'Creates users, assigns roles and configures the system. Not intended for daily transactions.',
    approvalLimit: Infinity,
  },
  [ROLES.PROCUREMENT_OFFICER]: {
    label: 'Procurement Officer',
    department: DEPARTMENTS.PROCUREMENT,
    description: 'Raises RFQs and purchase orders. Cannot approve their own order.',
    approvalLimit: 0,
  },
  [ROLES.PROCUREMENT_MANAGER]: {
    label: 'Procurement Manager',
    department: DEPARTMENTS.PROCUREMENT,
    description: 'Approves purchase orders up to the departmental limit.',
    approvalLimit: 1000000,
  },
  [ROLES.WAREHOUSE_OFFICER]: {
    label: 'Warehouse Officer',
    department: DEPARTMENTS.WAREHOUSE,
    description: 'Receives goods against a purchase order, issues material and transfers stock.',
    approvalLimit: 0,
  },
  [ROLES.WAREHOUSE_MANAGER]: {
    label: 'Warehouse Manager',
    department: DEPARTMENTS.WAREHOUSE,
    description: 'Everything a warehouse officer can do, plus stock adjustments and write-offs.',
    approvalLimit: 250000,
  },
  [ROLES.PRODUCTION_OFFICER]: {
    label: 'Production Officer',
    department: DEPARTMENTS.PRODUCTION,
    description: 'Runs production orders on the floor and records actual output.',
    approvalLimit: 0,
  },
  [ROLES.PRODUCTION_MANAGER]: {
    label: 'Production Manager',
    department: DEPARTMENTS.PRODUCTION,
    description: 'Plans production, releases orders and completes them.',
    approvalLimit: 500000,
  },
  [ROLES.QA_OFFICER]: {
    label: 'QA / R&D Officer',
    department: DEPARTMENTS.QUALITY,
    description: 'Writes and submits formulas. Cannot approve their own work.',
    approvalLimit: 0,
  },
  [ROLES.SALES_OFFICER]: {
    label: 'Sales Officer',
    department: DEPARTMENTS.SALES,
    description: 'Manages customers, sales orders and invoices.',
    approvalLimit: 0,
  },
  [ROLES.SALES_MANAGER]: {
    label: 'Sales Manager',
    department: DEPARTMENTS.SALES,
    description: 'Approves sales orders, credit terms and sales returns.',
    approvalLimit: 1000000,
  },
  [ROLES.JUNIOR_ACCOUNTANT]: {
    label: 'Junior Accountant',
    department: DEPARTMENTS.FINANCE,
    description: 'Routine payables and receivables entries. No adjustments, no period close.',
    approvalLimit: 0,
  },
  [ROLES.SENIOR_ACCOUNTANT]: {
    label: 'Senior Accountant',
    department: DEPARTMENTS.FINANCE,
    description: 'General ledger, reconciliations and adjusting entries.',
    approvalLimit: 500000,
  },
  [ROLES.FINANCE_MANAGER]: {
    label: 'Finance Manager',
    department: DEPARTMENTS.FINANCE,
    description: 'Approves recipes and adjustments, prepares the trial balance and statements.',
    approvalLimit: 2000000,
  },
  [ROLES.CONTROLLER]: {
    label: 'Financial Controller / CFO',
    department: DEPARTMENTS.FINANCE,
    description: 'Final approval, financial statements and locking an accounting period.',
    approvalLimit: Infinity,
  },
  [ROLES.VIEWER]: {
    label: 'Viewer (read only)',
    department: DEPARTMENTS.GENERAL,
    description: 'Can look at everything permitted, can change nothing.',
    approvalLimit: 0,
  },
};

/** Back-compat for anything still reading ROLE_LABELS. */
export const ROLE_LABELS = Object.fromEntries(
  Object.entries(ROLE_META).map(([k, v]) => [k, v.label])
);

/* -------------------------------------------------------------------------- */
/* Permissions                                                                */
/* -------------------------------------------------------------------------- */

export const PERMISSION_GROUPS = {
  General: ['dashboard.view', 'report.view', 'report.export', 'settings.view'],

  Procurement: [
    'rfq.view', 'rfq.manage',
    'po.view', 'po.create', 'po.submit', 'po.approve', 'po.cancel', 'po.close',
  ],

  Warehouse: [
    'inventory.view', 'grn.view', 'grn.create', 'grn.post',
    'inventory.issue', 'inventory.adjust', 'inventory.receive', 'inventory.transfer',
  ],

  Production: [
    'production.view', 'production.create', 'production.issue',
    'production.complete', 'production.cancel',
    'recipe.view', 'recipe.create', 'recipe.submit', 'recipe.approve', 'recipe.delete',
    'costing.view',
  ],

  Sales: [
    'sales.view', 'so.create', 'so.approve', 'sales.manage', 'dispatch.manage', 'salesreturn.manage',
  ],

  Finance: [
    'gl.view', 'gl.post', 'gl.adjust', 'gl.reverse', 'gl.manageAccounts',
    'purchase.view', 'purchase.manage',
    'party.view', 'party.manage',
    'tax.view', 'tax.manage',
    'period.view', 'period.close', 'period.reopen',
    'statements.view',
  ],

  Administration: [
    'material.view', 'material.manage',
    'user.view', 'user.manage',
    'audit.view',
    'settings.manage',
  ],
};

export const PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();

/** Read-only baseline every role starts from. */
const READ_ONLY = [
  'dashboard.view', 'report.view', 'settings.view',
  'material.view', 'recipe.view', 'production.view', 'inventory.view',
  'costing.view', 'gl.view', 'tax.view', 'sales.view', 'purchase.view',
  'party.view', 'po.view', 'rfq.view', 'grn.view', 'period.view',
];

/** What each department sees by default - a narrower read set than "everything". */
const OPERATIONAL_READ = [
  'dashboard.view', 'report.view', 'settings.view', 'material.view', 'inventory.view',
];

export const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: PERMISSIONS,

  /* ------------------------------ procurement ---------------------------- */
  [ROLES.PROCUREMENT_OFFICER]: [
    ...OPERATIONAL_READ,
    'rfq.view', 'rfq.manage',
    'po.view', 'po.create', 'po.submit',
    'grn.view',
    'party.view', 'purchase.view',
    'report.export',
  ],
  [ROLES.PROCUREMENT_MANAGER]: [
    ...OPERATIONAL_READ,
    'rfq.view', 'rfq.manage',
    'po.view', 'po.create', 'po.submit', 'po.approve', 'po.cancel', 'po.close',
    'grn.view',
    'party.view', 'party.manage', 'purchase.view',
    'report.export', 'audit.view',
  ],

  /* ------------------------------- warehouse ----------------------------- */
  [ROLES.WAREHOUSE_OFFICER]: [
    ...OPERATIONAL_READ,
    'po.view', 'grn.view', 'grn.create', 'grn.post',
    'inventory.issue', 'inventory.receive', 'inventory.transfer',
    'production.view', 'production.issue',
    'report.export',
  ],
  [ROLES.WAREHOUSE_MANAGER]: [
    ...OPERATIONAL_READ,
    'po.view', 'grn.view', 'grn.create', 'grn.post',
    'inventory.issue', 'inventory.receive', 'inventory.transfer', 'inventory.adjust',
    'production.view', 'production.issue',
    'material.manage',
    'report.export', 'audit.view',
  ],

  /* ------------------------------- production ---------------------------- */
  [ROLES.PRODUCTION_OFFICER]: [
    ...OPERATIONAL_READ,
    'recipe.view', 'costing.view',
    'production.view', 'production.issue', 'production.complete',
    'report.export',
  ],
  [ROLES.PRODUCTION_MANAGER]: [
    ...OPERATIONAL_READ,
    'recipe.view', 'recipe.create', 'recipe.submit', 'costing.view',
    'production.view', 'production.create', 'production.issue',
    'production.complete', 'production.cancel',
    'grn.view', 'po.view',
    'report.export',
  ],

  /* -------------------------------- quality ------------------------------ */
  [ROLES.QA_OFFICER]: [
    ...OPERATIONAL_READ,
    'recipe.view', 'recipe.create', 'recipe.submit', 'recipe.delete',
    'costing.view', 'production.view',
    'report.export',
  ],

  /* --------------------------------- sales ------------------------------- */
  [ROLES.SALES_OFFICER]: [
    ...OPERATIONAL_READ,
    'sales.view', 'so.create', 'sales.manage', 'dispatch.manage',
    'party.view', 'party.manage',
    'report.export',
  ],
  [ROLES.SALES_MANAGER]: [
    ...OPERATIONAL_READ,
    'sales.view', 'so.create', 'so.approve', 'sales.manage',
    'dispatch.manage', 'salesreturn.manage',
    'party.view', 'party.manage',
    'costing.view',
    'report.export', 'audit.view',
  ],

  /* -------------------------------- finance ------------------------------ */
  [ROLES.JUNIOR_ACCOUNTANT]: [
    ...READ_ONLY,
    'gl.post',
    'purchase.manage',
    'party.manage',
    'report.export',
  ],
  [ROLES.SENIOR_ACCOUNTANT]: [
    ...READ_ONLY,
    'gl.post', 'gl.adjust', 'gl.reverse',
    'purchase.manage', 'sales.manage', 'party.manage',
    'tax.view',
    'report.export', 'audit.view',
  ],
  [ROLES.FINANCE_MANAGER]: [
    ...READ_ONLY,
    'recipe.approve',
    'gl.post', 'gl.adjust', 'gl.reverse', 'gl.manageAccounts',
    'purchase.manage', 'sales.manage', 'party.manage',
    'tax.manage', 'statements.view',
    'po.approve',
    'material.manage',
    'report.export', 'audit.view',
  ],
  [ROLES.CONTROLLER]: [
    ...READ_ONLY,
    'recipe.approve',
    'gl.post', 'gl.adjust', 'gl.reverse', 'gl.manageAccounts',
    'purchase.manage', 'sales.manage', 'party.manage',
    'tax.manage', 'statements.view',
    'po.approve', 'po.cancel', 'po.close',
    'period.close', 'period.reopen',
    'material.manage',
    'report.export', 'audit.view',
    'settings.manage',
  ],

  [ROLES.VIEWER]: READ_ONLY,
};

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function can(role, permission) {
  return permissionsFor(role).includes(permission);
}

export function approvalLimitFor(role) {
  const limit = ROLE_META[role]?.approvalLimit ?? 0;
  return limit;
}

export function departmentFor(role) {
  return ROLE_META[role]?.department || DEPARTMENTS.GENERAL;
}

/**
 * The action-based permission matrix, shaped for the admin screen:
 * one row per action, one column per role, so "what can this user do?"
 * is answerable at a glance.
 */
export function permissionMatrix() {
  const roles = Object.values(ROLES);
  return Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => ({
    group,
    permissions: permissions.map((permission) => ({
      permission,
      roles: Object.fromEntries(roles.map((r) => [r, can(r, permission)])),
    })),
  }));
}
