# CampusCommons: progress log

The running record of what's built, what was decided and what's left. Read this first when picking up the work. The design itself lives in [`architecture.md`](./architecture.md), [`backend.md`](./backend.md) and [`frontend.md`](./frontend.md).

**Last updated:** 29 Oct 2026. **Branch:** `Aryan`. `main` has everything through PR #11 (`a78df37`, the frontend layouts). **The frontend and backend are integrated**: all five phases (§11), the local-setup fixes (`b9005b3`) and the UI fixes from the first review (§11, step 6) are committed locally on `Aryan` and **not pushed** (`origin/Aryan` is still at `4533665`). The judge script passes end to end (`npm run golden-path`).

**Resume here:** §11's "Open" list, after fixing the local setup below.

**Team change:** the auth teammate has stopped; the frontend teammate is doing `/badges` and one more page (to be confirmed). Everything else is integration work on `Aryan`.

**Tests:**
- `npm test` (`node --test`, every file): **245 pass**. The integration suites skip themselves without `TEST_MONGODB_URI`.
- With a real MongoDB: **423 pass** (178 of them integration), run twice in a row with no flaky failures.

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
| `46da3d6` | **Incident service** (B-16): report, list, detail, comments, resolve; resolving the last open incident of a flagged booking closes it. Mutation check: 30 guards broken on purpose, 29 caught. The survivor only drops a projection that keeps comment text out of list reads, which nothing can observe |
| `a81ae2f` | (Teammate, PR #6) **pino logging:** `lib/logger.js` with redaction, `X-Request-Id`, the HTTP log, `app.js` split from `server.js`, graceful shutdown, a first error handler |
| `6d62cf3` | **Post-merge review fixes** (PR #8): the server crashed at boot (`setRedisLogger` ReferenceError in `connectRedis`, reached once `server.js` passed a logger); `npm test` ran 7 of 226 tests; `.gitignore` only ignored `server/.env`; the error handler dropped `code`, `details` and `headers` and turned every 400 into "Invalid request"; `verifyAuth` had no `UNAUTHENTICATED` code; `/health` said ok with MongoDB down; the request log's route was always "[unmatched route]" |
| `1a59fed` | **Notification and audit reads** (B-18, B-19, PR #9): `listNotifications` (with the unread count in `meta`), `unreadCount`, `markRead`, `markAllRead`, and `listAudit` scoped by role; `services/params.js` for shared input checks. Mutation check: 19 guards broken on purpose, all caught |
| _uncommitted_ | **One set of input checks:** the resource, badge, incident, booking and org-unit services use `services/params.js` and `fieldError` / `conflict` from `lib/serviceError.js` instead of their own copies (264 lines fewer in those five services, 194 fewer in `src/` overall). Behaviour is unchanged except in the booking service: its `requireUser` now checks the id, so the mock auth's `"demo-user-id-001"` is 404 instead of a CastError, and `listMine` / `listForManager` now check `status`, `resourceId`, `from`, `to` and paging (limit capped at 50) like the other list functions. Re-ran the earlier mutation checks (same results) plus 11 on the shared helpers, all caught |

---

## 3. MVP status (`backend.md` §2.2)

"Service done" means the business logic and tests exist, but there's no HTTP route yet. Routes wait for the validation middleware and real-user auth (§6).

| ID | Feature | Status |
|---|---|---|
| B-01 | Domain-restricted registration + email OTP | ✅ Phase 1: `authService` + `authOtp` (peppered sha256 in Redis, 10 min, 5 tries), nodemailer (`config/mailer.js`), sign-up proof cookie |
| B-02 | Email-pattern hints | ✅ Phase 1: `emailHints()` fills `User.emailHints` on register |
| B-03 | ID-card upload + admin verification | ✅ Phase 2: `uploadService` (type from the bytes, 5 MB, private delivery for ID cards and evidence), `verificationService`, `/verification/*` and `/admin/verifications/*`, the member and admin pages |
| B-04 | JWT auth + demo login | ✅ Phase 1: login by email, access token with the §7.1 claims, refresh-token families in Redis with rotation and per-family reuse detection, demo login gated by `DEMO_MODE`. The mock is deleted |
| B-05 | RBAC + unit scope | 🟡 Scope enforced inside the services (`services/access.js`, state-machine relations); route middleware pending |
| B-06 | Zod validation + error envelope | 🟡 The error handler sends the `architecture.md` §6 envelope (ZodError, CastError, ValidationError, E11000 and body-parser errors mapped). No `validate()` or Zod schemas yet (teammate) |
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
| B-18 | Notifications | 🟡 In-app sending and reading done (list, unread count, mark read, read all); email waits for a mailer |
| B-19 | Audit log + timeline | ✅ Service done, including the audit query (`listAudit`) |
| B-20 | Rate limiting | ✅ Middleware done, **not mounted** yet |
| B-21 | pino logging, request ids, `/health` | ✅ Teammate's pino logger, request ids and HTTP log (PR #6); `/health` reports MongoDB and Redis as `architecture.md` §13.3 says |
| B-22 | Seed script | ✅ `npm run seed`: 18 units, 7 badges, 13 resources, 6 demo users, manager assignment, 16 demo bookings in every state (through the services, with their reports, incidents, audit and notifications), cache flush; idempotent. Needs Redis for the bookings |

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
| `services/params.js` | Shared input checks used by every service: `isId`, `absent`, `isPlainObject`, `sameId`, `assertValid`, `readId`, `readEnum`, `readEnumList`, `readText`, `readFlag`, `readMatch`, `readInstant`, `readPaging`, `requireUser`. Checks only one service needs (`readWeekday`, `readEvidence`, `readPhotos`) stay in that service |
| `lib/serviceError.js` | `ServiceError`, `notFound`, `forbidden`, `invalid`, `fieldError`, `conflict` (409 `INVALID_TRANSITION`), `fromValidationError` |
| `services/incidentService.js` | `createIncident`, `listIncidents`, `getIncident`, `addComment`, `resolveIncident` |
| `services/badgeService.js` | `listBadges`, `createBadge`, `listMyBadges`, `requestBadge`, `listBadgeRequests`, `decideBadgeRequest`, `grantBadge`, `badgeState` |
| `services/access.js` | `isAdmin`, `managesUnit`, `requireAdmin`, `requireUnitManager`, `auditRole` (moved here from `resourceService`) |
| `services/auditService.js` | `record`, `listAudit` |
| `services/notifyService.js` | `send`, `render`; `listNotifications`, `unreadCount`, `markRead`, `markAllRead` |
| `services/cacheService.js`, `aiQuotaService.js` | Cross-cutting services |
| `jobs/sweeper.js` | `runSweep`, `startSweeper`, `stopSweeper` |
| `server.js`, `app.js` | Startup and shutdown; the Express app (request id, HTTP log, JSON, cookies, CORS, routes, `/health`, 404, error handler) without a listener, so tests can mount it |
| `lib/logger.js`, `middleware/requestLogger.js`, `middleware/httpLogger.js`, `middleware/errorHandler.js` | pino with redaction; `X-Request-Id`; one log record per request with the matched route; the error envelope |
| `routes/authRoutes.js`, `middleware/auth.js`, `utils/tokens.js` | **Teammate's mock auth.** `verifyAuth` now answers 401 `UNAUTHENTICATED` through the error handler |

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

**Notifications and the audit log**
- **Each user reads only their own notifications.** Someone else's id is 404, the same as one that doesn't exist. Marking a notification read again keeps its first `readAt`. Reads aren't audited.
- **`unreadCount` does no user lookup:** every open tab polls it every 30 s, so it's one count on a new `{ user, readAt }` index. An unknown id just has 0; a malformed one is 404.
- **`listNotifications` returns `meta.unread`** whatever the filter, so the centre can update the bell without a second request.
- **`listAudit`:** admins read everything; a manager reads only entries whose `orgUnit` they manage (their role is checked too, as in `access.js`). Entries with no unit, such as user and verification events, are therefore admin-only. Members get 403 pointing them to the booking timeline, as in `architecture.md` §7.2.
- **Audit filters:** `entityType`, `entityId`, `actorId`, `action` (exact), `orgUnit` (added, for managers of several units), and `from` / `to` as `[from, to)` on `at`; newest first. Actors come with their name only; `prevHash` / `hash` (C-02) stay out.

---


## 6. Gaps the teammates need to close (from the integration review)

1. **Auth:**
   - Use real MongoDB users and log in by **email**.
   - Put the user's `_id` in the token (exposed as `req.user.id`) together with `roles`.
   - Add `register`, `verify-otp`, `resend-otp` and `demo-config`, and demo login by role.
   - Keep the refresh `jti` in Redis (`keys.refreshToken`).
2. ~~`verifyAuth` must answer 401 `UNAUTHENTICATED`~~ ✅ done in the post-merge review.
3. **One response envelope:** ✅ the error handler and `client/src/lib/http.js` now use the `architecture.md` §6 shape. Still open: the mock auth routes answer `{ error: "…", requestId }` inline. Pass errors to `next()` as `ServiceError`s in the rewrite; the client reads both shapes until then. A failed login needs a code that **isn't** `UNAUTHENTICATED`, or the client would try a token refresh on the login page.
4. ~~Error handler~~ ✅ done: `middleware/errorHandler.js`.
5. **Validators:**
   - On Express 5, `req.query` can't be reassigned, so store parsed values another way (e.g. `req.validated`).
   - Resource schemas must reject `null` array items and dotted keys.
   - Parse `includeInactive` strictly: `z.coerce.boolean()` turns `"false"` into `true`.
6. **Routes and controllers** for `/api/v1/resources`, `/org-units` and `/bookings`. Mount `generalLimiter` after auth, and the auth-tier limiters after validation.
7. ~~Request-id middleware~~ ✅ (PR #6). Controllers pass `{ requestId: req.id }` to the services, which put it in the audit log.
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
| `PORT`, `CLIENT_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `OTP_PEPPER` | Yes | — |
| `SEED_PASSWORD` | For `npm run seed` | The demo users' password |
| `DEMO_MODE`, `ALLOWED_EMAIL_DOMAINS` | Optional | `DEMO_MODE=true` enables the demo buttons; domains default to `nitjsr.ac.in` |
| `SMTP_*`, `MAIL_FROM` | For real email | Without `SMTP_HOST`, emails (OTPs included) are logged to the console outside production |
| `CLOUDINARY_*` | From Phase 2 | ID cards, badge evidence and photos |
| `CRON_ENABLED` | Optional | — |
| `AI_*` | Optional | Only once AI features exist |

**Commands:**
```
cd server
npm install
npm run seed                    # demo data; idempotent (needs SEED_PASSWORD)
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
- **No badge revoke action yet.** The `revoked` status is supported everywhere it's read, but nothing sets it. It isn't in the route table either.

---

## 7b. Local setup status (29 Oct 2026)

The first `npm run dev` against your own `server/.env` showed three problems:
1. **`MongoDB connected db: "test"`:** `MONGODB_URI` has no database name in its path. Add `/campuscommons` before the `?`, or the seed and all data land in `test`.
2. **`ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET are the same`:** generate two different values, plus `OTP_PEPPER`, with `node -e 'for (let i = 0; i < 3; i++) console.log(require("crypto").randomBytes(48).toString("base64url"))'`. Never reuse values from old commits.
3. **Redis `connect ETIMEDOUT`** against a Redis Cloud (redis.io) database. **Diagnosed: the network, not the config.** DNS resolves, but TCP to port 15363 times out. `portquiz.net` (which listens on every port) also times out on 15363, 15000 and 6379, while 80 and 443 connect. So this Wi-Fi blocks every outgoing port except web ports. For development, use a local Redis (`sudo docker run -d --name redis --restart unless-stopped -p 127.0.0.1:6379:6379 redis:7`, bound to localhost because it has no password, then `REDIS_URL=redis://127.0.0.1:6379`) or a phone hotspot. Keep Redis Cloud for Render. Whether its URL needs `redis://` or `rediss://` is still unknown: run `npm run check:redis` once from a hotspot. To re-check, run `cd server && npm run check:redis`. It prints the scheme, port and host suffix (never the password), then tests DNS, TCP and TLS separately and says what to change:
   - **TCP timeout:** the network blocks the port, or the port is wrong. Redis Cloud's port is the database's own 5-digit one. Campus Wi-Fi often blocks it; try a hotspot. If that's the cause, use a local Redis for development and keep Redis Cloud for Render.
   - **TLS result:** it tells you whether the URL should be `redis://` or `rediss://`.

4. **`listen EADDRINUSE :::5000`:** another `npm run dev` is still running, in another terminal. Stop that one, or keep using it (`node --watch` restarts it on every change). That failed start used to log "HTTP server listening" (Express 5 also calls the `listen` callback on an error) and to close MongoDB and Redis under the boot sweep. Now the sweeper starts only once the server is listening, and `stopSweeper()` waits for a sweep in progress, which also covers a deploy restart on Render.

**Redis Cloud instead of Upstash** works with no code change. The server uses Lua scripts and `SCAN`, which Redis Cloud's `default` user can run. The URL is `redis://default:<password>@<host>:<port>` (`rediss://` if TLS is on). Put the database near Render (AWS `ap-southeast-1` or `ap-south-1`). `docs/deploy.md` §2 and a comment in `render.yaml` still describe Upstash.

**Environment variables:** the server's are all in `server/.env.example`, with comments; `render.yaml` lists them for Render. In production, the server refuses to boot without `MONGODB_URI`, `REDIS_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `OTP_PEPPER` and `CLIENT_URL`, and each of the three secrets must be at least 32 characters. On Render, set `TRUST_PROXY_HOPS=2`, and use Brevo SMTP on port 2525 (the free plan blocks 25, 465 and 587). **The client has no environment variables:** the only setting is the `/api` rewrite destination in `client/vercel.json`, which you replace with the Render URL.

---

## 11. Next steps (resume here): the integration plan

The goal is the judge script (`frontend.md` §11) working on localhost with real data and no mocks, then deployed. Each phase runs as one multi-agent workflow: builders on separate files, then backend, security, contract (and, for client phases, frontend and design) reviewers on the combined diff, then fixers who reproduce each finding before fixing it, then the test gate.

1. ✅ **Phase 1: real auth and the seed script.** 21 review findings: 15 fixed, 4 duplicates, 2 deferred (below). 515 server tests, plus 6 new client tests.
2. ✅ **Phase 2: uploads (Cloudinary) and ID verification**, server and client, plus `/admin/verifications`. 23 review findings: 18 fixed, 4 duplicates, 1 needed a client change (made). 573 server tests and 44 client tests. Real Cloudinary isn't exercised yet: the keys go in `server/.env`.
3. ✅ **Phase 3: domain routers** over the existing services: org units, resources, badges and badge requests, bookings, incidents, notifications, audit. Every route is `verifyAuth` → `generalLimiter` (→ `blockSuspended` on writes), with thin controllers and route tests over HTTP. 21 review findings: 13 fixed (among them reasons over 500 characters skipping the audit, confirm-return leaving orphans, 500s on malformed checklist items, look-alike photo URLs from other Cloudinary accounts), 6 duplicates, 2 deferred (below). 649 server tests. The full API reference is `docs/api.md`.

   **Deferred to Phase 4 (new endpoints):** a route for managers to open badge evidence (a 5-minute signed URL, like the ID-card viewer), and a user lookup (`GET /admin/users`) for manager assignment and direct badge grants. Also open: resource `images` on the listing form aren't run through the own-photo check yet.

   **Found while writing `docs/api.md` (server fixes for Phase 4b):** `joinWaitlist` is truthy-checked, so `"false"` joins the waitlist; `purpose` is only checked by the model, after eligibility; the login limiter also counts `403 EMAIL_NOT_VERIFIED`, locking out unverified users who typed the right password; the manager's pending queue is silently capped at 500; `/bookings/check` and `POST /bookings` don't hide archived resources from non-managers.

   **Decision needed: the demo admin's reach.** While `DEMO_MODE=true`, anyone can sign in as the seeded admin, and only the verification queue limits that account to demo users. Everywhere else (audit, the manager queue, incidents, badge requests, every admin write) it is a full admin. On a deployment that real students also use, that exposes their bookings, incidents and names. Options: (a) keep the demo deployment demo-only (`DEMO_MODE` off wherever real students sign up), or (b) scope demo staff accounts to demo data across every service.
4. ✅ **Phase 4: the client on real data.**
   - ✅ **4a:** shared kit (StatusBadge, Dialog, ReasonDialog, ConfirmDialog, ErrorState, Pagination, PhotoUploader, BookingTimeline, IST helpers in `lib/time.js`), the bookings API module and hooks; Explore, resource detail with the server's eligibility checklist, QuotaMeter, AvailabilityGrid and the BookingPanel; My bookings, booking detail, check-in and check-out; the manager's conflict queue, handovers and return confirmation. Mock data deleted. 21 review findings (all client): 17 fixed, 4 duplicates. 191 client tests; the client's API modules were also run against the real server on a seeded database.
   - ✅ **4b:** incident pages (report, detail with thread and resolve, manage and admin lists), `/admin/audit` with deep links, `/manage/resources` and the full listing form, notifications and the header bell, the manage dashboard, and `/manage/badges` (in its own files, in case the teammate's version replaces it). Server: the six fixes found while writing `docs/api.md`, the badge-evidence viewer, grant by email, `GET /admin/users`, and demo accounts kept away from real members' evidence and grants. 16 seeded demo bookings in every state, made through the services. 22 review findings: 19 fixed, 3 duplicates. 693 server tests, 299 client tests.
   - **`npm run golden-path -- <api url>`** walks judge steps 1–12 over HTTP with the demo logins and cleans up after itself. It passes all 12 steps on a fresh seed. Afterwards the demo student holds 3D Printing Basics, so run `npm run seed` again before a real demo.
5. ✅ **Phase 5: hardening and deploy prep.**
   - **Client:** vendor chunks and lazy loading (no chunk over 500 kB), the Dashboard tab, the `/admin` redirect, edit and report links on the resource page, contrast fixes; `frontend.md` §8.2 rewritten from the real query keys.
   - **Server:** `trust proxy`, start-up checks (production refuses to boot without its secrets), coarse per-IP ceilings stacked on the email and role limits, a daily OTP-email cap with a per-network share, and a boot warning when `DEMO_MODE` is on and real accounts exist.
   - **Deploy:** `render.yaml`, `client/vercel.json` (SPA fallback, `/api` rewrite, CSP and security headers), `docs/deploy.md` (step-by-step checklist, including the secret rotation), and a real `README.md`.
   - **Review:** 10 findings (1 high: with one trusted hop, everyone behind Vercel shared one IP bucket), 7 fixed, 2 duplicates, 2 deferred (below).
   - **Tests:** 738 server tests and 308 client tests; the golden path passes 12/12 after the hardening.
6. ✅ **UI fixes from the first review of the running app** (client only).
   - **Navbar:** Explore, Bookings, Badges and Manage (managers), from `lg`; the hamburger below. The name at the right opens the new account menu (`components/UserMenu.jsx`, lazy like the bell): Profile, ID verification, Admin console (admins), Log out. Logout moved to `features/auth/useLogout.js`.
   - **`/profile`** (`features/profile/`): details, verification, my badges (`GET /badges/mine` under `['badges', 'mine']`), strikes and suspension, console links. It re-reads `GET /auth/me` on opening.
   - **Fixes:**
     - The bell's "See all" was white on white: `cn()` only joins strings, so `bg-white` and the green were on one element. Each footer action now has one background.
     - Explore's filter box grew when a filter came on: "Clear filters" is now always rendered (hidden and inert with no filters).
     - Explore cards are clickable as a whole: one stretched title link.
     - The resource page's left column (rules, who can book, limits, checklist) is sticky. It first had a height cap and its own scrollbar, which cut the handover checklist off. Now it has no cap and no inner scroll: it sticks below the header when it fits, and when it's taller its `top` goes negative (`min(6rem, 100vh − its height − 1.5rem)`, with the height kept in a CSS variable). It scrolls with the page until its last card is in view, then stays.
     - A global `:focus-visible` rule ringed whole menus; menus are exempt now.
   - **framer-motion:** presets in `lib/motion.js`, `StaggerList` / `StaggerItem` / `FadeUp` in `components/Motion.jsx`. Where:
     - page entrance (in `LazyPage`);
     - list staggers (bookings, notifications, incidents, requests, badge queue, verification queue, dashboard, timeline);
     - card hover lift;
     - sliding active indicators (nav, category pills);
     - menu and dialog entrances;
     - the unread badge pop;
     - auth pages.

     `MotionConfig reducedMotion="user"`. Its own 45 kB (gzip) vendor chunk.
   - **Blocked:** the teammate's background image (not in the repo yet).
   - **Review:** 10 findings, all reproduced first (a browser check or a failing test), then fixed:
     - a whileTap on the card's `<article>` made framer give it a tab stop;
     - the nav's shared-layout box flew in from the scroll position, so it is now placed from offsets within the nav;
     - the mobile menu stayed open after other navigation;
     - the profile's `/auth/me` re-read could restore the user after a logout;
     - Explore's next page replayed the old cards;
     - non-item content in the account menu;
     - "Clear filters" classes fighting Button's own;
     - CSS transitions chasing framer's transforms;
     - contradictory staff wording on /profile;
     - the shared `['badges', 'mine']` cache shape.
   - **Tests:** 319 client tests (309 + 10 new: profile, the account menu and its panel, the logout race, card link, filter box, "See all"). Server untouched.
7. ✅ **Five cool-to-have features (30 Oct).** One phase each, local commits only: build, then three read-only review agents in parallel (backend, frontend, security), then every finding reproduced (a failing test or a browser check) before it was fixed, then the gate (both suites, lint, build, a Playwright check on the dev server with the API mocked).
   - **Groundwork** (`72cdf1b`, `b3f098c`): the Gemini REST client (`config/gemini.js`, no SDK), `GET /ai/quota`, and the AI quota made demo-safe. Demo accounts count per account and visitor, inside one shared daily pool, so a forged `X-Forwarded-For` can't get past it.
   - **How it works and the guided tour** (`4769820`, FC-01, FC-03): `/how-it-works`, public and static. A `driver.js` tour per page on `data-tour` targets, from the **?** in the header. Review fixes: the tour stayed over the next page, focus was lost, and tour text was rendered as HTML (now escaped).
   - **QR booking pass and scanner** (`3519390`, C-04, FC-05): a 2-minute signed pass plus a 6-character code that works once; `/manage/scan` with the camera or the typed code; verify, then open the next step. Review fixes:
     - reusable codes (now `GETDEL`);
     - repeated scans audited twice;
     - a live code for another unit was distinguishable from a dead one;
     - a flaky forged-token test (a non-canonical base64 tag);
     - a worker leaked on each scan;
     - a stale QR left on screen.
   - **AI search** (`d83b16c`, C-05, FC-06): **Ask in your own words** on Explore, picks with Gemini's reason and eligibility, and the keyword fallback on 429/503. Review fixes:
     - a failure Google worked on is now charged, not refunded, so failing calls can't drain the global cap for free;
     - `maxOutputTokens`;
     - emails, roll numbers and phone numbers redacted from the question and the catalogue;
     - reasons with links withheld;
     - verified members only;
     - the cache key is the exact prompt text;
     - a `?ask` link waits for a click;
     - the fallback survives a retry and Back;
     - one live region.
   - **AI photo comparison** (`245d827`, C-15, FC-13): the return check's **Compare with AI**. Review fixes:
     - photos fetched in a new `prepare` step, so a failed fetch refunds everything;
     - public ids carrying a Cloudinary transformation refused at write;
     - check-out refuses a pickup photo;
     - the demo admin kept off real members' photos;
     - a `comparable` flag;
     - size and total caps;
     - the manager's own photos as a fallback;
     - the card doesn't steal focus, and a double click doesn't pay twice.
   - **On-device ID-card check** (`efabd70`, FC-12): Tesseract 7 in the browser, self-hosted under `/tesseract/`. Only yes/no answers go with the upload, and the admin can re-check in their browser through `GET /admin/verifications/:userId/id-card/file`. Review fixes:
     - a hang when the model download failed (a Tesseract bug; the model is now fetched first with a deadline);
     - workers ended on every path;
     - the card's type read from its bytes, not Cloudinary's header;
     - the server decides which checks count;
     - a capped read, and HEAD refused;
     - fuzzier institute, roll-number, name and year matching for real OCR;
     - Blob error bodies parsed in `lib/http.js`.
   - **Merged in** the teammate's `/badges` page (PR #19) as `9da163c`.
   - **Tests:** 827 server tests with MongoDB (356 + 2 skipped without), 374 client tests.

**Open, in priority order:**
1. **Set `GEMINI_API_KEY`** in `server/.env` and on Render (`docs/deploy.md` §3b), then try AI search and the photo comparison against the real API. Every AI test so far used a fake Gemini, and the photo comparison needs real handover photos.
   - **Check once on the deployed site:** that the admin's "Check on this device" loads a real card. Cloudinary's Download API is assumed to answer with the image, or one redirect to it within the account; the server reads the type from the bytes either way.
   - The dead teammate files (`features/bookings/components/BookingPanel.jsx`, `CheckInOutWizard.jsx`, `BookingTimeline.jsx`, `features/manage/ReviewQueuePage.jsx`) are unused and hold the remaining lint warnings.
2. **Deploying, with your accounts:** follow `docs/deploy.md`.
   - Generate **new** JWT secrets and OTP pepper, because the old ones leaked in early commits.
   - Render's free plan blocks the usual SMTP ports, so use Brevo on port 2525.
   - `render.yaml` deploys `main`, so merge `Aryan` first.
   - Run `npm run seed`, then `npm run golden-path -- <api url>`, then `npm run seed` again.
3. **A shared secret between Vercel and Render.** A client calling the Render URL directly can forge `X-Forwarded-For` to dodge the per-IP ceilings and use up the daily OTP-email cap. The fix is Vercel Routing Middleware adding a secret header that the server checks.
4. **The demo admin's reach (decision).** The boot warning is in place. Keep the judged instance demo-only, or scope demo staff accounts to demo data.
5. **After this plan:** `/admin/users` and `/admin/org-units` pages (the `GET /admin/users` API exists), `/profile`, email for booking events (B-18), a badge revoke action, then the cool-to-have features.

**Deferred from Phase 1 (decisions needed):** the documented "never key a rate limit on IP" rule leaves two gaps. (a) Rotating email addresses gets unlimited register/OTP emails and bcrypt work. (b) About 60 scripted demo-login requests per role lock the judges out for 15 minutes. The proposed fix is a coarse per-IP ceiling stacked on the existing per-email and per-role limits, plus a global daily OTP-mail cap and `app.set('trust proxy', 1)` for Render.
