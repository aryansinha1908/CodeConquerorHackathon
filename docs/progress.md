# CampusCommons: progress log

The running record of what's built, what was decided and what's left. Read this first when picking up the work. The design itself lives in [`architecture.md`](./architecture.md), [`backend.md`](./backend.md) and [`frontend.md`](./frontend.md).

**Last updated:** 29 Oct 2026. **Branch:** `Aryan`, last pushed commit `9294dac` (the badge service). `main` has everything up to `549917d` through PR #4. The incident service (§2, last row) is in the working tree, **not yet committed**.

**Tests:**
- `npm test`: **219 pass**.
- Integration suite against a real MongoDB: **168 pass** (30 for badges, 21 for incidents), run twice in a row with no flaky failures.

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
| `9294dac` | **Badge service** (B-09): catalogue, create, `/badges/mine`, request with evidence, the manager queue, approve/reject, direct grant, with tests for the judges' golden path and for races. A mutation check broke 23 guards on purpose, and a test failed for every one |
| _uncommitted_ | **Incident service** (B-16): report, list, detail, comments, resolve; resolving the last open incident of a flagged booking closes it. Mutation check: 30 guards broken on purpose, 29 caught. The survivor only drops a projection that keeps comment text out of list reads, which nothing can observe |

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
| B-09 | Badges | ✅ Service done (`badgeService`) |
| B-10 | Explainable eligibility + `/bookings/check` | ✅ Engine + `checkBooking` |
| B-11 | Booking state machine | ✅ |
| B-12 | Double-booking prevention | ✅ (fails closed with 503 if Redis is down) |
| B-13 | Fair-usage caps | ✅ |
| B-14 | FIFO waitlist + promotion | ✅ |
| B-15 | Condition reports | ✅ Service done |
| B-16 | Incidents + human resolution | ✅ Service done (`incidentService`) |
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
| `services/incidentService.js` | `createIncident`, `listIncidents`, `getIncident`, `addComment`, `resolveIncident` |
| `services/badgeService.js` | `listBadges`, `createBadge`, `listMyBadges`, `requestBadge`, `listBadgeRequests`, `decideBadgeRequest`, `grantBadge`, `badgeState` |
| `services/access.js` | `isAdmin`, `managesUnit`, `requireAdmin`, `requireUnitManager`, `auditRole` (moved here from `resourceService`) |
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

**Badges**
- **One row per user and badge.** A member can ask again after a rejection, a revocation or an expiry; the row goes back to `requested`, and the old decision is cleared from it (the audit log keeps it). Asking again while a request is open, or while the badge is still valid, is 409 `INVALID_TRANSITION`. A new `requestedAt` field drives the FIFO queue.
- **"Expired" is never stored.** `badgeState()` works it out with the same test as the eligibility engine's `BADGES` rule.
- **No self-review here either:** a manager can't decide on their own badge request or grant themselves a badge. An admin can, as with bookings.
- **A direct grant** makes any row active and also **renews** a badge that is still valid. Granting a badge that never expires to someone who already holds it changes nothing and isn't audited. The member's own note is kept; the manager's note goes into the audit entry's `reason`.
- **Requesting needs an approved ID card** (checked in the service; that is what "verified" means for the route). Suspension is left to the route middleware.
- **Badges of an inactive unit** aren't listed and can't be requested (409).
- **`selfServe` can't be set through `createBadge`** until the quiz (C-13) exists; the seed sets it directly.
- **The catalogue cache stores issuer ids.** Names are joined from `cache:orgunits` when the list is read, so renaming a unit needs no badge invalidation.
- **New notification `badge.requested`** goes to the issuing unit's managers (not the requester), linking to `/manage/badges`. Granted and rejected notices go to the member; the granted notice includes the expiry date with its year (`formatIstFullDate`).
- **Concurrency:** request and decide are conditional on the row's `updatedAt` as read, so a grant that lands mid-request isn't undone, and a stale decision on a request the member replaced gets a 409. A direct grant is a single upsert.

