# Awadh Palace Hotel Management System — Phases 1–3

MERN application: **Phase 1** Core System & Access, **Phase 2** Room Management & Pricing, **Phase 3** Guests, Reservations & Front Desk.
Later phases (inventory, housekeeping, restaurant, kitchen, bar, purchase, maintenance, accounts, night audit, banquet) are intentionally **not** built.

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
npm run seed                     # WARNING: wipes and re-seeds the HMS collections
npm run dev                      # API on :5000, web app on :5173
```
Separately: `npm run dev:server`, `npm run dev:client`. Production client: `npm run build` (output `client/dist`).
Tests (need a reachable MongoDB; they re-seed the DB in `MONGO_URI`, default `awadh_test`): `MONGO_URI=mongodb://127.0.0.1:27017/awadh_test npm run test:server`.

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

## Routes
`/login /dashboard /rooms /rooms/:id /reservations /reservations/new /reservations/:id /guests /guests/:id /check-in /check-out /bills /bills/:id /complaints /complaints/:id /approvals /audit-log /settings/users /settings/roles /settings/property`
API is under `/api` (auth, users, roles, permissions, property, rooms, room-categories, rate-plans, guests, reservations, bills, complaints, approvals, audit-logs, notifications, dashboard).

## Implemented
**Phase 1** — property setup; JWT login/logout/me; per-employee accounts; roles + permission catalogue (view/create/edit/delete/approve per module); custom roles (cannot grant permissions you don't hold); department restriction enforced in middleware; reusable approval framework (cancellation + price change wired end-to-end); audit trail with old/new values and IP/device; in-app notification centre; DB-driven dashboards.
**Phase 2** — room categories and rooms (floors, amenities, photo links, capacity, extra-bed charge); the ten required statuses; grid with floor/type/status filters + search; room drawer with history; block/unblock/out-of-order/restore (reason required, audited); 7-day availability calendar; configurable rate plans (7 types, rules by weekday, dates, nights, guests, client, source) with price quoting.
**Phase 3** — guests (VIP, blacklist, marketing consent + channel preferences as data only, corporate/agent profiles, ID-document metadata, preferences, repeat-guest detection); 6-step reservation wizard; server-side double-booking prevention (overlap check + per-room lock); edit with re-validation; cancellation and price change via approval; check-in (verification, room assignment, folio charges, room → Occupied); check-out (balance check, room → Vacant & Dirty, `checkout.completed` event); guest folio with payments and outstanding balance; complaints (register, filter, resolve, shown in guest history and dashboard).

## TBC items left configurable (not invented)
Approval value thresholds and approver hierarchy · exact role/permission matrix (demo defaults, editable) · identity-document types · payment methods · tax rate (0 until set) · cancellation / late-checkout / early check-in rules · repeat-guest matching rule (default: phone) · complaint categories and workflow · booking sources · advance-payment rules · rate factor priority (demo: first matching rule wins) · whether promotional messages are sent (only consent/contact data stored; no WhatsApp/SMS/email integration).

## Notes
- "Revenue" on dashboards = payments received (cash basis) until accounting rules are confirmed. Nightly room charges are posted at check-in; Night Audit is a later phase.
- A confirmed booking marks the room **Reserved** only when arrival is today or earlier, so a future booking does not make the room unsellable today; the calendar reads reservations directly.
- The per-room booking lock is in-process. For multi-instance deployment use a MongoDB replica set with transactions.
- JWT is stored in `localStorage`; fine for an internal tool, but consider httpOnly cookies before exposing publicly.
