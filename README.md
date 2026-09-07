# Biscuit Manufacturing ERP

A full-stack manufacturing ERP for a biscuit factory: version-controlled recipes, production
orders with real standard-costing variance analysis, moving-average inventory, a double-entry
general ledger that ties to the stock ledger, sales tax, role-based access, and CSV/PDF export
on every report.

**React 18 + Mantine 7** on the front end · **Node 22 / Express + Mongoose 8 / MongoDB** on the back end.

---

## Quick start

You need **Node 18+** and **MongoDB** running on `localhost:27017`.

The repository is an npm workspace, so dependencies for both halves install once from the root.

```bash
npm install         # installs the client and the server together

# 1. API server
npm run seed        # creates the demo company (wipes the biscuit_erp database)
npm run dev:server  # http://localhost:5000

# 2. Front end, in a second terminal
npm run dev:client  # http://localhost:5173
```

On Windows you can double-click `start-server.bat` and `start-client.bat` instead.

Open **http://localhost:5173** and sign in.

### Demo accounts

| Email | Password | Role | What they can do |
|---|---|---|---|
| `admin@biscuiterp.pk` | `Admin@123` | Administrator | Everything |
| `finance@biscuiterp.pk` | `Finance@123` | Finance Manager | Approves recipes, posts the GL, manages tax |
| `production@biscuiterp.pk` | `Production@123` | Production Manager | Creates orders, issues material, completes production |
| `warehouse@biscuiterp.pk` | `Store@123` | Warehouse Officer | Receives and adjusts stock, issues to production |
| `qa@biscuiterp.pk` | `Qa@123456` | QA / R&D | Writes and submits formulas |
| `sales@biscuiterp.pk` | `Sales@123` | Sales Officer | Customers and sales invoices |
| `viewer@biscuiterp.pk` | `Viewer@123` | Viewer | Read only |

---

## What the system does

### Recipe management with real version control
A formula is a **version**, not a document you overwrite. Versions move
`DRAFT → PENDING_APPROVAL → APPROVED`, and approving one automatically archives the version it
supersedes. An approved version is **locked** — to change it you create the next version, and the
old one stays in force until the new one is approved.

**Segregation of duties is enforced**: the person who submitted a version cannot approve it. The
API rejects the attempt regardless of role.

Only an `APPROVED` recipe can be used to create a production order.

### Excel-style data entry
Recipe lines, material issues, invoice lines and manual journal entries are all edited in a
spreadsheet grid built for the job:

| Key | Action |
|---|---|
| arrows / `Tab` / `Enter` | move between cells |
| `Shift` + arrows | extend the selection |
| type, `F2`, or double click | edit a cell |
| `Enter` / `Tab` | commit and move down / right |
| `Esc` | cancel the edit |
| `Delete` | clear the selected range |
| `Ctrl`+`C` / `Ctrl`+`V` | copy and paste TSV — **paste a block straight from Excel** |
| `Ctrl`+`D` | fill down from the top of the selection |
| `Ctrl`+`Enter` | insert a row below |

Computed columns (effective quantity, line cost, per-unit cost, tax) recalculate as you type, and
the totals row updates live.

### Production and estimated-vs-actual costing
Creating an order **explodes** the approved recipe and freezes the standard at that moment. Scale
to 100 units or 1,000,000 — the bill of materials scales linearly.

The workflow posts real accounting at each step:

| Step | Journal entry |
|---|---|
| Issue materials | `Dr Work in Process` / `Cr Raw Material Inventory` |
| Complete — conversion | `Dr WIP` / `Cr Accrued Payroll` + `Cr Factory Overhead` |
| Complete — output | `Dr Finished Goods` (good units × standard) + `Dr` yield loss + variances / `Cr WIP` |

Variances are computed the textbook way and are **provable**:

- **usage variance** = (actual qty − standard qty) × standard rate
- **price variance** = (actual rate − standard rate) × actual qty
- **labour / overhead variance** = actual − standard
- **yield loss** = (planned − good) × standard unit cost

Those five figures sum exactly to `actual total cost − standard total cost`, which is why the
completion entry always balances and **WIP nets to zero** on every completed order.