**Incidents**
- **`createIncident` is included** (`POST /incidents`, B-16 "created by the member"), though the plan only listed list, detail, comments and resolve.
- **Who reports:** the borrower, on an `approved`, `checked_in`, `checked_out`, `completed` or `flagged` booking, up to 7 days after it ends. The unit's managers (or an admin) with no time limit, and also without a booking. Reporting never changes the booking's status; only `confirm-return` with an issue flags it. Unknown fields (`source`, `status`, …) are refused.
- **Who sees and comments:** the booking's borrower, the reporter, the unit's managers and admins. A member's list holds what they reported plus everything on their bookings, the sweeper's delay incidents included; a manager's adds their units'.
- **`open` → `in_review`** on the first comment by a manager or admin. A resolved incident's thread is closed (409), and a thread holds at most 200 comments.
- **Who resolves:** the unit's managers for low and medium severity, admins for any. Nobody but an admin resolves an incident on their own booking. `outcome` and `rationale` are both required.
- **`strike`** needs a booking, and adds one to its borrower's `User.strikes`, which nothing acts on yet (C-09 only ever *suggests* a suspension).
- **Closing:** resolving the **last** unresolved incident of a `flagged` booking runs `closeFlagged` as the system. A booking with two incidents stays flagged until both are resolved. If closing fails after the incident is resolved, resolving again answers 409 but closes the booking first.
- **Notifications:** `incident.created`, `incident.commented` and `incident.resolved` go to everyone involved but the person acting: borrower and reporter (member links), the unit's managers, and admins when severity is high. `closeFlagged` no longer sends `booking.completed` ("Thank you!" read oddly after a strike); `incident.resolved` adds "The booking is now closed."
- **Timeline:** `/bookings/:id/timeline` now has an `event: "resolved"` item with the outcome next to each incident's `opened` item.
- **Audit actions:** `incident.created`, `incident.commented` (with the `open → in_review` change when it happens) and `incident.resolved` (rationale as `reason`, outcome and any new strike count in `meta`).

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
9. **Seed script:** NIT JSR units, badges, sample resources and the demo users (`backend.md` §9). Writes that bypass the services leave `cache:badges` and `cache:orgunits` stale for up to 10 minutes, so flush them after seeding.
10. **Badge and incident validators:** the per-route rules are in `backend.md` §7 (`badges.*`, `badgeRequests.*`, `incidents.create`, `incidents.list`, `incidents.comment`, `incidents.resolve`).

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

- Email notifications wait for the mailer (B-18).
- No database transactions: a failed audit write after a booking insert leaves a booking without its first audit entry (the request returns 500).
- Doc wording still open: 404 vs 401 for an unknown signed-in user.
- **Badge evidence upload:** the controller must upload the file (`uploadService`, not built yet) before it calls `requestBadge`, so an upload for a request the service then refuses is left orphaned in Cloudinary. Either check first with a cheap read, or delete the asset on a refusal.
- **Incident strikes aren't transactional either:** a failed strike increment after the incident is resolved leaves the strike uncounted, and a retry only answers 409.
- **Incident photos** come from the upload service (not built), like badge evidence.
- **Shared parameter helpers:** `resourceService`, `badgeService` and `incidentService` each carry their own copies of `requireUser`, `readPaging`, `readEnum` and friends. Worth pulling into one module before the controllers land.
- **No badge revoke action yet.** The `revoked` status is supported everywhere it's read, but nothing sets it. It isn't in the route table either.

---

## 11. Next steps (resume here)

1. **Notifications and audit read endpoints** (list, mark read, audit query).
2. **Routes and controllers** for everything above, badges and incidents, once the validators and auth middleware land.
3. **Golden-path check** against the deployed app with the seeded demo users (`frontend.md` §11).
