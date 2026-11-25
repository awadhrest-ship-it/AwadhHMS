# Awadh Palace Hotel Management System — Phases 1–8

MERN application: **Phase 1** Core System & Access, **Phase 2** Room Management & Pricing, **Phase 3** Guests, Reservations & Front Desk,
**Phase 4** Inventory & Stores, **Phase 5** Housekeeping, **Phase 6** Restaurant, Room Service & POS, **Phase 7** Kitchen & Kitchen Display, **Phase 8** Bar Management.
Later phases (purchase, maintenance, employees, accounts & finance, night audit, banquet) are intentionally **not** built.

## Tech stack
React 18 + Vite + Tailwind + React Router + Axios + Zustand + lucide-react + PWA (vite-plugin-pwa) · Node + Express · MongoDB + Mongoose · JWT + bcryptjs · zod validation.

## Structure
```
awadh-palace-hms/
├── client/   src/{components,layouts,pages,hooks,services,store,utils}
└── server/   config/ controllers/ middleware/ models/ routes/ services/ seed/ tests/ utils/
```
Business logic lives in `server/services/` (availability & double-booking, pricing, reservations, approvals, room status, audit, notifications, domain events).

## Setup
Requires Node 18+ and MongoDB (local `mongod` or an Atlas URI).
```bash
npm install                      # root (concurrently)
npm run install:all              # root + server + client
cp server/.env.example server/.env     # then edit MONGO_URI / JWT_SECRET
cp client/.env.example client/.env
npm run seed                     # DEMO DATA. Wipes and re-seeds a fresh/dev database (refuses if users exist, see below)
npm run dev                      # API on :5000, web app on :5173
```
**Existing database?** Never run `npm run seed` on it. Run `npm run migrate` (or just start the server, which does it on boot): it only *adds* — permissions, units, inventory categories, new roles and the Phase 4/5 permissions on existing default roles — is idempotent, and never deletes data or changes who has which role. `npm run seed:phase45` additionally adds clearly labelled demo items, demo housekeeping users and demo tasks/reports (create-if-missing, repeatable). `npm run seed` itself now refuses to run when users already exist unless `ALLOW_SEED_WIPE=yes`, and always refuses in production.

Separately: `npm run dev:server`, `npm run dev:client`. Production client: `npm run build` (output `client/dist`).
Tests (need a reachable MongoDB; they **wipe and re-seed** `MONGO_URI`, default `awadh_test`, and refuse to run unless the database name contains `test`): `MONGO_URI=mongodb://127.0.0.1:27017/awadh_test npm run test:server`.

## Demo accounts — password for all: `Awadh@123`
| Role | Email |
|---|---|
| Hotel Owner | owner@awadhpalace.test |
| Director | director@awadhpalace.test |
| General Manager | gm@awadhpalace.test |
| Front Office Manager | fom@awadhpalace.test |
| Receptionist | reception@awadhpalace.test (also reception2@) |
| Sales Manager | sales@awadhpalace.test |
| Accounts Manager | accounts@awadhpalace.test |
| Housekeeping Manager | housekeeping@awadhpalace.test |
| Restaurant Manager | restaurant@awadhpalace.test |
| Supervisor (inspects rooms) | supervisor@awadhpalace.test |
| Housekeeping staff | hkstaff1@awadhpalace.test, hkstaff2@awadhpalace.test |
| Store Manager | store@awadhpalace.test |
| Purchase Manager | purchase@awadhpalace.test |
| Captain *(Phase 6)* | captain@awadhpalace.test |
| Kitchen Manager *(Phase 6)* | kitchen@awadhpalace.test |
| Chef *(Phase 6)* | chef@awadhpalace.test |
| Head Chef *(Phase 7)* | headchef@awadhpalace.test |
| Cashier *(Phase 6)* | cashier@awadhpalace.test |
| Bar Manager *(Phase 8)* | barmanager@awadhpalace.test |
| Bartender *(Phase 8)* | bartender@awadhpalace.test, bartender2@awadhpalace.test |

## Routes
`/bar /bar/orders /bar/menu /bar/inventory /bar/variance /bar/complimentary /bar/losses /bar/shifts /bar/reports /bar/settings` (Phase 8) · `/restaurant /restaurant/pos /restaurant/orders /restaurant/floor /restaurant/menu /restaurant/bills /restaurant/bills/:id /restaurant/approvals /restaurant/closing /restaurant/settings /inventory /inventory/items /inventory/stock /inventory/movements /inventory/stocktakes /inventory/alerts /inventory/setup /housekeeping /housekeeping/my-tasks /housekeeping/tasks/:id /housekeeping/inspections /housekeeping/supplies /housekeeping/reports /housekeeping/performance /housekeeping/settings` plus `/login /dashboard /rooms /rooms/:id /reservations /reservations/new /reservations/:id /guests /guests/:id /check-in /check-out /bills /bills/:id /complaints /complaints/:id /approvals /audit-log /settings/users /settings/roles /settings/property`
API is under `/api` (auth, users, roles, permissions, property, rooms, room-categories, rate-plans, guests, reservations, bills, complaints, approvals, audit-logs, notifications, dashboard, **inventory**, **housekeeping**, **restaurant**, **files**).