Actual unit cost is spread over **good output only**, so scrap correctly raises the cost of the
units that survived.

### Inventory that agrees with the ledger
Receipts re-average the cost; issues are valued at the current moving average, and *that rate
becomes the production order's actual rate*. The stock ledger and the GL therefore cannot drift
apart — the smoke test asserts equality on both raw material and finished goods.

### Accounts, tax and reporting
- 25-account chart of accounts, trial balance, account ledger with running balance, P&L
- Manual journal entries (rejected if debits ≠ credits) and one-click reversals
- Input tax kept out of inventory cost; output tax kept out of revenue; net position per period
- **13 reports**, each viewable on screen, downloadable as **CSV** (opens in Excel) or as a
  **print-ready PDF** with company header, totals block, explanatory notes and page numbers

### Roles and audit
Seven roles with an explicit permission matrix (`server/src/config/roles.js`). The API checks the
permission on **every** request — hiding a button is never the only control. Every state change is
written to an audit trail with user, role, entity and detail.

---

## Verifying it works

With the server running:

```bash
cd server
node src/seed/smoke.js
```

41 end-to-end assertions covering authentication, RBAC denial, recipe versioning and
self-approval blocking, production issue/complete, ledger balance, stock-to-GL agreement,
tax tie-out, shortage rejection, and CSV/PDF generation. The test is repeatable — it tops up
stock and raises its own recipe version if an earlier run consumed the seeded one. After three
back-to-back runs the login rate limiter (25 attempts per 10 minutes) will pause it; that is the
brute-force control working, and the test says so rather than reporting a failure.

```
  41 passed, 0 failed
```

---

## Project layout

```
api/
  index.js       Vercel serverless entry point -> server/src/app.js

server/
  src/
    app.js       the Express app (no listen) - shared by Vercel and local dev
    index.js     local development listener
    config/      env, database, role/permission matrix
    models/      13 Mongoose schemas
    services/    costing · inventory · accounting · tax   <- the engine
    controllers/ request handlers with zod validation
    routes/      one router, permissions declared per route
    utils/       numbering, money rounding, CSV, PDF
    seed/        seed.js (demo company) · smoke.js (end-to-end tests)
                 migrate.js (copies a database into another, e.g. onto Atlas)

client/
  src/
    components/  AppLayout · ExcelGrid · shared UI
    pages/       16 screens
    context/     auth + permissions
    api/         axios client, error toasts, blob downloads
    theme.js     Mantine theme
    styles/      global CSS, animations, grid styling

legacy/          the original single-file HTML prototype, kept for reference
vercel.json      build, output directory and the /api + SPA rewrites
```

### API

All routes are under `/api` and require `Authorization: Bearer <token>` except `POST /auth/login`.

```
POST   /auth/login                     GET    /recipes            POST /recipes/:id/submit
GET    /auth/me                        POST   /recipes            POST /recipes/:id/approve
POST   /auth/change-password           PUT    /recipes/:id        POST /recipes/:id/reject
                                       GET    /recipes/:id/simulate?qty=N
GET    /dashboard                      POST   /recipes/:id/new-version
GET    /materials  POST /materials
GET    /production                     POST   /production/:id/release
POST   /production                     POST   /production/:id/issue
GET    /production/:id/variance        POST   /production/:id/complete
GET    /inventory/valuation            POST   /inventory/adjust
GET    /inventory/movements            POST   /inventory/receive
GET    /accounts   POST /journals      GET    /gl/trial-balance   GET /gl/financials
GET    /accounts/:id/ledger            POST   /journals/:id/reverse
GET    /invoices   POST /invoices      POST   /invoices/:id/post
GET    /tax/summary                    GET    /tax/register
GET    /reports                        GET    /reports/:key?format=csv|pdf
GET    /users      POST /users         GET    /audit              GET/PUT /settings
```

---

## Configuration

