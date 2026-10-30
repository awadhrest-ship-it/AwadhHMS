# Awadh Palace Hotel Management System — Phases 1–6

MERN application: **Phase 1** Core System & Access, **Phase 2** Room Management & Pricing, **Phase 3** Guests, Reservations & Front Desk,
**Phase 4** Inventory & Stores, **Phase 5** Housekeeping, **Phase 6** Restaurant, Room Service & POS.
Later phases (kitchen display & recipes, bar, purchase, maintenance, accounts & finance, night audit, banquet) are intentionally **not** built.

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
| Cashier *(Phase 6)* | cashier@awadhpalace.test |

## Routes
`/restaurant /restaurant/pos /restaurant/orders /restaurant/floor /restaurant/menu /restaurant/bills /restaurant/bills/:id /restaurant/approvals /restaurant/closing /restaurant/settings /inventory /inventory/items /inventory/stock /inventory/movements /inventory/stocktakes /inventory/alerts /inventory/setup /housekeeping /housekeeping/my-tasks /housekeeping/tasks/:id /housekeeping/inspections /housekeeping/supplies /housekeeping/reports /housekeeping/performance /housekeeping/settings` plus `/login /dashboard /rooms /rooms/:id /reservations /reservations/new /reservations/:id /guests /guests/:id /check-in /check-out /bills /bills/:id /complaints /complaints/:id /approvals /audit-log /settings/users /settings/roles /settings/property`
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

## Permissions added
`inventory.{view,create,edit,delete,move,adjust,stocktake,prices,reports,alerts}`, `housekeeping.{view,work,assign,inspect,stock,reports,performance,configure}` and (Phase 6) `restaurant.{view,tables,reservations,menu,availability,orders,kitchen,billing,payment,void,close,configure}`. New default role: **Supervisor** (view + inspect). Housekeeping Staff = `housekeeping.work` only. Hotel Owner always holds everything. Roles can be edited in Settings → Roles.

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