## Implemented
**Phase 1** — property setup; JWT login/logout/me; per-employee accounts; roles + permission catalogue (view/create/edit/delete/approve per module); custom roles (cannot grant permissions you don't hold); department restriction enforced in middleware; reusable approval framework (cancellation + price change wired end-to-end); audit trail with old/new values and IP/device; in-app notification centre; DB-driven dashboards.
**Phase 2** — room categories and rooms (floors, amenities, photo links, capacity, extra-bed charge); the ten required statuses; grid with floor/type/status filters + search; room drawer with history; block/unblock/out-of-order/restore (reason required, audited); 7-day availability calendar; configurable rate plans (7 types, rules by weekday, dates, nights, guests, client, source) with price quoting.
**Phase 3** — guests (VIP, blacklist, marketing consent + channel preferences as data only, corporate/agent profiles, ID-document metadata, preferences, repeat-guest detection); 6-step reservation wizard; server-side double-booking prevention (overlap check + per-room lock); edit with re-validation; cancellation and price change via approval; check-in (verification, room assignment, folio charges, room → Occupied); check-out (balance check, room → Vacant & Dirty, `checkout.completed` event); guest folio with payments and outstanding balance; complaints (register, filter, resolve, shown in guest history and dashboard).

## Phase 4 — Inventory & Stores
- **Items & categories**: item code (unique), category, base / purchase / usage unit, per-department minimum levels, optional expiry tracking, active/inactive (items with history are deactivated, never deleted). Default categories: food, soft drinks, liquor, linen, toiletries, cleaning supplies, kitchen supplies, maintenance parts (editable; Housekeeping finds linen / toiletries / cleaning supplies by a stable category *key*, so renaming is safe).
- **Units & conversions**: count / weight / volume units convert automatically (kg↔g, l↔ml, dozen↔pcs). Package units (bag, carton, box…) need an explicit factor **per item** (a bag of rice ≠ a bag of sugar); an unsafe conversion is refused with a clear message. Quantities are stored as exact integers (1 unit = 1,000,000 micro-units), so there is no floating-point drift.
- **Stock movements**: Opening Stock, Stock In (supplier, price, batch, expiry), Stock Out, Transfer between departments, Wastage / Breakage / Damaged (reason required), Consumption, Adjustment. Every movement writes immutable ledger rows (who, when, before/after). Issues use first-expiry-first-out across batches.
- **Never negative, never twice**: each stock change is a single guarded atomic update on one document (it only succeeds if enough stock is there and its own idempotency marker is absent). Every movement has a unique idempotency key (the `Idempotency-Key` header; the web app sends one per open form), so a retry after a timeout is a no-op and returns `replayed: true`. Interrupted movements are resumed on start-up and every 5 minutes. A failed multi-line movement is rolled back.
- **Manual adjustments are approval-gated** (PDF §8): the request creates an approval ("Stock adjustment" rule, now required by default) and stock does not change until an approver approves; approving applies it exactly once; rejecting changes nothing. Stock-count (stocktake) variances use the same route.
- **Stock control**: department-wise stock, low-stock alerts (notify once per occurrence, with state, not on every movement), expiry/expired lists, price history per item, stocktakes (count → variance → explain → approved adjustment), movement reports and CSV export, dashboard KPIs.
- **Department scoping**: permissions say *what* a user may do; `settings.inventory.allAccessDepartments` (default Management, Stores, Purchase) and cross-department roles decide *whose* stock — everyone else sees and moves only their own department's stock (enforced in the API).
- **MongoDB transactions**: the code does **not** require a replica set / transactions. Exactly-once behaviour comes from single-document atomic updates + idempotency keys + a resumable movement state machine, so it works on a standalone `mongod`. (If you later run a replica set you may wrap multi-document steps in transactions; the idempotency design stays valid.)

## Phase 5 — Housekeeping
- **Tasks**: created automatically at check-out (one per reservation, idempotent; a failure in housekeeping never undoes a check-out — use *Sync rooms* to recreate a missed task), plus manual and stay-over tasks (one per occupied room per day). Statuses: Unassigned → Assigned → In Progress → Inspection Pending → Completed (or Re-clean Required / Cancelled). Priority, due time and overdue flag; arrival-today rooms start High priority (configurable).
- **Assignment**: only users whose role has `housekeeping.work` can be assigned; staff see only their own tasks (others return 404), managers see all; reassignment history is kept and the assignee is notified.
- **Checklist, photos, inspection**: the task owns the checklist (mirrored to the room so the Rooms screen stays truthful); before/after photos (JPEG/PNG/WebP/GIF, real file type checked from the bytes, size-limited, stored in `UPLOAD_DIR`, served only to people allowed to see the task); submit → room **Inspection Pending**.
- **Supervisor inspection is enforced in the backend**: a room in the cleaning cycle becomes Vacant & Clean / Available only when someone holding `housekeeping.inspect` approves the task. The generic room-status endpoint, the legacy checklist endpoints and the Blocked/Out-of-Order release path all refuse to bypass it (409 with an explanation). Rejection needs a reason, reopens the failed checklist items, sends the room back to Cleaning in Progress and notifies the cleaner. The cleaner cannot inspect their own work (configurable). Two supervisors acting at once: one wins, the other gets 409.
- **Linen / toiletries / cleaning supplies**: recorded against a task or room; each use is exactly one *Consumption* movement of Housekeeping stock (retry-safe `clientKey`), so stock, ledger and low-stock alerts stay consistent with Phase 4.
- **Damage, missing items, lost & found**: one report flow with photos and status workflow; lost-and-found "Returned" needs the claimant's name and the ID checked. Creating a maintenance request from a damage report is **not** done (Phase 10, TBC) — the report only records that maintenance is needed.
- **Staff performance**: tasks submitted, passed inspections, average clean time, rejection rate, first-pass rate, on-time %. Every figure is computed from task/inspection records; definitions are shown in the app. Staff see only their own row.

## Phase 6 — Restaurant, Room Service & POS
Everything below is persisted by the backend; the browser never holds authoritative orders, bills, approvals or stock. Menu/order prices, discounts, taxes, totals, payment status and folio ownership are **always recomputed on the server** — unknown or crafted fields in a request are stripped.

**6.1 Tables & reservations** — tables (unique number, section, capacity, active / out-of-service). Occupied / Reserved / Available is **derived**, never typed in: a dine-in order takes an atomic claim on its table (`RestaurantTable.currentOrder`), released when the order completes, is cancelled or moves. Reservations validate capacity, reject overlapping bookings on the same table (back-to-back is fine), refuse past times, and have Booked → Seated → Completed / Cancelled / No-show with history. A walk-in cannot take a table that is booked within the hold window (default 30 min); starting an order *from* the reservation seats it. **Table transfer** moves the whole order (items, tickets, reservation link) to a free table atomically and leaves a history entry.

**6.2 Menu** — categories and items (code, description, price ≤ 2 decimals, taxable flag, veg flag). Items are retired, never deleted. Orders snapshot name/price, so editing or retiring an item never changes an existing order or bill (price history is kept). Kitchen/restaurant staff toggle *available today*; unavailable and retired items are refused **by the server** when an order is placed. `station` and `recipe` fields exist but are empty — they are the Phase 7 extension points; no recipe or stock deduction happens in Phase 6.

**6.3 Orders** — Dine-in, Takeaway, Delivery, Room Service. Lifecycle: `Draft → Confirmed (sent) → Preparing → Ready → Served → Completed`, or `Cancelled` (kept, with reason). After sending, status is **derived from kitchen tickets**; `Completed` is reached only automatically when the order is Served and every bill is settled. Items can be edited freely until sent; sent items are locked (cancelling one needs `restaurant.void` + a reason and stays visible). Item-level and order-level special instructions. Creating an order requires an `Idempotency-Key` (the web app sends one per submit): a retry returns the same order. **Room service** takes the stay from `/restaurant/in-house` (checked-in guests only); the guest, room and folio are loaded from the database and cross-checked — a typed name or room number can never choose the billing account.
**Kitchen tickets (the Phase 7 contract)** — sending raises a `KitchenTicket` (KOT-nnnn) per round; `(order, round)` is unique so a retry/double-click cannot duplicate it. Tickets carry order type, table/room, items + instructions, station (null) and timestamps. Phase 7 should read `GET /api/restaurant/tickets` and move tickets with `POST /api/restaurant/tickets/:id/status` (`Preparing`, `Ready`; `Served` is front-of-house). Phase 6 only ships a basic queue (Orders page) to prove tickets work — **not** the kitchen display, stations, recipes, delayed-order alerts or chef performance.

**6.4 Billing** — one bill per order, or a **split** into N bills. Every ordered quantity must be assigned to exactly one bill (over-assignment and left-overs are refused). Maths is integer paise; discounts are spread over lines by largest remainder; **tax is calculated once on the combined taxable amount of all of an order's bills and allocated to the bills by largest remainder, so split bills always add up to the unsplit bill to the paisa** (tested with awkward prices). Draft → Final freezes totals and a **snapshot of the tax rates used**. Payments: configured methods only, partial payments allowed, an atomic balance guard makes over-collection impossible, and an idempotency key makes a double-submit record one payment. A finalised bill can't be edited; to void it a manager raises a **Bill editing** approval (paid bills can't be voided in Phase 6 — refunds are Phase 12).
- **Discounts and complimentary food always need approval** (PDF §8). The request creates an `ApprovalRequest` (types *Discount* / *Complimentary food*) with reason, items/value and a link to the bill; the bill is **unchanged while pending** and can't be finalised. Rejecting changes nothing. Approving applies it **exactly once** (version-checked), records before/after totals and the approval reference; a request made stale by a changed order is withdrawn automatically and can't be applied. A user can't approve their own request (except the Owner). Value thresholds are still TBC — the existing approval-rule thresholds only decide *who* approves; no amount is invented. Complimentary-food approval was `required: false` by default in earlier phases; the PDF says it is required, so the default is now `true` (migration `phase6-approval-complimentary-food`) and the restaurant code requires approval regardless.
- **Room-service charges post to the existing guest folio** when the bill is finalised: one `Room Service` charge (net) plus a `Tax` charge per configured tax, each carrying `sourceRef = rb:<billId>:…` and a link to the bill. The folio write is a single conditional update that only happens if that reference is absent, so retries, double-clicks and concurrent requests cannot double-charge. If posting fails (e.g. folio closed) the bill stays *Final / Not posted*, the order is **not** marked complete, an urgent notification is raised, and *Retry posting* (`POST /restaurant/bills/:id/post-to-folio`) is safe. A folio posting is a **charge**, never a payment; it is settled by the guest at the front desk. Voiding a posted bill (approval) adds reversal entries; history is never rewritten.

**6.5 Daily closing (provisional)** — pick a business date (hotel time, IST). The server rebuilds, from saved orders/bills/payments: sales (gross, complimentary, discount, net, tax, total), by order type, **collected payments by method** (cash basis, by receipt date), **room-service postings (not cash)**, outstanding balances, cancelled orders and voided bills (never counted as sales). Exceptions are *Must be resolved* (open/unserved orders, unbilled served orders, draft bills, pending approvals, unposted room charges), *Acknowledge to carry forward* (unpaid bills) or *Information* (no tax configured; payments for earlier days). Closing stores an immutable snapshot with references and who/when, is idempotent, and `businessDate` is unique so a day closes once. After closing, new orders for that date and voiding that day's finalised bills are refused. **Phase 13 boundary:** `GET /api/restaurant/closings/:date/status` (and `/:date`) return the closed flag, snapshot and timestamps; the `restaurant.closing.completed` event is published. Phase 6 does not close the hotel day or post nightly room charges.

### Phase 6 API (all under `/api/restaurant`, all authenticated; permission in brackets)
`GET overview, settings, tables, tables/:id, reservations, menu, menu/categories, menu/items(/:id), orders(/:id), tickets, bills(/:id), adjustments` `[view]` · `PUT settings` `[configure]` · `POST/PUT tables` `[tables]` · `POST/PUT reservations`, `…/:id/{cancel,no-show,seat,complete}` `[reservations]` · `POST/PUT menu/categories, menu/items` `[menu]` · `PATCH menu/items/:id/availability`, `POST menu/reset-availability` `[availability|menu]` · `GET in-house`, `POST orders`, `PATCH orders/:id`, `POST orders/:id/{items,send,serve,cancel,transfer}`, `PATCH/DELETE orders/:id/items/:itemId` `[orders]` (cancelling sent orders/items needs `[void]`) · `POST tickets/:id/status` `[kitchen|orders]` · `POST orders/:orderId/bills`, `bills/:id/{adjustments,finalise,post-to-folio}` `[billing]` · `POST bills/:id/payments` `[payment]` · `POST bills/:id/void` `[billing]` for drafts, `[void]` + approval for final bills · `GET closing/preview`, `POST closing`, `GET closings(/:date)` `[close]` · `GET closings/:date/status` `[close|view]`.
Orders, payments and closing require an `Idempotency-Key` header (or `idempotencyKey` in the body).

### Phase 6 configuration — what the hotel must confirm
Set under **Restaurant → Settings** (`Property.settings.restaurant`, audited):
- **Taxes** — *none by default*. No GST rate is assumed. Add the confirmed tax(es) (name + rate %, up to 6). Rates apply to the taxable (post-discount) amount, prices are tax-exclusive, items can be flagged non-taxable, and a finalised bill keeps the rates it was finalised with. The UI states "no tax configured" until set.
- **Payment methods** — the hotel-wide list (`Property.settings.paymentMethods`, demo defaults) unless a restaurant-specific list is set. Not confirmed by the hotel.
- Reservation default length (90 min), table hold before a booking (30 min), delivery fields required (contact name, phone, address — minimum set, TBC), max quantity per line (50).

### Phase 6 permissions
`restaurant.{view,tables,reservations,menu,availability,orders,kitchen,billing,payment,void,close,configure}`. Provisional defaults (editable in Settings → Roles; the PDF does not define them — Q23): **Restaurant Manager** all; **Captain** view + reservations + orders + billing (no payments/void/close/menu); **Kitchen Manager / Head Chef / Chef** view + availability + kitchen tickets; **Cashier** view + billing + payment; **Front Office Manager, Director, Accounts Manager** view only (front-office room-bill responsibility TBC); **GM / Owner** all and approve. The module is department-scoped (Restaurant, plus Kitchen, Front Office and Accounts users). Existing databases get the new permissions added to the *default* roles by migration `phase6-role:<role>` (additive; custom roles and edits are never touched).

### Provisional rules (PDF marks these TBC — change them when the hotel decides)
Who enters orders (Captain vs waiters) · tax rates and structure · payment methods · approval value thresholds · delivery details and staff (no dispatch/driver tracking built) · restaurant closing steps and what must be closed before Night Audit · front-office responsibility for room bills · hotel business day = calendar day in IST · "one common counter" and cashier shifts (Phase 12).

### Pending for later phases
**Phase 7**: kitchen display screen, stations (Main/Indian/Chinese/Tandoor mapping), recipes → ingredient consumption, food cost, wastage, delayed-order alerts, chef performance. **Phase 12**: refunds, cashier shift closing, accounts/GST reports, payments rolling into revenue (Phase 6 payments are a separate collection and do not change the dashboard's room "revenue"). **Phase 13**: night audit consuming the closing snapshot.

### Phase 6 consistency model (be aware)
Like Phases 4–5, nothing requires a replica set or transactions. Consistency comes from single-document atomic/conditional updates (table claim, bill-set revision, payment balance guard, folio posting reference, ticket `(order, round)`), unique indexes (idempotency keys, closing date), and compensation (a payment whose record fails to save releases its reserved balance). The check-then-write for reservation overlap uses an in-process lock (single instance); on several instances use a replica set with transactions. Multi-step operations that could stop half-way (sending items, posting to folio) are written so a retry resumes safely.

## Phase 7 — Kitchen & Kitchen Display

Phase 7 extends the Phase 6 `KitchenTicket` / `MenuItem` and the Phase 4 stock engine; it adds **no** second inventory engine, ticket workflow or ingredient catalogue.
UI: sidebar group **Kitchen** (`/kitchen/*`); kitchen staff land on the Kitchen display after login.

### What was added
| Module | What it does | Where |
|---|---|---|
| 7.1 Kitchen display | Station-aware KDS (Main kitchen, Indian, Chinese, Tandoor + *Unassigned*), new / preparing / ready lanes, delayed + new highlighting, filters (station, order type, delayed, new), item-level and station-level actions, assign / claim, sound, full screen, availability drawer | `pages/kitchen/Display.jsx`, `services/kitchen/tickets.js` |
| 7.2 Delayed orders | Configurable thresholds, one deduplicated in-app alert per ticket + station, auto-resolve, optional single escalation (off) | `services/kitchen/delays.js` |
| 7.3 Recipes & consumption | Versioned recipes on real inventory items, unit conversion, food cost, automatic consumption when a bill is finalised, history / retry / waive | `services/kitchen/recipes.js`, `consumption.js` |
| 7.4 Wastage & prep list | Wastage through the stock engine (ingredient or dish), reports; one preparation list per business date with planned vs actual | `wastage.js`, `prep.js` |
| 7.5 Chef performance | Transparent activity metrics derived from recorded actions; optional configurable indicator (off) | `performance.js` |

### Ticket lifecycle (design decision)
Phase 6's **one ticket per order round** (`orderRound` unique → duplicate sends cannot create tickets) is **kept**. Each ticket item now has its own `status` (Queued → Preparing → Ready → Served, or Cancelled), its station (snapshotted from `MenuItem.station` when the order is sent) and who/when. A ticket's `status` is **derived** from its non-cancelled items (never set independently), so one station finishing never marks the whole ticket Ready, and Ready ≠ Served (serving stays front-of-house, `restaurant.orders`). The KDS shows a **station slice** of a ticket, so each station sees and acts on only its own items. Two stations updating one ticket at the same moment are protected by an optimistic `rev` counter with retry. The Phase 6 ticket-level endpoint `POST /restaurant/tickets/:id/status` still works (it moves every open item). Every transition records who and when (`history`, item `startedBy/readyBy`, audit log). Tickets created before Phase 7 are read as "item status = ticket status" and back-filled by a migration.

### Station configuration
The PDF lists the four stations but marks the item → station mapping **TBC**, so nothing is pre-assigned. Items without a station appear under **Unassigned** (visible to users who may see all stations or assign stations); a manager can route an item on a live ticket (`PATCH /kitchen/tickets/:id/items/:itemId/station`) or assign stations in bulk in **Kitchen → Settings → Stations**. A user with `kitchenStations` set (Users form) sees/acts only on those stations unless their role has `kitchen.allStations`; no stations = not restricted.

### Delay thresholds & alerts (all provisional — PDF: limit, recipients, escalation are TBC)
Delayed = a station's share is Queued/Preparing and more than its limit has passed since the ticket was queued. Limit precedence: **station value → order-type value (if enabled) → default** (default **20 min is a provisional starting value, not hotel policy**). Stored in `Property.settings.kitchen`. Recipients = configurable roles and/or people (provisional default: Kitchen Manager, Restaurant Manager) via the existing in-app notifications; **no SMS/WhatsApp/e-mail**. Spam control: `KitchenDelayAlert.key = ticket:station` is unique, so repeated sweeps (30 s interval + board refresh) create one alert; it resolves on Ready/Cancelled/re-route. Escalation: off; when on, one extra alert N minutes after the first.

### Recipes & food cost
One recipe per menu item; ingredients are `InventoryItem`s with a quantity and any unit the item can convert from (existing conversion engine; invalid conversions, zero quantities, inactive/unknown items and duplicate lines are rejected). `yield` = how many servings the listed quantities make. Every create/edit/activation bumps `version` and writes an immutable `RecipeVersion`.
**Food cost % = (ingredient cost ÷ selling price) × 100**, selling price excluding tax; also shown: per-ingredient cost, cost per serving, gross contribution (price − cost). Ingredient cost uses the item's latest purchase price, else the weighted cost of stock lots on hand. If any ingredient has no cost on record the result is flagged **incomplete** and the percentage/contribution is *not* shown — a cost is never invented. Overheads, salaries and utilities are not included; this is not profit.

### Ingredient consumption — trigger, lifecycle, idempotency
* **Trigger: a restaurant bill is finalised** (Phase 6 `finaliseBill`, which also posts room-service bills to the folio). Not on draft orders, adding items, sending to the kitchen, Preparing, Ready or Served.
* **Only path to stock:** `services/inventory/stock.js` `postMovement` — type `Consumption`, source `kitchen`, department `Kitchen` (configurable), reference → the bill. The one engine change is additive: decrement ops now also record the lot's `unitCost` (cost basis).
* `KitchenConsumption` is **unique per bill** and is created (`Pending`) with a frozen snapshot of the recipes/quantities **before** the movement is posted; the movement's idempotency key is derived from that record. Crash after the stock change → the sweeper re-posts with the same key and the engine recognises it (no second deduction); crash before it → rolled forward once. A start-up and 2-minute sweep also picks up finalised bills that never got a record.
* The movement is all-or-nothing. **Billing is never blocked by a shortage:** the record becomes `Failed` (nothing deducted), Store/Kitchen managers with `kitchen.consumption.resolve` are notified, and they **Retry** after restocking or **Waive** with a reason (audited). Nothing is skipped silently. Menu items with no recipe → status *No Recipe* (listed in "menu items without a recipe").
* Split bills consume their own portions; **void → re-bill never double-consumes** (portions already consumed per order line are subtracted). A void does **not** auto-return stock (the food may be cooked) — use a stock adjustment (needs approval).
* **Bills finalised before Phase 7 are never consumed retroactively** (`consumption.enabledFrom` is stamped once by the migration; moving it earlier in Settings back-fills).
* Historical accuracy: each record keeps recipe version, ingredient quantities and the cost basis used; the food-cost report reads those snapshots, never today's recipe.

### Preparation vs sale vs wastage (no double deduction)
The preparation list records **planned vs actual/remaining quantities only and never touches inventory**. Ingredients leave stock at **sale**; thrown-away food leaves stock through **wastage**. A wasted *dish* writes off its recipe ingredients (they were never consumed by a sale); a wasted *ingredient* writes off that item. So an ingredient can be deducted by exactly one of: a sale, or a wastage record.

### Wastage
`POST /kitchen/wastage` requires an `Idempotency-Key`; a row (unique key) is created first and the stock-engine movement (`Wastage`, source `kitchen`) uses a derived key, so resubmitting never deducts twice. Department rules of the stock engine apply. Reasons are configurable (defaults are practical, not an official list; "Other" needs a note). Only notes can be corrected afterwards (history kept); stock mistakes are corrected with an inventory adjustment. Reports: daily, ingredient, station, reason, person; cost only where cost data exists (else flagged incomplete).

### Chef performance
Derived only from recorded actions: assigned/claimed tickets and items started/marked ready. Shared work counts for every participant (flagged), pre-Phase-7 tickets are "unattributed". Metrics: tickets handled, completed, avg total (queued→ready) and prep (started→ready) time, on-time rate (vs the station's current limit), delayed orders handled, cancelled (assigned), prep tasks assigned/completed, wastage records (context only). Averages are blank, not zero, when there is no data. The optional combined indicator is **off**, configurable, and labelled internal — the hotel has not decided how performance is measured.

### Permissions (all `kitchen.*`, assignable per role; defaults are editable, the PDF does not define create/edit/delete per role)
`view`, `allStations`, `update`, `assign`, `stations`, `recipes.view`, `recipes.edit`, `consumption.view`, `consumption.resolve`, `wastage.record`, `wastage.view`, `prep.manage`, `prep.work`, `performance.view`, `configure`. Defaults: Kitchen Manager all; Head Chef all except `configure` and `consumption.resolve`; Chef view/update/recipes.view/wastage.record/prep.work; Restaurant Manager view, all stations, stations, recipes.view, consumption.view, wastage.view, performance.view, configure; Store Manager recipes.view, consumption.view/resolve, wastage.view; General Manager / Owner everything. Availability reuses the Phase 6 `restaurant.availability` permission and the **same** `MenuItem.available` flag (no second flag; stock replenishment never re-enables an item). Every route is authorised on the server.

### Real-time
The app has no socket layer and none was added: the display **polls** `GET /kitchen/board` (default 5 s, 3–60 s configurable), pauses while the tab is hidden, refreshes on re-focus/online, cleans up its timers, and only announces tickets that were not on screen before (a reconnect never re-announces).

### New API (`/api/kitchen`, all authenticated)
`GET overview, board, staff, settings, delays, menu, ingredients, recipes, recipes-missing, recipes/:id, recipes/:id/versions, consumption, consumption/:id, consumption/food-cost, wastage, wastage/report, prep, prep/date/:date, prep/:id, prep-reference, performance, tickets/:id` ·
`POST tickets/:id/items/status | assign | unassign | claim, menu/stations, recipes, recipes/:id/active, consumption/:id/retry | waive, wastage, prep, prep/:id/tasks, delays/sweep` · `PUT settings, menu/:id/station, recipes/:id` · `PATCH tickets/:id/items/:itemId/station, wastage/:id, prep/:id, prep/:id/tasks/:taskId` · `DELETE prep/:id/tasks/:taskId`.

### New database models
`Recipe`, `RecipeVersion`, `KitchenConsumption`, `KitchenWastage`, `KitchenPrepList`, `KitchenDelayAlert`. Extended (backward compatible): `KitchenTicket` (item status/timestamps/actors, `rev`, `assignees`, `history`), `MenuItem` (`recipe` ref, station audit fields), `User.kitchenStations`, `Property.settings.kitchen`.

### Migrations / upgrading an existing database
`npm run seed:phase7` (in `server/`) or simply start the server — migrations are idempotent and additive: `phase7-role:<key>` (adds the new permissions to the **default** roles only; custom roles untouched), `phase7-ticket-item-status` (back-fills item status on old tickets), `phase7-consumption-start` (stamps the consumption start date once), plus index creation for the new collections. No data is deleted or reset; no demo data is required. `seedPhase7` also creates a demo **Head Chef** login (`headchef@awadhpalace.test`). Menu stations and recipes are **not** seeded (hotel decisions). No new environment variables.

### Phase 7 tests and verification (what was actually run)
Environment: no real `mongod` was available; everything ran against **FerretDB 1.24 (SQLite)** like earlier phases (see "Honest limits" below).
* `cd server && npm test` → **107 tests: 102 pass, 0 fail, 5 skipped** (Phases 1–6 regression + 31 new Phase 7 tests: 29 pass, 2 skipped).
* `cd client && node --test src/utils/*.test.js` → 7 pass. `npm --prefix client run build` → succeeds (PWA service worker generated).
* A fresh `npm run seed` + real `node server.js` was started and queried over HTTP (login, board, overview, settings, recipes, performance, 403s for unauthorised roles).
* **Not run / not verified:** the 5 skipped concurrency tests (3 from earlier phases, 2 new: parallel competing bills, same-key parallel wastage) need real MongoDB — forcing them on FerretDB showed over-consumption, which is the documented FerretDB limitation (its conditional updates are not atomic), not evidence either way for MongoDB. **The UI was verified by production build and by exercising its APIs; it was not clicked through in a browser in this environment.** Replica-set transactions are not required by Phase 7.

### Known limitations
* Concurrency guarantees rely on MongoDB's atomic conditional updates (same as Phase 4); verify with `FORCE_CONCURRENCY_TESTS=1` against a real MongoDB.
* A `Failed` consumption needs a person to retry/waive; failed ones are not auto-retried.
* No "undo ready" on the KDS; Ready → Preparing is intentionally not offered.
* Stock is not returned automatically when a bill is voided.
* Wastage amounts cannot be edited after posting (notes only).
* On-time rate uses the delay limit configured *today* for past tickets.
* One recipe per menu item; no sub-recipes; bar items are out of scope.
* Polling (not push) — up to `pollSeconds` of latency.

### Outstanding hotel decisions (PDF Q25–Q27, Q60 — all configurable, none invented)
1. How menu items map to stations (Settings → Stations; starts Unassigned).
2. The delayed-order time limit (provisional 20 min; per-station / per-order-type supported).
3. Who receives delayed-order alerts (provisional: Kitchen Manager, Restaurant Manager; in-app only).
4. Whether delayed alerts escalate (off).
5. Whether recipes/consumption apply to bar items (not implemented; Phase 8).
6. The kitchen's current missing-item inspection process (not implemented / not invented).
7. How chef performance is measured (transparent metrics only; indicator off).

## Phase 8 — Bar Management

Phase 8 extends Phase 1 (users, roles, approvals, audit, alerts) and Phase 4 (the stock engine). It adds **no** second inventory engine, approval system, ledger or notification system. It does **not** touch Phase 6 billing, guest folios or the Phase 7 kitchen consumption code (the only edit to an earlier phase's logic is a 6-line hook in `services/inventory/approvalHandlers.js`, described below).

### What was added
| PDF module | What you get |
|---|---|
| **8.1 Bar menu & drink orders** | Bar menu (`/bar/menu`) with 30 ml / 60 ml / full-bottle servings, prices, optional per-serving happy-hour price, mixers per serving, availability. Drink orders (`/bar/orders`): save, edit while open, serve, cancel; "Serve now" for fast service. Happy-hour pricing is **configurable and OFF** until the hotel sets a rule. |
| **8.2 Bottle & peg-wise inventory** | `/bar/inventory`: sealed bottles, opened ml, pegs left, mixers. Bottle-opening records. Opening / closing stock report, liquor stock report. All quantities are Phase 4 balances. |
| **8.3 Stock variance** | `/bar/variance`: count sealed bottles + ml in opened bottles + mixers; expected stock is derived from the ledger; bottle-, peg- and item-level variance; immutable history; alerts; variance → Phase 4 stock-adjustment request (needs approval). |
| **8.4 Complimentary, wastage, breakage** | Complimentary request → General Manager / Owner approval (common approval framework) → issue (stock deducted once). Separate wastage and breakage workflows that post Phase 4 `Wastage` / `Breakage` movements. |
| **8.5 Bartender shift closing** | `/bar/shifts`: start, count, close; bar-closing report; corrections by a manager with a reason, original figures kept. |
| Reports | Liquor stock, opening & closing, bottle/peg consumption, stock & peg variance, complimentary, wastage, breakage, shift closing, and a daily summary for Phase 12 / 13 (`/bar/reports`). |

### How bar stock works (read this)
* Total liquor on hand (sealed + opened) is **one normal Phase 4 balance in ml** in the department `Bar`. Only the Phase 4 movement engine changes it. Receive stock with the normal Stock In (e.g. 12 *bottles* → 9000 ml), transfer, adjust and count in Inventory & Stores as before.
* **Bottle capacity is per item**: it is the item's own explicit `bottle` conversion in Phase 4 (`1 bottle = 750 ml`, `1000 ml`, …). Set it in **Bar menu → Bottle sizes**. Nothing is hard-coded to 750 ml.
* A liquor item is "measured" (gets the sealed / opened / peg treatment) only if its category is a liquor category (default `Liquor`, configurable), its stock unit is **ml**, and it has a bottle capacity. A liquor-category item stored in bottles (like the Phase 4 demo "Whisky 750 ml (demo)") is simply counted in its own unit and shown as **Needs setup** — create it in ml to use pegs.
* **Opening a bottle** moves liquor from *sealed* to *opened* inside the bar layer (`BarOpenStock`, with its own ledger `BarOpenLedger`). It changes **no** Phase 4 quantity, so it can never be mistaken for consumption or wastage. Each opening is an immutable `BarBottleOpening` (who, when, bottles, capacity, Phase 4 total at that moment, opened pool before/after).
* `sealed = total − opened`. **Pegs (30 ml / 60 ml)** are poured from the opened pool; if the pool is too small the order is refused with *"Open a bottle first"* (or, if you switch on **auto-open** in settings, a recorded opening is created automatically). **Full-bottle** sales and sealed wastage/breakage take from sealed stock.
* Serving consumption: 30 ml → 30 ml, 60 ml → 60 ml, full bottle → the item's configured capacity. Mixers are deducted **only** if you configured them on the drink (quantity, unit, which servings). A drink whose consumption is not fully configured shows **Incomplete** and cannot be sold (unless you explicitly allow it in settings, in which case **no** stock is deducted and the line is flagged). A drink can be explicitly marked *Not stock-tracked*.
* **One deduction path**: `services/bar/core.js → consume()`. Order: pre-check → opened-pool decrement (single-document atomic, idempotent marker) → **one** Phase 4 movement (all-or-nothing, idempotent key) → ledger rows. If the Phase 4 movement is refused (e.g. insufficient stock) the pool decrement is reversed and nothing has changed. Keys are `bar-order:<id>:a<attempt>`, `bar-comp:<id>:a<attempt>`, `bar-loss:<id>:a<attempt>`; a failed attempt increments `attempt`, a repeated request reuses the key.
* **Idempotency**: creating an order, opening a bottle, requesting a complimentary drink, recording wastage/breakage and recording a stock count all **require an `Idempotency-Key`** (header, or `idempotencyKey` in the body). The same key returns the same record; serving/issuing an already served/issued record is a no-op.

### Stock variance (8.3)
* **Expected** = opening + received + sold + complimentary + wastage + breakage + adjustments + other, summed from the persisted Phase 4 ledger of the bar department (sales and complimentary are told apart by the movement `source`: `bar-sale` / `bar-comp`; wastage/breakage by Phase 4 type). Expected opened ml comes from `BarOpenLedger`. It is never typed in or estimated.
* A count records expected, counted and variance **at that moment** and is **immutable**. A variance never changes stock. To fix stock, press *Request adjustment* on the line → a normal Phase 4 `Stock adjustment` approval (General Manager / Owner). When approved, the Phase 4 balance **and** the opened pool are aligned to the count; when rejected nothing changes. The original expected / counted / variance stay on the record.
* Peg variance = variance ml ÷ peg size (default 30 ml, configurable). Bottle variance = variance ml ÷ bottle capacity.
* **Alerts** reuse Phase 1.6 in-app notifications (`type: bar_variance`) plus a `BarVarianceAlert` record with a unique key per variance event, so the same variance is never alerted twice. **Provisional until the hotel decides**: with no tolerance set, *every* difference is reported; with no recipients set, the alert goes to everyone holding `bar.variance.view` (flagged on the alert as "no recipients configured").

### Complimentary drinks (8.4)
Request (`bar.comp.request`) → `Complimentary drinks` approval (General Manager / Owner only — Bar Manager and Bartender cannot approve) → **Approved** (still no stock movement) → **Issue** (`bar.comp.issue`) → stock deducted once → **Issued**. Pending, rejected and withdrawn requests never touch stock; there is no endpoint that records a complimentary drink without a request. No monetary threshold or extra hierarchy is invented (the approval framework's thresholds stay TBC). The migration sets the stored rule `Complimentary drinks` to *required* if the database still had the old default.

### Wastage & breakage (8.4)
Two workflows (`/bar/wastage`, `/bar/breakage`) → Phase 4 movement types `Wastage` / `Breakage`, with reason (from a configurable list), notes, supporting reference, who/when, shift. Record either a **stock item** (opened or sealed bottle, mixer) or a **poured drink** (uses the drink's configured consumption). Records can never be edited or deleted (there is no such endpoint); an append-only addendum note is allowed; corrections are made with a stock adjustment (approval).

### Shifts (8.5)
`Start shift` snapshots the opening stock of every tracked bar item (liquor in the configured liquor categories + mixers in the tracked categories). `Close shift`: the bartender counts **blind** (managers see expected figures); closing requires a count of every item that had stock or movement; expected closing, variance, sales by measure, complimentary, wastage and breakage are stored. A closed shift cannot be closed again (409) and cannot be edited; `bar.shift.manage` can **correct** counts with a reason (≥10 chars) — the original figures stay in `corrections[].before`, a revision number increments, an audit entry and (if needed) a new alert are written. One live shift per bartender (unique partial index). Shift timings / number of shifts are **not invented**: `Property.settings.bar.shifts.definitions` is empty by default (free-text label); add definitions only when the hotel confirms them.

### Bar billing is NOT decided (PDF: "to be confirmed")
Every `BarOrder` carries `billing: { status: "Pending destination decision", destination: null }`. **Nothing** is posted to a restaurant bill, guest folio or payment, no tax is applied, and the room-number field on an order is a note only. The setting `billing.mode` cannot be set (the API rejects it) until the decision is made and the integration is built. `GET /api/bar/reports/daily-summary` exposes bar sales, complimentary, wastage, breakage, closed shifts and `unbilledOrders` in a stable shape for Phase 12 / 13.

### How to configure (Bar → Settings; permission `bar.configure`)
* **Happy hour**: add a rule (name, days, start/end time in hotel time, past-midnight windows supported, all drinks or selected drinks, *percent off* or *use each drink's happy-hour price*). No rule exists by default; until one is active the normal menu price applies everywhere and the UI says "Happy hour is not configured". The price is calculated on the backend when the order is saved and stored on the line (`basePrice`, `unitPrice`, `happyHour.rule`).
* **Variance**: liquor tolerance (ml), other-items tolerance (units), tolerance (% of expected), alert recipient roles. Empty = provisional behaviour described above.
* **Shifts**, **peg size**, **liquor / tracked categories**, **auto-open bottles**, **allow sales without consumption config**, **require open shift**, **wastage / breakage reasons**, **billing note**.
* **Bar menu**: Bar → Bar menu → *New drink*: choose "poured from bottles" and the liquor item, tick the servings you sell (30 ml / 60 ml / full bottle), set prices (and optionally a happy-hour price), add mixers only if the drink really uses them. *Bottle sizes* sets the capacity of each liquor item.

### Operating guide
1. Receive liquor in Inventory & Stores (Stock In to department `Bar`, unit `bottle`). 2. Bartender **starts a shift**. 3. **Open a bottle** (Bar → Bottle & peg stock) before pouring pegs. 4. Take orders → **Serve**. 5. Free drinks: **Request complimentary** → GM/Owner approves in Approvals → **Issue**. 6. Spills / breakage: Bar manager records them. 7. End of shift: **Count stock & close shift**. 8. Periodically: **Stock count & variance**; open the variance, *Request adjustment* if stock must be corrected.

### New API (`/api/bar`, all authenticated; permission in brackets)
`GET overview` `GET|PUT settings` `GET staff` · menu: `GET menu` `GET menu/:id` `POST menu` `PUT menu/:id` `POST menu/:id/available` (`bar.menu.manage` to change) `GET liquor-items` `PUT liquor-items/:itemId/capacity` · orders: `GET orders` `GET orders/:id` `POST orders` `PUT orders/:id/lines` `POST orders/:id/serve` `POST orders/:id/cancel` (`bar.orders`) · stock: `GET inventory` `GET openings` `POST openings` (`bar.bottles.open`) · variance: `GET variance/expected` `GET|POST variance` `GET variance/:id` `POST variance/:id/lines/:lineId/adjust` `GET variance/alerts` `POST variance/alerts/:id/acknowledge` · complimentary: `GET|POST complimentary` `POST complimentary/:id/issue` `POST complimentary/:id/cancel` · losses: `GET loss-reasons` `GET|POST wastage` `GET|POST breakage` `POST losses/:id/note` · shifts: `GET shifts/current` `GET|POST shifts` `GET shifts/:id` `GET shifts/:id/sheet` `POST shifts/:id/close` `POST shifts/:id/correct` · reports: `GET reports/{liquor-stock,opening-closing,consumption,variance,complimentary,wastage,breakage,shift-closing,daily-summary}`. Query filters (`from`, `to`, `item`, `user`, `status`, `reason`, `onlyVariance`) are validated; an invalid id is a 400.

### New permissions (`bar.*`, assignable per role; defaults follow the PDF "applicable roles" and are editable — the PDF does not define create/edit/delete rights)
`bar.view`, `bar.menu.manage`, `bar.orders`, `bar.bottles.open`, `bar.variance.{view,record,adjust}`, `bar.comp.{view,request,issue}`, `bar.loss.{view,record}`, `bar.shift.{work,manage}`, `bar.reports`, `bar.configure`. Defaults: **Bar Manager** all `bar.*` (+ `approvals.view`); **Bartender** `bar.view`, `bar.orders`, `bar.bottles.open`, `bar.comp.{view,request,issue}`, `bar.shift.work`; **Store Manager** `bar.view` (bottle inventory, view only); **General Manager / Owner** all. Complimentary-drink **approval** is the existing `approvals.approve` permission restricted by the approval rule to General Manager / Owner. Department scope: the `bar` module belongs to department `Bar` (Stores and Accounts may also use it). Permissions are enforced on the backend (tested), not just hidden in the UI.

### New database models
`BarMenuItem`, `BarOpenStock`, `BarOpenLedger`, `BarBottleOpening`, `BarOrder`, `BarComplimentary`, `BarLoss`, `BarReconciliation`, `BarVarianceAlert`, `BarShift` (`server/models/bar.js`; registered in `models/index.js`). `Property.settings.bar` holds the configuration. Counters: `BAR`, `BOP`, `BCM`, `BWS`, `BBK`, `BRC`, `BSH`.

### Migrations / upgrading an existing Phase 7 database
Start the server (or `cd server && npm run seed:phase8`): the migration registers the 16 `bar.*` permissions, adds them to the **default** roles that carry them (additive; custom roles and edits are never touched) and sets the `Complimentary drinks` approval rule to required. `seed:phase8` also creates **demo** data (create-if-missing, never deletes): Bar Manager + 2 Bartender logins, demo liquor items stored in ml (750 ml and 1000 ml bottles), a demo soda and a demo bar menu with **demo prices**. It does **not** configure a happy hour, tolerance, recipients, shifts, mixer quantities or a billing destination. Verified by upgrading a database seeded by the unmodified Phase 7 code (see below). For a fresh database use `npm run seed` (it now also runs Phase 8).

### Phase 8 tests and verification (what was actually run)
* Environment: **real MongoDB 7.0.34 (standalone)**, not FerretDB. Server `npm test` → **137 tests, 137 pass, 0 fail, 0 skipped** (Phases 1–7 regression = 107 tests, + **30 new Phase 8 tests** in `server/tests/phase8.test.js`). The concurrency tests (parallel serve / issue / create / close) ran because the database is a real MongoDB. Run: `cd server && MONGO_URI=mongodb://127.0.0.1:27017/awadh_test npm test` (the DB name must contain `test`; the tests wipe it) or just `node --test tests/phase8.test.js`.
* Phase 8 tests cover: menu create/update/duplicate/validation, per-item capacity, incomplete consumption refusal, unavailable items, normal-price fallback and client-price ignored, happy-hour rules (days, window, end-exclusive, overnight, scope, item price, validation, applied by the backend), bottle opening (no Phase 4 change, idempotent, limits), 30 / 60 / full-bottle deductions on 750 ml and 1000 ml items, "open a bottle first" refusal, auto-open, mixers (configured only), duplicate-request / retry / 8-way concurrent serve / 6-way same-key create, insufficient stock (no partial change, retry after restock), served-order finality, billing untouched (no folio / bill / payment created), permissions and department scope, expected-stock maths vs ledger, variance maths (ml / pegs / bottles), alert de-duplication, tolerance and recipient configuration, adjustment approval and rejection (stock and pool alignment), complimentary pending / rejected / approved-not-issued / issued once / concurrent issue / approver restriction, wastage & breakage (movement types, idempotency, immutability, audit, drink-based, reports separate them), shifts (one per bartender, expected derivation, blind count, close once, concurrent close, other bartender refused, correction with preserved original and audit), reports vs ledger, TBC configuration reporting.
* **Not run / limits:** the UI was verified by a successful **production build** (`cd client && npm run build`) but **not exercised in a real browser** (no browser available here); there are no client unit tests in the project. Multi-document transactions are not used (standalone MongoDB): safety comes from single-document atomic operations and idempotent keys, tested with parallel requests but **not with simulated process crashes**. Not load-tested.
* Upgrade path verified: a database seeded by the original Phase 7 code gained 16 permissions + 56 default-role grants + demo bar data; running the upgrade a second time changed nothing; existing items/users untouched.
* One pre-existing Phase 7 test was made independent of the calendar date (`phase7.test.js`, the chef-performance date window was hard-coded to 25 Oct – 3 Nov 2026 and failed on the unmodified Phase 7 code as soon as the clock passed 3 Nov). No assertion was weakened.

### Known limitations (Phase 8)
* Opened liquor is pooled **per item**, not tracked bottle-by-bottle (a bottle-opening record says which bottles were opened; the remaining ml per physical bottle is not tracked). Peg variance is therefore per item.
* The sealed / opened split exists only in the bar layer. A manual Phase 4 *Stock out* of Bar liquor reduces sealed stock; if it ever exceeds it the inventory screen flags the item (**Check**) and the opened pool is clamped to the total in calculations.
* A served order cannot be edited or cancelled (stock is already used): correct it with a stock adjustment (approval). Complimentary issues cannot be reversed either.
* A stock count snapshots expected stock when it is **recorded**; drinks served while counting is in progress are not reconciled — count when service is paused or use the shift close.
* Bar items use the same IST time zone as the rest of the application; happy-hour prices are decided when the order is saved.
* Tax: none is applied to bar sales (taxes are TBC, Q14). No PDF/WhatsApp export (Phase 15). Alerts are in-app only (channel TBC, Q42).
* Nothing stops a requester who also holds approval rights from approving their own complimentary request (the PDF defines no segregation rule).
* Bartenders can **issue** an approved complimentary drink by default (`bar.comp.issue`); remove it from the role if the hotel wants the Bar Manager to issue.
* Phase 4 liquor items stored in bottles must be re-created (or converted) in ml to use peg tracking.

### Outstanding hotel decisions (all configurable, none invented)
1. **Happy-hour timings and rules** (Q29) — no happy hour is active until configured.
2. **How bar sales are billed** — separate bill, room bill or both (Q28) — nothing is billed or posted; the integration is deliberately not built.
3. **Who receives stock-variance alerts** (Q29) — provisional: everyone with `bar.variance.view` until recipient roles are set.
4. **Stock-variance tolerance** (Q29) — provisional: every difference is reported until a tolerance is set.
5. **Shift definitions and any other operational rules** not in the PDF (number/timing of shifts, whether orders require an open shift, who may issue complimentary drinks, who counts stock, wastage/breakage reason lists, approval value thresholds) — settings / role permissions, defaults are editable demo values.
Also still open from earlier phases and affecting the bar: whether kitchen-style ingredient deduction applies to bar items and mixers (Q28 — mixers are only deducted where you configure them).

## Permissions added
(Phase 8 permissions `bar.*` are listed in the Phase 8 section above.) `inventory.{view,create,edit,delete,move,adjust,stocktake,prices,reports,alerts}`, `housekeeping.{view,work,assign,inspect,stock,reports,performance,configure}` and (Phase 6) `restaurant.{view,tables,reservations,menu,availability,orders,kitchen,billing,payment,void,close,configure}`. New default role: **Supervisor** (view + inspect). Housekeeping Staff = `housekeeping.work` only. Hotel Owner always holds everything. Roles can be edited in Settings → Roles.

## Configuration (all TBC items are settings, not hard-coded)
`Property.settings.inventory`: stock departments, all-access departments, expiry warning days (30), expiry notifications (off). `Property.settings.housekeeping`: checkout / stay-over checklist contents, target minutes (60 / 30 / 60), require full checklist, require photos (off), inspector must differ from cleaner, stay-over needs inspection (off), priority when arrival today. Editable in the app (Units & categories → Rules; Housekeeping settings).

## Photo storage
Photos are never stored in MongoDB. `UPLOAD_DIR` (default `server/uploads`, git-ignored) holds the files and an `Attachment` document holds the metadata. For production use a persistent volume, or add an object-storage driver in `server/services/storage.js` (credentials would live in server environment variables only). Phone photos are shrunk to ~1600 px in the browser first. Uploads need a connection (offline queuing is not built).

## Tests and verification (what was actually run)
`npm run test:server` — **76 tests: 73 passed, 0 failed, 3 skipped** (the 38 Phase 1–5 tests are unchanged and still pass; Phase 6 adds 38: `restaurant-calc.test.js` 9 no-database tests of the money/tax/discount/allocation maths, and `phase6.test.js` 29 API/integration tests). `node --test client/src/utils/restaurantMath.test.js` — 4 passed (the client's cart estimate matches the server's rounding). `npm run build` — client production build + PWA service worker succeeds.
Phase 6 tests cover: permissions and unauthenticated access; table/reservation validation, overlap, capacity, hold window; menu validation, availability, price snapshots; all four order types, idempotent create/send, state-machine rejections, instructions, ticket creation, cancel, void-item, transfer; tax-configurable totals; discount/complimentary approval (pending / rejected / approved-once / self-approval / stale); split-bill reconciliation to the paisa; payments (overpay, duplicate key, partial, completion, table release); room-service validation, posting once, failed-posting recovery, reversal on void, folio/room/stay untouched; daily-closing reconciliation, exceptions, snapshot, duplicate/replay, closed-day rules; crafted payloads (status/price/total fields) ignored.
**Browser check:** a real Chromium run against the real API/UI completed order → kitchen → serve → bill → discount held pending → GM approval → payment → receipt, room service posted to a folio, split bill, reservation, tax settings and the closing screen, plus a 390 px mobile POS and a no-access role, with **no console errors and no failed API calls**. This was a scripted smoke test, not a full UI test suite — the client has no component-test framework (none existed and none was added).
**Honest limits:** no real `mongod` could be installed in the build environment, so everything ran against **FerretDB 1.24 (SQLite)**, a MongoDB-compatible server. FerretDB does not make concurrent conditional updates atomic, so the concurrency tests (the 2 from earlier phases + 1 new Phase 6 test: duplicate parallel orders/sends/payments) are **skipped there and not proven here**; run them against real MongoDB (`MONGO_URI=… npm run test:server`). FerretDB also lacks `$pull` on sub-document arrays, which the code avoids. Nothing was run against a replica set / transactions.

### Defects found in earlier phases and fixed in Phase 6
- **Module settings were never saved.** `Property.settings.inventory` and `.housekeeping` were not declared in the schema, so Mongoose silently dropped them: the inventory/housekeeping *Settings* screens appeared to save but did not persist. They (and `.restaurant`) are now declared; regression test `module settings persist`. Existing databases need no migration (the previous values were never stored).
- **`btn-danger` / `btn-ghost` rendered unstyled** (Tailwind purged the dynamically-built classes). Safelisted in `tailwind.config.js`.

## Limitations / TBC
Phase 6: no kitchen display / stations / recipes (Phase 7) · equal-amount split (only item-based splits) · refunds and voiding paid bills (Phase 12) · delivery dispatch / driver tracking · no reopening of a closed restaurant day · bar billing (Phase 8) · restaurant payments are not yet part of dashboard revenue · 
Supervisor role (who inspects) · checklist contents · target cleaning times · whether expiry raises alerts · supplier/purchase receipts (Phase 7 will call the same stock engine) · maintenance request from damage (Phase 10) · billing of damaged/missing items to guests (not built; no automatic charge) · barcode scanning · photo upload offline queue · push/WhatsApp notifications (in-app only) · mixed-unit stock (everything is kept in the item's base unit).

## TBC items left configurable (not invented)
Approval value thresholds and approver hierarchy · exact role/permission matrix (demo defaults, editable) · identity-document types · payment methods (restaurant: configurable list) · tax rate (0 until set; restaurant taxes: none until set) · cancellation / late-checkout / early check-in rules · repeat-guest matching rule (default: phone) · complaint categories and workflow · booking sources · advance-payment rules · rate factor priority (demo: first matching rule wins) · whether promotional messages are sent (only consent/contact data stored; no WhatsApp/SMS/email integration).

## Notes
- "Revenue" on dashboards = payments received (cash basis) until accounting rules are confirmed. Nightly room charges are posted at check-in; Night Audit is a later phase.
- A confirmed booking marks the room **Reserved** only when arrival is today or earlier, so a future booking does not make the room unsellable today; the calendar reads reservations directly.
- The per-room booking lock is in-process. For multi-instance deployment use a MongoDB replica set with transactions.
- JWT is stored in `localStorage`; fine for an internal tool, but consider httpOnly cookies before exposing publicly.
