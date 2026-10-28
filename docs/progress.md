# CampusCommons: progress log

The running record of what's built, what was decided and what's left. Read this first when picking up the work. The design itself lives in [`architecture.md`](./architecture.md), [`backend.md`](./backend.md) and [`frontend.md`](./frontend.md).

**Last updated:** 28 Oct 2026. **Branch:** `Aryan`, last pushed commit `549917d`, which is also on `main` up to PR #4.

**Tests:**
- `npm test`: **218 pass**.
- Integration suite against a real MongoDB: **117 pass**, run twice in a row with no flaky failures.

---

## 1. Who owns what

| Person | Area |
|---|---|
| Aryan (this log) | Backend domain core: rules engines, models, Redis, rate limits, AI quota, bookings, sweeper, resources, org units |
| Auth teammate | Registration, OTP, login, tokens, demo login; also input validation (Zod), logging and the seed script |
| Frontend teammates | Home/Explore pages and auth pages (`client/`) |

---

## 2. What's done, in order

| Commit | What |
|---|---|
| `9c2eaa4` | Planning docs: `architecture.md`, `backend.md`, `frontend.md` (MVP first, then cool-to-have features rated by wow factor and difficulty) |
| `ddfb833` | **Rules engines** (12-rule explainable eligibility, booking state machine, IST time helpers) and all **10 Mongoose models**, with tests |
| `d3c5ca6` | **Redis layer:** a client that fails fast when Redis is down, a key catalogue, the double-booking lock (`SET NX PX` + Lua release), and the cache service (cache-aside, version-bump invalidation) |
| `40f25c2` | **Rate limits** keyed by user, email or role (**never IP**), and the **hard AI quota** (atomic Lua: burst / user daily / global per-minute / global daily; fails closed; cache hits are free; circuit breaker on a Gemini 429) |
| `165e492` | **Booking service:** check, create (under the lock), decisions, check-in/out with condition reports, return confirmation and incidents, FIFO waitlist promotion, the audit trail, in-app notifications, the manager queue grouped by conflict, the timeline |
| `cfee83e` | **Cron sweeper** (every 5 min): reminders, no-shows, overdue returns with a delay incident, and expiry of waitlisted **and undecided pending** requests |
| `1844327` | Fixes from the self-review: "waitlist" no longer strands a slot; a return needs an explicit `ok`/`issue` |
| `d09ce60` | Docs updated to match the implementation |
| `e675f91` | Merged `main` (teammate's mock auth + frontend scaffold) |
| `612315c` | Security clean-up: untracked `server/.env`, deleted the committed `cookies.txt` jars, added `.env.example` |
| `b7b49e2` | **Wiring:** `config/db.js` (`strictQuery: "throw"`); `server.js` connects MongoDB → Redis → sweeper, shuts down cleanly on SIGTERM, and mounts routes under `/api/v1`; backend dependencies added |
| `549917d` | **Resource and org-unit services**, built by a 7-agent workflow (see §8): listing, search, detail, availability, the eligibility checklist, manager create/edit/status, the org-unit catalogue, manager assignment |

---

## 3. MVP status (`backend.md` §2.2)

"Service done" means the business logic and tests exist, but there's no HTTP route yet. Routes wait for the validation middleware and real-user auth (§6).

| ID | Feature | Status |
|---|---|---|
| B-01 | Domain-restricted registration + email OTP | ❌ Teammate. Current auth is a mock with in-memory users |
| B-02 | Email-pattern hints | ❌ Not started (the `User.emailHints` field exists) |
| B-03 | ID-card upload + admin verification | ❌ Not started (model fields exist) |
| B-04 | JWT auth + demo login | 🟡 Teammate's mock: login by `username`, demo user id `demo-user-id-001` isn't a database id, refresh tokens kept in memory |
| B-05 | RBAC + unit scope | 🟡 Scope enforced inside the services (`services/access.js`, state-machine relations); route middleware pending |
| B-06 | Zod validation + error envelope | ❌ Teammate. No `validate()` and no error handler yet |
| B-07 | OrgUnits + resource CRUD | ✅ Service done (`orgUnitService`, `resourceService`) |
| B-08 | Search, filters + Redis cache | ✅ Service done |
| B-09 | Badges | ❌ **Next stage** (models exist) |
| B-10 | Explainable eligibility + `/bookings/check` | ✅ Engine + `checkBooking` |
| B-11 | Booking state machine | ✅ |
| B-12 | Double-booking prevention | ✅ (fails closed with 503 if Redis is down) |
| B-13 | Fair-usage caps | ✅ |
| B-14 | FIFO waitlist + promotion | ✅ |
| B-15 | Condition reports | ✅ Service done |
| B-16 | Incidents + human resolution | 🟡 Incidents are created (return issue, overdue); the incident service (comments, resolve → `closeFlagged`) isn't built |
| B-17 | Cron sweeper | ✅ Wired into `server.js` |
| B-18 | Notifications | 🟡 In-app done; email waits for a mailer; no list/read endpoints yet |
| B-19 | Audit log + timeline | ✅ Service done; audit query endpoint pending |
| B-20 | Rate limiting | ✅ Middleware done, **not mounted** yet |
| B-21 | pino logging, request ids, `/health` | ❌ Teammate (`pingRedis()` is ready for `/health`) |
| B-22 | Seed script | ❌ Teammate |

---

## 4. Code map (`server/src`)

| Path | What it does |
|---|---|
| `engines/eligibility.js` | 12 rules → `{ eligible, outcome, results[{ rule, passed, message, fixHint, meta }] }` |
| `engines/stateMachine.js` | `TRANSITIONS`, `canTransition`, `allowedActions`, `isOverdue`, relations (borrower / unitManager / admin / system) |
| `engines/availability.js` | `openWindows`, `busySegments` (no borrower data) |
| `models/*`, `models/enums.js` | Schemas; the audit log is append-only; shared enums |
| `config/redis.js`, `config/db.js` | Redis client (lazy, fails fast) and the MongoDB connection |
| `lib/lock.js`, `lib/redisKeys.js`, `lib/redisRateLimitStore.js`, `lib/log.js`, `lib/serviceError.js`, `lib/time.js` | Infrastructure helpers |
| `middleware/rateLimit.js` | `loginLimiter`, `registerLimiter`, `otpSendLimiter` (two stacked), `otpVerifyLimiter`, `demoLimiter`, `generalLimiter`, `bookingCreateLimiter`, `uploadLimiter` |
| `services/bookingService.js` | `checkBooking`, `createBooking`, `transition`, `checkIn`, `checkOut`, `confirmReturn`, `getBooking`, `listMine`, `listForManager`, `getTimeline` |
| `services/bookingContext.js`, `bookingTransitions.js`, `bookingViews.js`, `waitlistService.js` | Engine inputs; apply + audit + notify; conflict groups and timeline text; promotion |
| `services/resourceService.js` | `listResources`, `getResource`, `getAvailability`, `getEligibility`, `createResource`, `updateResource`, `setResourceStatus`, `listResourceBookings` |
| `services/orgUnitService.js` | `listOrgUnits`, `createOrgUnit`, `updateOrgUnit`, `setOrgUnitManagers` |
| `services/access.js` | `isAdmin`, `managesUnit`, `requireAdmin`, `requireUnitManager` |
| `services/auditService.js`, `notifyService.js`, `cacheService.js`, `aiQuotaService.js` | Cross-cutting services |
| `jobs/sweeper.js` | `runSweep`, `startSweeper`, `stopSweeper` |
| `server.js`, `routes/authRoutes.js`, `middleware/auth.js`, `utils/tokens.js` | **Teammate's files.** Only the startup wiring and the `/api/v1` mount in `server.js` were changed |

The service conventions are the contract for future controllers:
- Services take `req.user.id` and validated input.
- They throw errors carrying `status`, `code`, `details` and `headers`.
- They never return borrower emails or ID-card data.

---

## 5. Decisions that go beyond the original design

All of these are now reflected in `architecture.md` and `backend.md`.

**Bookings and the waitlist**
- **No self-review:** a manager can't approve, reject, waitlist or confirm the return of their own booking.
- **Capacity is the busiest moment of the slot,** not a count of overlapping bookings.
- **Waitlist promotion** moves up everyone who fits, oldest first, and skips `BOOKING_WINDOW` (the request was on time when made). When a manager waitlists a request, promotion skips that request.
- **Undecided pending requests expire** when their slot starts, so they stop counting toward the borrower's active-booking cap.

**Infrastructure**
- **Custom Redis store instead of `rate-limit-redis`:** v6.0.1 never recovers when Redis isn't ready at import time; the fix was a day old.
- **ioredis 5, not 6:** `ioredis-mock` peers on 5.
- **`node:test`** instead of Vitest.
- **`strictQuery: "throw"`; `sanitizeFilter` is off:** `sanitizeFilter` turns `$in`/`$lt` into a `CastError`. Verified on a real MongoDB.

**Resources and org units**
- **Resource list:** members see only `active`. Non-active statuses are for managers of the unit (scoped in the cache key) and admins. `eligibleOnly` filters a shared cached list in memory (capped at 200, flagged in `meta.capped`).
- **Org units:** the unit's code can't change. A duplicate code is 400 `VALIDATION_ERROR`. Manager assignment re-syncs users on every call, so a half-finished change is repaired by calling it again.
- **Unknown user id → 404 `NOT_FOUND`**, the same as the booking service. The auth teammate may prefer 401; that's open.

---

## 6. Gaps the teammates need to close (from the integration review)

1. **Auth:**
   - Use real MongoDB users and log in by **email**.
   - Put the user's `_id` in the token (exposed as `req.user.id`) together with `roles`.
   - Add `register`, `verify-otp`, `resend-otp` and `demo-config`, and demo login by role.
   - Keep the refresh `jti` in Redis (`keys.refreshToken`).
2. **`verifyAuth`** must answer 401 with `code: "UNAUTHENTICATED"`. Without that, the client never refreshes an expired token.
3. **One response envelope:** `client/src/lib/http.js` reads `data.code` at the top level, `architecture.md` §6 nests it under `data.error`, and the auth routes return `{ error: "…" }`. Agree on one shape and make all three match.
4. **Error handler:** none exists, and Express 5's default sends HTML. It must send `err.status`, `code`, `details` and `headers`. It should map ZodError to 400 and CastError to 400.
5. **Validators:**
   - On Express 5, `req.query` can't be reassigned, so store parsed values another way (e.g. `req.validated`).
   - Resource schemas must reject `null` array items and dotted keys.
   - Parse `includeInactive` strictly: `z.coerce.boolean()` turns `"false"` into `true`.
6. **Routes and controllers** for `/api/v1/resources`, `/org-units` and `/bookings`. Mount `generalLimiter` after auth, and the auth-tier limiters after validation.
7. **Request-id middleware,** for the audit log and the envelope.
8. **Admin user-role route:** writing `managedOrgUnits` directly must go through `setOrgUnitManagers`.
9. **Seed script:** NIT JSR units, badges, sample resources and the demo users (`backend.md` §9).

---

## 7. Running it

**Environment** (see `server/.env.example`):

| Variable | Required? | Notes |
|---|---|---|
| `MONGODB_URI` | **Yes**: the server refuses to start without it | Include the database name in the path |
| `REDIS_URL` | Yes | Upstash `rediss://…` TCP URL |
| `PORT`, `CLIENT_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | Yes | — |
| `CRON_ENABLED` | Optional | — |
| `AI_*` | Optional | Only once AI features exist |

**Commands:**
```
cd server
npm install
npm run dev                     # or npm start
npm test                        # unit tests; integration suites skip themselves
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 node --test test/integration   # use a local/test DB, never production
```

Not yet tested against the real Upstash and Atlas. The first `npm run dev` should log "MongoDB connected", "Redis connected" and "Sweeper started".

---

## 8. How the resource stage was built (multi-agent workflow)

Seven agents, sharing one throwaway `mongod`:

| Phase | Agents | Result |
|---|---|---|
| Build | shared helpers, then resources and org units in parallel | 12 files |
| Review | security, backend, integration | **20 findings**: 3 high, 2 medium, 15 low |
| Fix | one fixer that reproduced each finding first | 16 fixed (each with a regression test), 2 duplicates, 2 deferred (secrets in history; 404 vs 401) |

The fixer also ran **34 mutation checks**, and a test caught every one.

The high-severity fixes:
- `null` entries could be saved into a resource's opening hours;
- a manager-assignment change that failed halfway couldn't be repaired by retrying.

---

## 9. Security status

- 🔴 **The repo is public, and old commits contain `server/.env` (JWT secrets) and `server/cookies.txt` (a refresh token).** They're untracked now, but **the secrets must be replaced** wherever the app runs. The `yuvraj` branch still contains both files: delete or clean up that branch. Purging the history is optional once the secrets are replaced.
- ✅ `.env` and `cookies.txt` are git-ignored, and `.env.example` has placeholders only.
- ✅ Rate limits never use IP; no PII is sent to Gemini (by design); managers never see borrower emails or ID cards; availability exposes no borrower data.

---

## 10. Known loose ends

- `client/package-lock.json` has an uncommitted change (78 `libc` lines removed) from someone's `npm install` during the resource work. It's not part of the backend work; commit it or discard it (`git checkout client/package-lock.json`).
- Email notifications wait for the mailer (B-18).
- No database transactions: a failed audit write after a booking insert leaves a booking without its first audit entry (the request returns 500).
- Doc wording still open: 404 vs 401 for an unknown signed-in user.

---

## 11. Next steps (resume here)

1. **Badge service** (B-09): catalogue, `/badges/mine`, request with optional evidence, the manager queue, approve/reject, direct grant. It's the last backend piece the judges' demo needs (a student requests a badge, a manager grants it).
2. **Incident service** (B-16): list, detail, comments, resolve. Resolving a booking's incident calls `transition(…, "closeFlagged", SYSTEM)`.
3. **Notifications and audit read endpoints** (list, mark read, audit query).
4. **Routes and controllers** for everything above, once the validators and auth middleware land.
5. **Golden-path check** against the deployed app with the seeded demo users (`frontend.md` §11).