`server/.env`:

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/biscuit_erp
JWT_SECRET=change-this-in-production
JWT_EXPIRES=12h
CLIENT_ORIGIN=http://localhost:5173
```

**Change `JWT_SECRET` before deploying anywhere.**

`npm run seed` **deletes every document** in the `biscuit_erp` database before rebuilding the demo
company. Do not run it against real data.

---

## Deploying to Vercel

The whole system deploys as one Vercel project: the built React app is served as static files, and
the entire Express API runs as a single serverless function behind `/api`. Because both halves
share an origin in production, the browser makes same-origin requests and no CORS configuration is
needed.

| Piece | Where it lives |
|---|---|
| `api/index.js` | Vercel entry point; hands every `/api/*` request to the Express app |
| `server/src/app.js` | the app itself, with no `listen()` — shared by Vercel and local dev |
| `server/src/index.js` | local development listener only |
| `vercel.json` | build command, output directory, and the `/api` + SPA rewrites |

### 1. A MongoDB Atlas cluster

Atlas gives you a connection string that ends at the host. **Append the database name**, or
everything lands in a database called `test`:

```
mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/biscuit_erp?retryWrites=true&w=majority
```

Under **Network Access**, add `0.0.0.0/0`. Serverless functions do not have a fixed outbound
address, so an allow-list of specific addresses will fail intermittently and confusingly. The
database is still protected by its username and password.

If the password contains `@`, `:`, `/` or `%`, percent-encode it before putting it in the string.

### 2. Move your data up

`npm run migrate` copies every collection — documents, `_id`s and indexes — from your local
MongoDB into Atlas, so the accounts you already sign in with keep working:

```bash
npm run migrate -- --dry-run --to "mongodb+srv://.../biscuit_erp?retryWrites=true&w=majority"
npm run migrate -- --to "mongodb+srv://.../biscuit_erp?retryWrites=true&w=majority"
```

It refuses to write into a collection that already holds documents unless you pass `--drop`, so
running it twice cannot quietly duplicate your books. To start from clean demo data instead, point
`MONGO_URI` at Atlas and run `npm run seed`.

### 3. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**, for Production, Preview and
Development alike. The API refuses to start without the first two rather than falling back to a
development default:

| Name | Value |
|---|---|
| `MONGO_URI` | the Atlas string from step 1, database name included |
| `JWT_SECRET` | a long random string — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES` | `12h` (optional) |

`CLIENT_ORIGIN` is not needed in production: a request whose `Origin` matches the host it arrived
on is treated as same-origin, which also covers preview deployments whose hostname changes on
every push.

### 4. Deploy

Import the repository at [vercel.com/new](https://vercel.com/new) and accept the settings from
`vercel.json` — leave the root directory as the repository root, not `client`. Every push to
`main` redeploys.

### Known limits of the serverless deployment

- **Cold starts.** The first request after a quiet spell pays for the container starting and the
  Atlas handshake, so a sign-in can take a couple of seconds. Subsequent requests are warm.
- **Login lockout is per instance.** The rate limiter counts failed attempts in one function
  instance's memory, so an attacker spread across instances gets more than 10 tries. It is a
  speed bump, not the only defence.
- **The free tier sleeps.** An Atlas M0 cluster pauses after long inactivity and takes a moment to
  wake.

---

## Honest scope

This is a working system with a real costing and accounting engine, not a mock — but before it
carries a real company's books:

- **Tax rates are illustrative.** The 18% default and the further/withholding rates must be set to
  what actually applies to your product under current law. Nothing here files anything with FBR.
- **No integrations.** No FBR/IRIS, no bank feed, no payroll. These would be separate services
  written against this API.
- **Costing choices are opinionated.** Inventory is moving-average, output is capitalised at
  standard with variances to P&L, and admin/marketing are period costs excluded from stock value.
  All defensible, all worth confirming with your auditor.
- **Login lockout is per account, per address** — 10 failed attempts in 10 minutes locks that one
  account, not the whole office. Successful sign-ins never count towards it. The counter lives in
  memory, so restarting the API clears every lockout.
- **Auth is a bearer token in `localStorage`.** Fine behind a firewall; move to httpOnly cookies
  with refresh rotation for public deployment.
- **No fiscal period locking or approval limits** on journal entries yet.
```
