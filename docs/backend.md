# ShareX: Backend Plan

> Node.js 22 · Express 5 · MongoDB (Mongoose 9) · Redis (ioredis 5) · JWT · Cloudinary · Nodemailer · node-cron · pino. (Zod was planned and isn't used: see §7.)
>
> System-level design (routes, Redis keys, rate limits, logging, deployment) is in [`architecture.md`](./architecture.md). This doc covers **what the backend builds**, **in what order**, and **how the core logic works**.

---

## Implementation status (30 Oct 2026)

- **MVP:** 19 of the 22 MVP features are built and 3 are partial. No P0 feature is missing.
- **Partial:** B-05 (no API to suspend users, and the admin role is granted only by a script), B-06 (validation is hand-written in the services; no Zod and no HTML sanitising) and B-18 (email goes out only for sign-up codes and ID-card decisions).
- **Cool-to-have (§3):** C-04 (the QR pass), C-05 (AI search) and C-15 (the AI photo comparison) are built (30 Oct), with the Gemini client (`config/gemini.js`) and `GET /ai/quota`. C-09 is partly there (a manual `strike` outcome on incidents). C-02, C-13 and C-14 have model fields that nothing uses yet.
- **Quality:** status changes are conditional updates (safe under races), token rotation and the AI quota are atomic Lua, scope checks are careful, and errors never leak internals. Main gaps: per-user rate limits shared by everyone on one demo account, a waitlist promotion that's lost when it misses the lock, two missing time guards in the state machine, and no transactions.
- **Tests:** `cd server && npm test` gives 358 tests (356 pass, 2 skipped). 30 of the 60 test files (`test/integration/*`, `test/routes/*`) run only with `TEST_MONGODB_URI`; with a local MongoDB all 827 pass (30 Oct 2026).

**Legend:** ✅ built · 🟡 partial · ❌ not built.

History and decisions are in [`progress.md`](./progress.md). The API as built (every route, body and error) is in [`api.md`](./api.md). Where this plan and the code differ, the code and `api.md` win; the differences are marked below.

---

## Rating legend

| Scale                                    | 1                 | 2            | 3          | 4         | 5        |
| ---------------------------------------- | ----------------- | ------------ | ---------- | --------- | -------- |
| **Wow**: how much it impresses a judge   | Expected plumbing | Nice to have | Noticeable | Memorable | Standout |
| **Difficulty**: effort for one developer | < 1 h             | 1–3 h        | 3–6 h      | 6–10 h    | > 10 h   |

**Priority:**

- **P0** = MVP, must ship.
- **P1** = build right after the MVP freeze (best wow per hour).
- **P2** = if time permits.
- **P3** = future work; mention in the project doc.

---

## 1. Scope and principles

1. **Ship the lifecycle first.** The MVP is the smallest backend that lets a judge complete the full journey (list → discover → eligibility → request → review → decision → check-in → check-out → return confirmation → incident → history) without any manual explaining.
2. **Thin controllers, fat services, pure engines.**
   - Eligibility rules and state transitions are pure functions with no I/O.
   - That makes them unit-testable and impossible to bypass.
   - ✅ **As built:** there is no `controllers/` folder. The route handlers in `server/src/routes/*.js` are the thin layer: they call a service and send the envelope (`lib/respond.js`). The engines in `engines/` are pure.
3. **Every important mutation is audited.** It goes through `auditService.record()` inside the service layer, never in controllers, so nothing is forgotten.
   - ✅ Built. Writes are awaited. There are no transactions, so the audit write comes after the main write: if it fails, the change stays and the request answers 500 (`progress.md` §10).
4. **Validate at the edge, trust nothing.** A Zod schema on every route, and Mongoose validators as a second layer.
   - 🟡 **Changed:** there is no Zod. Each service checks its own input with the helpers in `services/params.js`, and the Mongoose validators are still the second layer (see §7).
5. **Humans decide; the system explains.**
   - Automated checks may _block_ a request (with a reason and a fix) or _suggest_ an action.
   - Rejections, penalties, suspensions and incident outcomes always need a human actor and a written reason.
   - ✅ Built for rejections, waitlisting and incident outcomes (a reason or rationale is required). Suspension has no API yet (B-05).
6. **Fail safely.**
   - The cache and rate limiter fail **open** if Redis is down.
   - The booking lock and AI quota fail **closed**.
   - ✅ Built as described. OTPs and refresh tokens also answer 503 without Redis. The AI quota fails closed too: AI answers 503 and keyword search carries on. One gap: `config/redis.js` sets no `commandTimeout`, so a Redis that hangs, instead of refusing connections, can stall a request.

---

## 2. MVP (P0): the basic product

### 2.1 MVP definition

> A **verified NIT Jamshedpur member** can find a resource, see exactly which requirements they meet, request a time slot, and (once a manager of the owning unit approves) check in and check out with condition photos.
>
> The manager confirms the return or flags damage, which opens an incident that a human resolves.
>
> Both sides, and the admin, can see a complete, append-only history of every decision.

**In the MVP:**

- ✅ `@nitjsr.ac.in` sign-up with an email OTP, and an ID card checked by an admin.
- ✅ One eligibility engine.
- ✅ One booking state machine.
- ✅ A FIFO waitlist.
- ✅ Weekly fair-usage caps.
- ✅ A cron sweeper for reminders, no-shows and overdue returns.
- 🟡 In-app and email notifications. In-app is complete; email covers only sign-up codes and ID-card decisions (B-18).
- ✅ An audit log.
- ✅ Per-user rate limits.
- ✅ Caching.
- ✅ Seeded demo data.

**Not in the MVP** (see §3). None of these is built:

- AI (Gemini)
- BullMQ
- Socket.io
- WhatsApp
- Extensions
- Priority scoring
- QR codes
- Analytics
- Appeals

### 2.2 MVP backend features

| ID   | Feature                                                                                                                        | Lifecycle step |  Wow  | Diff | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status | Implementation notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | -------------- | :---: | :--: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-01 | Domain-restricted registration + email OTP                                                                                     | —              |   2   |  2   | `ALLOWED_EMAIL_DOMAINS=nitjsr.ac.in`; OTP hashed in Redis, 10 min TTL, max 5 tries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |   ✅   | `services/authService.js`, `services/authOtp.js`. Redis keeps only `sha256(code + OTP_PEPPER)`; the 5th wrong guess deletes the code; store and check are atomic Lua. Sent with nodemailer (`config/mailer.js`, 15 s connect timeout): Brevo on port 2525 on Render (`render.yaml`). `config/env.js` warns at boot when Render's blocked SMTP ports (25, 465, 587) are set. `*.test` addresses are never emailed                                                                                                                                                                                                                          |
| B-02 | Email-pattern affiliation hints                                                                                                | —              |   3   |  1   | `2024ugcs999@` → UG, 2024, CSE. Hints only; unknown formats fall back to the user choosing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |   ✅   | `emailHints()` in `services/authService.js` fills `User.emailHints` on register. Used only to pre-fill the ID-card form; the admin confirms member type and department                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| B-03 | ID-card upload + admin verification queue                                                                                      | —              |   3   |  2   | Cloudinary `authenticated` storage, 5-min signed view URL, audited views, image deleted after the decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |   ✅   | `services/uploadService.js` (in memory, type read from the bytes with `file-type`, 5 MB), `services/verificationService.js`, `routes/verification.js`, `routes/admin.js`. Every view is audited and counted by the `fileLink` tier. The card is deleted before the decision is saved. While `DEMO_MODE` is on, a demo admin sees only demo accounts; a real admin is made with `npm run grant-admin -- <email>`                                                                                                                                                                                                                           |
| B-04 | JWT auth (15-min access, rotating refresh) + demo-login                                                                        | —              |   1   |  2   | Refresh `jti` allow-listed in Redis with reuse detection; `demo-login` only when `DEMO_MODE=true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |   ✅   | `services/authTokens.js`: one refresh family per sign-in, rotated on every use with atomic Lua; reuse revokes only that family, with a 30 s grace for two tabs. Demo routes don't exist with `DEMO_MODE` off. Gap: demo sessions live 7 days, like real ones                                                                                                                                                                                                                                                                                                                                                                              |
| B-05 | RBAC + OrgUnit scope middleware                                                                                                | 5, 6           |   1   |  2   | Planned: `requireRole()`, `requireVerified()`, `loadAndAuthorize(model, policy)` (not built: see the next column)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |   🟡   | No RBAC middleware. Routes use `verifyAuth` (`middleware/auth.js`) and `blockSuspended`; role and unit-scope checks live in the services (`services/access.js`, the state machine's relations) and read roles from MongoDB, so a change applies at once. The manager role is set by `PUT /org-units/:id/managers`. **Not built:** an API to grant admin (only `npm run grant-admin`) or to suspend a user (`suspendedUntil` is enforced but set only in the database). Gap: `blockSuspended` also blocks check-out and cancel (`routes/bookings.js`), so a suspended borrower can't check out an item they hold, or cancel to free a slot |
| B-06 | Zod validation middleware + error envelope                                                                                     | all            |   2   |  2   | Planned: `validate({ body, params, query })`; `AppError` class; field-level 400s (Zod and `validate()` not built)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |   🟡   | Envelope ✅: `middleware/errorHandler.js` with `ServiceError` (`lib/serviceError.js`) in place of `AppError`; Mongoose, cast, duplicate-key and body-parser errors are mapped, and a 500 says only "Something went wrong." Validation is hand-written in each service with `services/params.js` (`readId`, `readEnum`, `readText`, `readPaging`, …): field-level 400s, ids safe from operator injection. No Zod, no `validators/` folder, no HTML sanitising (§7)                                                                                                                                                                         |
| B-07 | OrgUnits + resource CRUD                                                                                                       | 1              |   2   |  3   | Availability (weekly hours + blackouts), eligibility rules, limits, `quantity`, `bookingMode`, condition checklist, status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |   ✅   | `services/orgUnitService.js`, `services/resourceService.js`, `routes/orgUnits.js`, `routes/resources.js`. Managers write only their own units' listings; every write is audited and clears the cache. `GET /resources/:id/availability` uses `engines/availability.js`                                                                                                                                                                                                                                                                                                                                                                    |
| B-08 | Resource search and filters + Redis cache                                                                                      | 2              |   2   |  2   | Text index; filters for category, unit, member type, date; versioned list cache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |   ✅   | `listResources()` in `services/resourceService.js`, plus `eligibleOnly`. Cache-aside in `services/cacheService.js`: lists 60 s and details 5 min, under a version that every write bumps; fails open. Nothing per-user is cached                                                                                                                                                                                                                                                                                                                                                                                                          |
| B-09 | Badges: catalogue, request (with optional evidence), grant                                                                     | 2, 4           |   2   |  2   | Expiry through `validityDays`; managers grant only their own unit's badges                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |   ✅   | `services/badgeService.js`, `routes/badges.js`, `routes/badgeRequests.js`: catalogue, request with a private evidence file, FIFO queue, approve or reject, direct grant, expiry worked out on read. API complete. Gaps: no revoke action; the member `/badges` page is a frontend placeholder                                                                                                                                                                                                                                                                                                                                             |
| B-10 | **Explainable eligibility engine** + `POST /bookings/check`                                                                    | 2, 4           | **4** |  3   | Returns `[{rule, passed, message, fixHint}]`; the same engine runs inside `POST /bookings`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |   ✅   | `engines/eligibility.js`: the 12 rules of §6.1, pure. The same `evaluate()` serves `GET /resources/:id/eligibility`, `POST /bookings/check` and `POST /bookings`, and each booking keeps an `eligibilitySnapshot`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| B-11 | Booking state machine (one `transition()` function)                                                                            | 3–8            |   3   |  3   | Guards, allowed roles, required reasons, side effects (audit, notify, promote)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |   ✅   | `engines/stateMachine.js` (pure), `services/bookingService.js`, `services/bookingTransitions.js`. Each change is a conditional update on `{ _id, status: from }`, so a race gets 409. `allowedActions()` tells the UI which buttons work. Gaps: `approve` has no "before start" guard, and a borrower can cancel after the start (§6.2)                                                                                                                                                                                                                                                                                                   |
| B-12 | Double-booking prevention                                                                                                      | 3, 6           |   3   |  2   | Redis `SET NX PX` lock per resource, plus an overlap and capacity check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |   ✅   | `lib/lock.js`: 5 s lock, released by a Lua compare-and-delete, 3 retries with jitter. Taken by create and approve, which recount capacity at the slot's busiest moment. Fails closed: 503 when Redis is down. Tested with concurrent requests                                                                                                                                                                                                                                                                                                                                                                                             |
| B-13 | Fair-usage caps                                                                                                                | 4, 6           |   3   |  2   | Weekly hours per resource and max active bookings; part of the eligibility engine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |   ✅   | `WEEKLY_HOURS` and `ACTIVE_BOOKINGS` rules, with the counts from `services/bookingContext.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| B-14 | FIFO waitlist + auto-promotion                                                                                                 | 6              |   3   |  2   | On reject, cancel, no-show or expiry, the next eligible waitlisted request moves to `pending`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |   ✅   | `services/waitlistService.js`; position worked out on read. Gap: promotion takes its own lock after the write that freed the slot. If it misses the lock it is only logged, and nothing retries it (§6.3)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B-15 | Condition reports: check-in, check-out, return confirmation                                                                    | 7, 8           |   3   |  2   | Checklist items from the resource, up to 3 photos, overall rating                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |   ✅   | `checkIn`, `checkOut` and `confirmReturn` in `services/bookingService.js`: every checklist item exactly once; photos must be ones `/uploads/images` stored in our Cloudinary account (`photoProblems()` in `services/uploadService.js`)                                                                                                                                                                                                                                                                                                                                                                                                   |
| B-16 | Incidents + human resolution                                                                                                   | 9              |   2   |  2   | Created by the member, by the manager on return, or by the system (overdue); outcome plus rationale required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |   ✅   | `services/incidentService.js`, `routes/incidents.js`. The first staff comment moves it to `in_review`; resolving closes a `flagged` booking. A `strike` outcome adds one to `User.strikes`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| B-17 | `node-cron` sweeper                                                                                                            | 9              |   3   |  2   | Every 5 min: reminders, no-show, overdue, expiry of waitlisted and undecided requests; claims each booking before acting, so it's idempotent; Redis-locked, and still runs if Redis is down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |   ✅   | `jobs/sweeper.js`: every step goes through `transition()`, and overdue opens a system `delay` incident. Runs once at boot, starts only once the server is listening, and shutdown waits for a running sweep. Gap: `api.md` says check-in closes at `end`, but the sweep marks a no-show 15 min after `start`                                                                                                                                                                                                                                                                                                                              |
| B-18 | Notifications: in-app + email                                                                                                  | 6–9            |   2   |  2   | `notifyService.send(users, event, data)`; email only for key events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |   🟡   | `services/notifyService.js`, `routes/notifications.js`: 22 in-app events, feed, unread count, mark read and read all; `send()` never throws. Email goes out only for sign-up codes (`authService.js`) and ID-card decisions (`verificationService.js`), not for booking or incident events (§8.2). No route changes `notificationPrefs`                                                                                                                                                                                                                                                                                                   |
| B-19 | Audit log + booking timeline                                                                                                   | 10             |   3   |  2   | Append-only collection; timeline = audit entries plus condition reports merged by time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |   ✅   | `services/auditService.js`; `models/AuditLog.js` throws on every update and delete. The timeline also merges incidents. `GET /audit` shows a manager their own units and an admin everything. Gap: no transactions, so the audit write can fail after the change                                                                                                                                                                                                                                                                                                                                                                          |
| B-20 | Rate limiting keyed by user, email or demo role; coarse per-IP ceilings stacked on the public auth routes (**never IP alone**) | —              |   2   |  1   | `express-rate-limit` with a small Redis store (`lib/redisRateLimitStore.js`). `register`, `login` and `demo-login` each add an IP tier after their email or role tier (100 sign-ups an hour, 100 failed logins per 15 min, 60 demo logins per role and IP per 15 min, under 1000 per role). The IP tiers key on every address the trusted proxies forwarded (`TRUST_PROXY_HOPS`, 2 behind Vercel and Render), so visitors behind one Vercel address keep their own counters. Code emails: 50 a day per network (`otpSendIp`, on register, resend-otp and the unverified login), and a global cap of 250 in any 24 hours, then register and resend-otp answer 503. Tiers in `architecture.md` §11 |   ✅   | `middleware/rateLimit.js`, mounted on every API router; fails open; 429 with `Retry-After`. Gap: the per-user tiers (`general` 300 per 5 min, `bookingCreate` 10 an hour, `upload` 20 an hour, `fileLink` 20 per 15 min) key on the user id, so everyone signed in to one demo account shares a counter and judges can lock each other out                                                                                                                                                                                                                                                                                                |
| B-21 | pino logging, request IDs, `/health`                                                                                           | —              |   1   |  1   | Redaction of secrets and PII                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |   ✅   | `lib/logger.js` (redaction), `middleware/httpLogger.js` (pino-http), `middleware/requestLogger.js` (request id, sent back as `X-Request-Id` and stored in audit entries). `/health` (in `app.js`) answers 503 only when MongoDB is down; Redis down shows as `degraded`                                                                                                                                                                                                                                                                                                                                                                   |
| B-22 | Seed script (real NIT JSR units, fictional people and inventory)                                                               | demo           |   2   |  1   | `npm run seed`, idempotent; data in §9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |   ✅   | `scripts/seed.js`, `seedData.js`, `seedBookings.js`: 18 units, 7 badges, 13 resources, 6 demo users and 16 bookings that end in all 11 states. The bookings go through the services, so they carry reports, incidents, audit and notifications. Needs Redis. `npm run golden-path` checks a running deployment end to end                                                                                                                                                                                                                                                                                                                 |

**Effort:** about 45 person-hours, which fits two backend developers in hours 4–28 of the timeline.

---

## 3. Cool-to-have features (after MVP freeze)

| ID   | Feature                                                   | Wow | Diff | Priority | Why it's worth it / notes                                                                                                                                                                                                       | Status (29 Oct 2026)                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------- | :-: | :--: | :------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | **Auto-quarantine on damage**                             |  3  |  1   |    P1    | A `high`-severity damage incident sets the resource to `maintenance` until a manager clears it. Cheap safety win                                                                                                                | ❌ A manager can set `maintenance` by hand (`PATCH /resources/:id/status`); no incident does it                                                                                                                                                |
| C-02 | **Hash-chained audit log** + `GET /audit/verify`          |  4  |  2   |    P1    | `hash = sha256(prevHash + canonicalJSON(entry))`; a tamper-evident badge in the admin UI. Strong trust story                                                                                                                    | ❌ `AuditLog` has `prevHash` and `hash` fields, but nothing fills them, and there is no `/audit/verify`                                                                                                                                        |
| C-03 | **Smart alternatives on conflict**                        |  4  |  2   |    P1    | When a slot is taken, return the next 3 free slots plus similar resources (same category, user eligible)                                                                                                                        | ❌ A taken slot gets 409 `SLOT_TAKEN` with the waitlist position only                                                                                                                                                                          |
| C-04 | **QR booking pass** + scan endpoint                       |  4  |  2   |    P1    | Signed short-lived token (`bookingId`, `exp`); the manager scans it at handover to check in or out. Feels like a real product                                                                                                   | ✅ `services/passService.js`: `cc1.<id>.<exp>.<tag>` under an HMAC key derived for passes only, 2 minutes, compared in constant time; a 6-character code that works once; `POST /bookings/scan` verifies the booking for the unit's staff, records `booking.pass_verified` once per pass and names the next step the scanner may take |
| C-05 | **Gemini smart search** with a **hard Redis daily quota** |  5  |  3   |    P1    | Natural-language query → filters + ranked results with reasons. Lua quota: 5 per user per day, global per-minute and daily caps, cache hits are free, circuit breaker on Gemini 429. **No PII sent.** See `architecture.md` §15 | ✅ `POST /resources/ai-search` (`services/aiSearchService.js`) on the REST Gemini client (no SDK). It returns ranked picks with reasons rather than filters; eligibility is worked out afterwards from the viewer's own record. Emails, roll numbers and phone numbers are taken out of the question and the catalogue. Verified members only. The cache key is exactly what Gemini reads |
| C-06 | **Priority score for contested slots**                    |  5  |  3   |    P1    | Published formula (purpose + fairness bonus − reliability penalty) stored with a breakdown on each booking. Manager sees it as a recommendation and can override with a reason. Big win for fairness points                     | ❌ The manager queue groups competing requests (`GET /bookings/manage?status=pending`), with no score                                                                                                                                          |
| C-07 | Booking extensions                                        |  2  |  2   |    P1    | The problem statement lists extensions among audited actions; conflict re-check; manager decides                                                                                                                                | ❌                                                                                                                                                                                                                                             |
| C-08 | Timed waitlist offers                                     |  3  |  2   |    P1    | Promoted user has 30 min to accept, otherwise the offer passes on (checked by the sweeper)                                                                                                                                      | ❌ Promotion moves the request straight to `pending` (or `approved`)                                                                                                                                                                           |
| C-09 | Strikes + reliability score                               |  3  |  2   |    P1    | No-shows and late returns add strikes. At 3 strikes an admin gets a _suggestion_ to suspend; never automatic                                                                                                                    | 🟡 Only by hand: an incident resolved with the `strike` outcome adds one to `User.strikes`, which the member sees on their profile. No-shows and late returns add none, and there is no suggestion to suspend                                  |
| C-10 | Socket.io real-time updates                               |  3  |  2   |    P2    | Rooms `user:{id}` and `resource:{id}`; JWT handshake; replaces 30-s polling                                                                                                                                                     | ❌ The client polls the unread count                                                                                                                                                                                                           |
| C-11 | BullMQ jobs                                               |  2  |  3   |    P2    | Delayed jobs at approval time (reminder, no-show check, overdue check), email queue with retries, Bull Board. Needs Redis Cloud or Render Key Value                                                                             | ❌ The `node-cron` sweeper does this work (B-17)                                                                                                                                                                                               |
| C-12 | WhatsApp notifications                                    |  4  |  3   |    P2    | Meta WhatsApp Cloud API. The test number can message up to 5 verified recipients (enough for a demo); business-initiated messages need approved templates; explicit user opt-in with an E.164 phone number                      | ❌                                                                                                                                                                                                                                             |
| C-13 | Training micro-quiz auto-grants low-risk badges           |  4  |  2   |    P2    | 5 questions with a pass mark of 4; only for badges marked `selfServe` (e.g. "GPU Usage Policy"); high-risk badges still need a manager                                                                                          | ❌ `Badge.selfServe` exists and the seed sets it on two badges, but `createBadge` refuses it and there is no quiz                                                                                                                              |
| C-14 | AI incident summary                                       |  3  |  2   |    P2    | Neutral summary of the incident thread for the resolver; names and roll numbers replaced with placeholders first                                                                                                                | ❌ `Incident.aiSummary` exists and staff get it as `null`; nothing writes it                                                                                                                                                                   |
| C-15 | AI before/after photo comparison                          |  5  |  4   |    P2    | Gemini vision flags visible differences as a _suggestion_ on the return-confirmation screen. Equipment photos only                                                                                                              | ✅ `POST /bookings/:id/ai-compare` (`services/photoCompareService.js`): the server fetches the pickup and return photos small from our own Cloudinary (by stored public id, size-capped, no redirects) in the quota's `prepare` step, so a failed fetch costs nothing; refuses reused photos; Gemini also says whether the photos are comparable |
| C-16 | Analytics aggregation                                     |  4  |  3   |    P2    | Utilisation % per resource, **most underused resources**, demand by hour and weekday, no-show rate, **Gini coefficient** of hours                                                                                               | ❌                                                                                                                                                                                                                                             |
| C-17 | Incident appeals                                          |  2  |  2   |    P2    | Borrower contests an outcome; goes to an admin; full thread audited                                                                                                                                                             | ❌                                                                                                                                                                                                                                             |
| C-18 | Suspicious-pattern flags                                  |  3  |  3   |    P3    | Rule-based: repeated last-minute cancellations, the same people trading slots, frequent overdue returns. Flags for admin review only                                                                                            | ❌                                                                                                                                                                                                                                             |
| C-19 | `.ics` calendar feed                                      |  2  |  2   |    P3    | Tokenised personal feed for Google Calendar                                                                                                                                                                                     | ❌                                                                                                                                                                                                                                             |
| C-20 | Team bookings + group quotas                              |  2  |  3   |    P3    | Club or project teams share one quota so a group can't book in several names                                                                                                                                                    | ❌                                                                                                                                                                                                                                             |
| C-21 | PDF transaction record                                    |  2  |  2   |    P3    | `pdfkit` export of one booking's timeline                                                                                                                                                                                       | ❌                                                                                                                                                                                                                                             |
| C-22 | Personal data export and account deletion                 |  2  |  2   |    P3    | Anonymise the user in old audit entries instead of deleting the entries                                                                                                                                                         | ❌                                                                                                                                                                                                                                             |
| C-23 | Delegate ID verification to department managers           |  2  |  1   |    P3    | Spreads the admin's workload                                                                                                                                                                                                    | ❌ Only admins review ID cards                                                                                                                                                                                                                 |
| C-24 | Passwordless OTP login                                    |  2  |  2   |    P3    | Also reduces the login-lockout abuse risk                                                                                                                                                                                       | ❌ OTPs verify the email at sign-up only                                                                                                                                                                                                       |

**Suggested P1 order** (best wow per hour first): C-01 → C-02 → C-03 → C-04 → C-05 → C-06 → C-07 → C-08 → C-09. C-04 and C-05 are done; C-02 (fields ready) has the most groundwork of the rest.

---

## 4. Folder structure

✅ **As built** (`ls -R server/src`, 29 Oct 2026). The plan had a `validators/` folder (Zod), a `controllers/` folder, `middleware/rbac.js`, `validate.js`, `upload.js` and `requestId.js`, `lib/AppError.js`, `emailPattern.js` and `sanitize.js`, `services/mailService.js` and `src/seed/`. None of them exists; the table after the tree says what took their place.

```
server/
├── package.json            # "type": "module"; scripts: dev, start, test, seed, grant-admin, golden-path, check:redis
├── .env.example
├── scripts/                # seed.js + seedData.js + seedBookings.js (npm run seed), grant-admin.js,
│                           # golden-path.mjs (API check of a running deployment), check-redis.cjs
├── test/                   # node:test: config/ engines/ jobs/ lib/ middleware/ models/ services/ (no database),
│                           # routes/ (HTTP) and integration/ (both need TEST_MONGODB_URI), app.test.js
└── src/
    ├── app.js              # express app: middleware order, routers, /health, error handler
    ├── server.js           # connect Mongo + Redis, start HTTP, then the sweeper; graceful shutdown
    ├── config/
    │   ├── env.js          # start-up checks: production won't boot without the required settings
    │   ├── db.js  redis.js  cloudinary.js  mailer.js (nodemailer; never emails *.test)
    ├── models/             # User, OrgUnit, Resource, Badge, UserBadge, Booking,
    │                       # ConditionReport, Incident, Notification, AuditLog; enums.js helpers.js index.js
    ├── middleware/
    │   ├── requestLogger.js (request id)  httpLogger.js (pino-http)  auth.js (verifyAuth)
    │   ├── blockSuspended.js  rateLimit.js  errorHandler.js (+ 404 handler)
    ├── routes/             # one router per group, mounted under /api/v1; each handler calls a service
    │                       # admin audit auth badgeRequests badges bookings incidents notifications
    │                       # orgUnits resources uploads verification
    ├── services/
    │   ├── authService.js (incl. emailHints)  authOtp.js  authTokens.js  userService.js (GET /admin/users)
    │   ├── verificationService.js  resourceService.js  orgUnitService.js  badgeService.js
    │   ├── bookingService.js  waitlistService.js
    │   ├── bookingContext.js (engine inputs)  bookingTransitions.js (apply + audit + notify)
    │   ├── bookingViews.js (conflict groups, timeline text)
    │   ├── access.js (isAdmin, managesUnit, requireAdmin, requireUnitManager, auditRole)
    │   ├── incidentService.js  notifyService.js  auditService.js
    │   ├── cacheService.js  aiQuotaService.js (built, not called yet)  uploadService.js (multer + file-type)
    │   └── params.js       # input checks shared by the services: readId, readEnum, readText, readPaging, …
    ├── engines/
    │   ├── eligibility.js  # pure: evaluate(user, resource, slot, ctx) → results[]
    │   ├── stateMachine.js # pure: TRANSITIONS map + canTransition() + allowedActions()
    │   └── availability.js # pure: openWindows() and busySegments() for the availability grid
    ├── jobs/sweeper.js     # node-cron, every 5 min
    └── lib/
        ├── logger.js (pino)  log.js (logger used by domain modules)  serviceError.js  respond.js (sendData)
        ├── time.js (IST helpers)  lock.js (Redis lock + Lua release)  redisKeys.js  redisRateLimitStore.js
```

| Planned                                       | What exists instead                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `validators/` (Zod), `middleware/validate.js` | Each service checks its own input with `services/params.js` (§7)                       |
| `controllers/`                                | The handlers in `routes/*.js` call the services directly                               |
| `middleware/rbac.js`                          | Role and scope checks in the services (`services/access.js`), plus `blockSuspended`    |
| `middleware/upload.js`                        | `receiveFiles()` in `services/uploadService.js`                                        |
| `middleware/requestId.js`                     | `middleware/requestLogger.js`                                                          |
| `lib/AppError.js`                             | `lib/serviceError.js` (`ServiceError`, `notFound`, `forbidden`, `invalid`, `conflict`) |
| `lib/emailPattern.js`                         | `emailHints()` in `services/authService.js`                                            |
| `lib/sanitize.js`                             | Nothing: text isn't stripped of HTML (§7)                                              |
| `services/mailService.js`                     | `config/mailer.js` (`sendMail()`)                                                      |
| `src/seed/`                                   | `server/scripts/seed*.js`                                                              |

---

## 5. Data models

The models are shown as field lists, not final code. All have `timestamps: true` (`AuditLog` and `ConditionReport` name their creation time `at`).

✅ **As built:** all ten models are in `server/src/models/` with these fields and indexes, plus `enums.js` (shared enum lists) and `helpers.js`. Some fields wait for cool-to-have features: `User.strikes` is set only by the manual `strike` outcome (C-09), `Badge.selfServe` is refused on create (C-13), and `Incident.aiSummary` (C-14) and `AuditLog.prevHash`/`hash` (C-02) are never written.

### User

```
name            String, 2–80
email           String, unique, lowercase
passwordHash    String (bcrypt, cost 12), select:false
roles           [enum member|manager|admin], default [member]
memberType      enum ug|pg|rs|faculty|staff
department      ref OrgUnit (department type)
emailHints      { year, level, branch, serial }       # parsed from email, informational
emailVerified   Boolean
verification    { status: unsubmitted|pending|approved|rejected,
                  idCardPublicId (select:false), submittedAt, reviewedBy, reviewedAt, reason }
managedOrgUnits [ref OrgUnit]
strikes         Number, default 0                     # C-09; today only the incident `strike` outcome adds one
suspendedUntil  Date | null, suspensionReason
notificationPrefs { email: Boolean }
```

Indexes: `{ email: 1 }` unique, `{ 'verification.status': 1, 'verification.submittedAt': 1 }`.

### OrgUnit

```
name, code (unique, e.g. "dic"), type enum department|centre|central_facility
location { building, notes }
managers [ref User], isActive
```

### Resource

```
orgUnit         ref OrgUnit (owner)
title, slug, description (≤ 2000), images [{ url, publicId }]
category        enum space|equipment|computing|tool
bookingMode     enum slot|loan        # slot: whole interval inside open hours (rooms, machines)
                                      # loan: pickup and return inside open hours (cameras, kits)
quantity        Number ≥ 1            # identical units bookable in parallel
riskLevel       enum low|medium|high
location        { building, room, floor }
status          enum active|maintenance|archived
availability    { weekly: [{ day 0–6, open "09:00", close "17:00" }],
                  blackouts: [{ start, end, reason }], slotMinutes: 30 }
eligibility     { memberTypes [enum], departments [ref OrgUnit] (empty = all),
                  badges [ref Badge], approvalMode enum manual|auto }
limits          { minDurationMins, maxDurationMins, maxHoursPerWeek,
                  maxActiveBookings, leadTimeMins, maxAdvanceDays }
usageRules      String (plain text, ≤ 2000)
checklist       [String] (condition items, e.g. "Nozzle clean", "Build plate undamaged")
createdBy       ref User
```

Indexes: text `{ title, description }`, `{ orgUnit: 1, status: 1 }`, `{ category: 1, status: 1 }`.

### Badge / UserBadge

```
Badge:     name, code, orgUnit (issuer), description, validityDays | null,
           evidenceRequired Boolean, selfServe Boolean (C-13; createBadge refuses it, the seed sets it)
UserBadge: user, badge, status enum requested|active|rejected|revoked,
           evidence { publicId }, note, requestedAt, decidedBy, decidedAt, reason, expiresAt
```

Indexes: `{ user: 1, badge: 1 }` unique; `{ badge: 1, status: 1, requestedAt: 1 }` for the manager queue (FIFO on `requestedAt`).

- A badge is "valid" when `status = active` and `expiresAt` is unset or later than now. "Expired" is worked out on read (`badgeService.badgeState`), never stored.
- One row per user and badge tells the whole story. A member may request again after a rejection, a revocation or an expiry: the same row goes back to `requested` and the earlier decision is cleared from it (the audit log keeps it). An open request or a valid badge can't be requested again (409).
- A direct grant turns any row into an active badge with a fresh `expiresAt`, so it also renews one that is still valid.

### Booking

```
resource, orgUnit (denormalised for scope checks), borrower
start, end      Date (stored UTC; displayed IST)
purpose         String 10–300
status          enum pending|approved|rejected|waitlisted|cancelled|expired|
                     checked_in|checked_out|completed|flagged|no_show
eligibilitySnapshot [{ rule, passed, message }]       # what the system saw at request time
decision        { action, by, at, reason }            # approve / reject / waitlist
cancellation    { by, at, reason }
checkIn         { at, by, report: ref ConditionReport }
checkOut        { at, by, report: ref ConditionReport }
returnConfirmation { at, by, outcome: ok|issue, report: ref ConditionReport }
incidents       [ref Incident]
flags           { startReminderAt, endReminderAt, overdue: Boolean, overdueAt }
```

Indexes:

- `{ resource: 1, status: 1, start: 1, end: 1 }`: overlap checks
- `{ borrower: 1, status: 1, start: -1 }`: "my bookings" and quotas
- `{ orgUnit: 1, status: 1, createdAt: 1 }`: manager queue
- `{ status: 1, start: 1 }` and `{ status: 1, end: 1 }`: sweeper

### ConditionReport

```
booking, resource, phase enum check_in|check_out|return_confirmation
items    [{ label, ok: Boolean, note ≤ 200 }]     # labels copied from resource.checklist
photos   [{ url, publicId }] (0–3)
overall  enum good|minor_issue|damaged
notes    ≤ 1000, submittedBy, at
```

### Incident

```
booking (optional), resource, orgUnit, reportedBy | null (system)
source   enum user|manager|system
type     enum damage|delay|misuse|safety|conflict|other
severity enum low|medium|high
description 20–2000, photos [{ url, publicId }]
status   enum open|in_review|resolved     # in_review on the first manager or admin comment
comments [{ by, text ≤ 1000, at }] (≤ 200; closed once resolved)
resolution { outcome enum no_action|warning|repair_required|strike, rationale, decidedBy, at }
aiSummary  { text, generatedAt }      # C-14, suggestion only; nothing writes it yet
```

### Notification

```
user, type (e.g. booking.approved), title, body, link, readAt | null
```

Indexes: `{ user: 1, createdAt: -1 }` for the feed, `{ user: 1, readAt: 1 }` for the polled unread count, and a TTL of 60 days on `createdAt`.

### AuditLog

```
at, actor { id | null, role | "system" }, action ("booking.approved"),
entity { type, id }, orgUnit, reason, changes { field: [before, after] },
requestId, meta
prevHash, hash        # C-02; never filled yet
```

Indexes: `{ 'entity.type': 1, 'entity.id': 1, at: 1 }`, `{ orgUnit: 1, at: -1 }`, `{ 'actor.id': 1, at: -1 }`. `pre` hooks throw on any update or delete.

---

## 6. Core engines

### 6.1 Eligibility engine

✅ **Built** as described: `engines/eligibility.js`, with `ctx` loaded by `services/bookingContext.js`. Unit-tested rule by rule (`test/engines/eligibility.test.js`).

`evaluate(user, resource, slot, ctx) → { eligible, outcome, results[] }` is a **pure** function. `ctx` is pre-loaded by the service:

- the user's valid badges
- hours booked this week on this resource
- the user's active booking count on it
- the overlap count for the slot
- the current time in IST

| #   | Rule ID            |   Hard?   | Fails when                                                                                           | Example message → fix hint                                                                 |
| --- | ------------------ | :-------: | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `ACCOUNT_VERIFIED` |    Yes    | `verification.status ≠ approved`                                                                     | "Your ID card isn't verified yet." → "Upload your ID card (Profile → Verification)."       |
| 2   | `NOT_SUSPENDED`    |    Yes    | `suspendedUntil > now`                                                                               | "Booking paused until 5 Nov: repeated no-shows." → "Contact the admin to appeal."          |
| 3   | `RESOURCE_ACTIVE`  |    Yes    | `status ≠ active`                                                                                    | "This resource is under maintenance." → "See similar resources."                           |
| 4   | `MEMBER_TYPE`      |    Yes    | `memberType ∉ eligibility.memberTypes`                                                               | "Only PG, Research Scholars and Faculty can book this."                                    |
| 5   | `DEPARTMENT`       |    Yes    | list non-empty and user's department not in it                                                       | "Restricted to ECE and EE students."                                                       |
| 6   | `BADGES`           |    Yes    | any required badge missing or expired                                                                | "Missing badge: 3D Printing Basics." → "Request it from the Design and Innovation Centre." |
| 7   | `OPEN_HOURS`       |    Yes    | slot mode: interval outside weekly hours or in a blackout; loan mode: pickup or return outside hours | "The Central Workshop is open 09:00–17:00, Mon–Sat."                                       |
| 8   | `DURATION`         |    Yes    | outside `[minDurationMins, maxDurationMins]`                                                         | "Maximum booking length is 4 hours."                                                       |
| 9   | `BOOKING_WINDOW`   |    Yes    | `start < now + leadTime` or `start > now + maxAdvanceDays`                                           | "Book at least 2 hours ahead and at most 14 days ahead."                                   |
| 10  | `WEEKLY_HOURS`     |    Yes    | `hoursThisWeek + duration > maxHoursPerWeek`                                                         | "You've used 5 of 6 hours this week on this printer." → "Try next week or a shorter slot." |
| 11  | `ACTIVE_BOOKINGS`  |    Yes    | `activeCount ≥ maxActiveBookings`                                                                    | "You already have 1 active booking for this resource."                                     |
| 12  | `AVAILABILITY`     | No (soft) | `overlapCount ≥ quantity`                                                                            | "This slot is held by an earlier request. Join the waitlist as #2?"                        |

**Outcome:**

- **Any hard rule fails** → `INELIGIBLE` (422). No booking is created; the checklist is returned.
- **All hard rules pass and the slot is free** → `pending` (manual) or `approved` (auto).
- **All hard rules pass and the slot is taken** → `waitlisted`, if `joinWaitlist: true`; otherwise 409 `SLOT_TAKEN` with the waitlist position preview.

The same function powers three places, so the explanation is always consistent:

- `GET /resources/:id/eligibility` (checklist on the detail page)
- `POST /bookings/check` (live pre-check in the booking form)
- `POST /bookings` (enforcement)

### 6.2 Booking state machine

One declarative map, enforced by one function:

```js
// engines/stateMachine.js (illustrative)
export const TRANSITIONS = {
  approve: {
    from: ["pending"],
    to: "approved",
    by: ["unitManager", "admin"],
    reason: false,
  },
  reject: {
    from: ["pending"],
    to: "rejected",
    by: ["unitManager", "admin"],
    reason: true,
  },
  waitlist: {
    from: ["pending"],
    to: "waitlisted",
    by: ["unitManager", "admin"],
    reason: true,
  },
  cancel: {
    from: ["pending", "approved", "waitlisted"],
    to: "cancelled",
    by: ["borrower", "unitManager", "admin"],
    reason: "ifNotBorrower",
  },
  promote: { from: ["waitlisted"], to: "pending", by: ["system"] },
  expire: { from: ["waitlisted", "pending"], to: "expired", by: ["system"] }, // undecided requests expire at start
  checkIn: {
    from: ["approved"],
    to: "checked_in",
    by: ["borrower", "unitManager"],
    report: "check_in",
  },
  markNoShow: { from: ["approved"], to: "no_show", by: ["system"] },
  checkOut: {
    from: ["checked_in"],
    to: "checked_out",
    by: ["borrower", "unitManager"],
    report: "check_out",
  },
  confirmOk: {
    from: ["checked_out"],
    to: "completed",
    by: ["unitManager", "admin"],
  },
  confirmIssue: {
    from: ["checked_out"],
    to: "flagged",
    by: ["unitManager", "admin"],
    incident: true,
  },
  closeFlagged: { from: ["flagged"], to: "completed", by: ["system"] }, // on incident resolution
};
```

`bookingService.transition(bookingId, action, actor, payload)` does five things:

1. Loads the booking.
2. Checks `from`, the actor's relation (`borrower`, `unitManager`, `admin`, `system`), the reason requirement and the time window (check-in is allowed only from 15 min before `start`, until `end`). A manager can't approve, reject, waitlist or confirm the return of **their own** booking; another manager of the unit or an admin must.
3. Applies the change with a **conditional update**: `findOneAndUpdate({ _id, status: from })`. If a concurrent change already moved the booking, this returns `INVALID_TRANSITION` (409).
4. Calls `auditService.record()`.
5. Calls `notifyService.send()` and, for slot-freeing transitions, `waitlistService.promote()`.

✅ **As built:** `engines/stateMachine.js` (pure), `bookingService.transition()` and `applyTransition()` in `services/bookingTransitions.js`, which does steps 3 and 4 and the notifications. The real map matches the one above and adds `review` (nobody but an admin decides on their own booking), `guard` (the time checks), `freesSlot`, `toIfAutoApprove` and the audit action. `approve` runs under the resource lock and recounts capacity first. Step 5 calls `promoteFreedSlot()`, after the write, in a lock of its own (§6.3). Check-in, check-out and return confirmation have their own functions, which use the same `canTransition()`. Known gaps:

- `approve` has no "before start" guard, so a manager can approve a pending request whose start has passed, until the next sweep expires it.
- `cancel` has no time guard either: a borrower can cancel an approved booking after it has started, until the no-show sweep.
- The check-in guard allows check-in until `end`, as `api.md` says, but the sweeper marks an approved booking `no_show` 15 min after `start` (`NO_SHOW_GRACE_MINS`). So in practice check-in closes then. One of the two should change.
- `blockSuspended` is mounted on cancel, check-in and check-out (`routes/bookings.js`), so a suspended borrower who has the item can't check it out.

### 6.3 Waitlist promotion

✅ **Built:** `services/waitlistService.js` (`promoteWaitlist()` under the lock, called through `promoteFreedSlot()`). **Known gap:** the promotion takes the resource lock _after_ the write that freed the slot, as a separate step. When it can't get the lock (3 tries), it only logs "Waitlist promotion skipped". The code comment says the next freed slot retries, but nothing else does: the sweeper doesn't promote. So a waitlisted request can wait for a free unit until it expires at its start.

This runs after any transition that frees a slot: `reject`, `cancel` of a slot-holder, `markNoShow`, `expire` of a pending request, and `waitlist`. When a manager moves a pending request to the waitlist, promotion skips that request, or it would come straight back as the oldest. It runs under the resource lock. If the lock can't be taken, the promotion is skipped and logged, and the change that freed the slot still succeeds.

1. Find `waitlisted` bookings for the same resource that overlap the freed interval and haven't started yet, ordered by `createdAt` (FIFO).
2. For each one, re-run the eligibility engine with fresh context: the person may have been suspended or hit a cap since joining. Every hard rule is re-checked except `BOOKING_WINDOW`, because the request was on time when it was made.
3. **Every** request that passes and still fits capacity moves to `pending` (or `approved` if the resource uses auto approval), oldest first. Capacity is the number of units in use at the busiest moment of the slot, recounted after each promotion. Each promotion is audited as `booking.promoted` (actor `system`) and sends a notification: "A slot opened up: your request moved from the waitlist to review."
4. The others stay waitlisted with recalculated positions. **Position = count of earlier waitlisted overlapping requests + 1**, computed on read, never stored.

### 6.4 Sweeper

Covered in [`architecture.md` §14](./architecture.md#14-scheduled-jobs-mvp-node-cron). Each step calls `bookingService.transition()` with actor `system`, so cron-driven changes get the same guards, audit and notifications as human actions.

✅ **Built:** `jobs/sweeper.js`, wired into `server.js` (see B-17). Steps in order: no-shows, expiry, start reminders, end reminders, overdue returns. The status changes (no-show, expiry) go through `transition()`. Reminders and overdue returns change no status: they claim a flag on the booking (`flags.*`) with a conditional update, and overdue also opens a system incident. So running twice changes nothing.

---

## 7. Validation catalogue

🟡 **Changed during integration (Oct 2026): the services are the validation layer.** Every service checks its own input with `services/params.js` and answers `400 VALIDATION_ERROR` with `details[{ path, message }]`, so the route handlers pass `req.body`, `req.params` and `req.query` straight through. There is no Zod, no `validate()` middleware and no `validators/` folder. Express 5's default query parser can't build objects such as `{ $ne: … }` from a query string. The rules below still describe what each input must satisfy; the auth service applies its rows itself, before the rate limiters, which key on the validated email. The Mongoose validators in `models/` are the second layer (`fromValidationError()` in `lib/serviceError.js` turns them into the same 400). The "As built" columns say where the code differs; ✅ means the rule holds.

**Shared primitives:**

| Primitive            | Rule (planned, Zod notation)                                                  | As built                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `objectId`           | `z.string().regex(/^[a-f\d]{24}$/i)`                                          | ✅ `isId()` / `readId()` (Mongoose `isValidObjectId`); operator objects such as `{ $ne: null }` are refused before any query                                                                                |
| `campusEmail`        | Trimmed, lower-cased, valid email, domain in `ALLOWED_EMAIL_DOMAINS`          | ✅ `readEmail()` in `services/authService.js`                                                                                                                                                               |
| `password`           | `.min(8).max(72)` plus regex for at least one letter and one digit            | ✅ `readNewPassword()`: at least 8 characters and at most 72 bytes (bcrypt's limit); a letter from any script counts                                                                                        |
| `otp`                | `/^\d{6}$/`                                                                   | ✅ `readOtpInput()`                                                                                                                                                                                         |
| `safeText(min, max)` | Trimmed, HTML stripped (`sanitize-html` with no allowed tags), length-checked | 🟡 `readText()` trims and checks length only. **HTML isn't stripped**: `sanitize-html` isn't installed. Output is safe because React escapes text and emails are plain text, but stored text keeps any tags |
| `isoDate`            | `z.coerce.date()`                                                             | ✅ `readInstant()`                                                                                                                                                                                          |
| `pagination`         | `page` int ≥ 1 (default 1); `limit` int 1–50 (default 20)                     | ✅ `readPaging()`; `page` at most 10,000, and a `limit` above 50 is capped rather than refused                                                                                                              |

**Per-route schemas:**

| Route group                              | Schema highlights                                                                                                                                                                                                                                                                                                                                                                                                   | As built                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.register`                          | `name: safeText(2,80)`, `email: campusEmail`, `password`                                                                                                                                                                                                                                                                                                                                                            | ✅ The name also can't hold line breaks or control characters                                                                                                                                    |
| `auth.verifyOtp` / `resendOtp` / `login` | `email: campusEmail` (login also accepts the `.test` demo domain only when `DEMO_MODE`), `otp`, `password: string ≤ 72`                                                                                                                                                                                                                                                                                             | ✅                                                                                                                                                                                               |
| `verification.idCard`                    | `memberType` enum, `department: objectId`; file: jpg/png/webp/pdf, ≤ 5 MB, magic-byte checked                                                                                                                                                                                                                                                                                                                       | ✅                                                                                                                                                                                               |
| `resources.create` / `update`            | `title: safeText(3,120)`; `category`, `bookingMode`, `riskLevel` enums; `quantity` int 1–50; `availability.weekly[]` with `day` 0–6 and `HH:mm` times, `open < close`; `blackouts[]` with `start < end`; `slotMinutes` ∈ {15, 30, 60}; `limits` positive ints with `minDuration ≤ maxDuration`, `maxHoursPerWeek ≥ maxDuration/60`; `checklist` 1–10 items of `safeText(2,80)`; `eligibility.memberTypes` non-empty | 🟡 Mostly in `models/Resource.js`. Differences: `checklist` may be empty (0–10 items), an empty `eligibility.memberTypes` means "everyone", and `maxHoursPerWeek ≥ maxDuration/60` isn't checked |
| `resources.list`                         | `q ≤ 100`, `category?`, `orgUnit?: objectId`, `date?: isoDate`, `eligibleOnly?: boolean`, plus pagination                                                                                                                                                                                                                                                                                                           | ✅ Also `memberType?` and `status?`; `date` is a `YYYY-MM-DD` day in IST                                                                                                                         |
| `bookings.check` / `create`              | `resourceId`, `start`, `end` with `end > start`, both aligned to `slotMinutes`, `start > now`; `purpose: safeText(10,300)`; `joinWaitlist?: boolean`. Resource-specific rules (hours, caps) are enforced by the eligibility engine, not Zod                                                                                                                                                                         | 🟡 `end > start` and `start > now` come from the `DURATION` and `BOOKING_WINDOW` rules. Alignment to `slotMinutes` isn't checked                                                                 |
| `bookings.reject` / `waitlist`           | `reason: safeText(10,500)` (**required**)                                                                                                                                                                                                                                                                                                                                                                           | 🟡 Required, at most 500, but no 10-character minimum                                                                                                                                            |
| `bookings.cancel`                        | `reason: safeText(10,500)`; the service makes it required unless the actor is the borrower                                                                                                                                                                                                                                                                                                                          | 🟡 As above: no minimum length                                                                                                                                                                   |
| `bookings.checkIn` / `checkOut`          | `items[]` (labels must match `resource.checklist`), `overall` enum, `notes: safeText(0,1000)`, `photos[]` ≤ 3 `{url, publicId}` from our own Cloudinary folder                                                                                                                                                                                                                                                      | ✅ Each checklist label exactly once                                                                                                                                                             |
| `bookings.confirmReturn`                 | `outcome: ok \| issue`; if `issue`, then `incident.{type, severity, description}` is required (`superRefine`)                                                                                                                                                                                                                                                                                                       | ✅ Checked in the service (no `superRefine`)                                                                                                                                                     |
| `badges.create`                          | `name: safeText(2,80)`, `code` `/^[a-z0-9-]{2,40}$/` (lower-cased), `orgUnit: objectId`, `description: safeText(0,500)`, `validityDays` int 1–3650 or `null`, `evidenceRequired?: boolean`. `selfServe` is refused until the quiz (C-13) exists                                                                                                                                                                     | ✅                                                                                                                                                                                               |
| `badges.request`                         | `note: safeText(0,500)`; multipart `evidence` (jpg/png/webp/pdf, ≤ 5 MB), uploaded first and passed on as `{ publicId }`                                                                                                                                                                                                                                                                                            | ✅                                                                                                                                                                                               |
| `badgeRequests.list`                     | `status?` (a `USER_BADGE_STATUSES` value, default `requested`), `badgeId?: objectId`, plus pagination                                                                                                                                                                                                                                                                                                               | ✅                                                                                                                                                                                               |
| `badgeRequests.decide`                   | `decision: approve \| reject`, `reason: safeText(0,500)` (**required** to reject)                                                                                                                                                                                                                                                                                                                                   | ✅                                                                                                                                                                                               |
| `badges.grant`                           | `userId: objectId`, `note: safeText(0,500)`                                                                                                                                                                                                                                                                                                                                                                         | ✅ Also takes `email` in place of `userId`                                                                                                                                                       |
| `incidents.create`                       | `type`, `severity` enums, `description: safeText(20,2000)`, `bookingId?`, `resourceId` (required without `bookingId`; must match the booking's when both are sent), `photos[]` ≤ 3 `{url, publicId}` from our own Cloudinary folder                                                                                                                                                                                 | ✅                                                                                                                                                                                               |
| `incidents.list`                         | `status?` (one or a comma list of `INCIDENT_STATUSES`), `type?`, `severity?`, `resourceId?: objectId`, plus pagination                                                                                                                                                                                                                                                                                              | ✅                                                                                                                                                                                               |
| `incidents.comment`                      | `text: safeText(1,1000)`                                                                                                                                                                                                                                                                                                                                                                                            | ✅                                                                                                                                                                                               |
| `incidents.resolve`                      | `outcome` enum, `rationale: safeText(10,1000)`                                                                                                                                                                                                                                                                                                                                                                      | 🟡 Required, at most 1000, but no 10-character minimum. A `strike` needs a booking                                                                                                               |
| `admin.verify`                           | `decision` enum, `reason: safeText(5,500)` (required when rejecting), `memberType`, `department`                                                                                                                                                                                                                                                                                                                    | ✅ Also needs the queue item's `submittedAt` (409 if a newer card arrived)                                                                                                                       |
| `admin.suspend`                          | `until: isoDate \| null` (must be in the future), `reason: safeText(10,500)`                                                                                                                                                                                                                                                                                                                                        | ❌ Planned, not built: there is no suspend route (B-05)                                                                                                                                          |

**Error handling:**

✅ Built, with `ServiceError` in place of `AppError`:

```js
// lib/serviceError.js (as built)
export class ServiceError extends Error {
  constructor(status, code, message, details) {
    super(message); /* sets status, code, details */
  }
}
// helpers: notFound(what), forbidden(message), invalid(message, details), fieldError(path, message),
//          conflict(message) → 409 INVALID_TRANSITION, fromValidationError(err)
// middleware/errorHandler.js: ours (status + UPPER_CASE code) → as thrown, with headers such as Retry-After;
// Mongoose ValidationError and CastError → 400; ZodError → 400 (kept, though nothing throws one);
// duplicate key (11000) → 409; body-parser errors → their 4xx; anything else → 500 "Something went wrong."
// + the stack logged with the requestId. Unknown paths → 404 without echoing the path.
```

---

## 8. Cross-cutting services

### 8.1 `auditService.record({ actor, action, entity, orgUnit, reason, changes, meta })`

✅ **Built** (`services/auditService.js`, with `listAudit()` behind `GET /audit`). Besides the services, the sweeper (overdue flags and their incidents) and the scripts that change data (`grant-admin.js`, the seed) record entries too.

- Called **only from services**. It runs after the domain change succeeds, so the log never claims something that didn't happen.
- Writes are awaited, not fire-and-forget: if the audit write fails, the request fails with a 500 and the error is logged. There are no MongoDB transactions, so in that case the change stays without its entry (`progress.md` §10).
- `GET /bookings/:id/timeline` merges audit entries for the booking with its condition reports (and, as built, its incidents), sorted by `at`, and returns display-ready items such as "Manager (DIC) approved: 'Slot fine, bring your own filament'".

### 8.2 `notifyService.send(userIds, event, data)`

🟡 **Partly built.** In-app notifications are complete (`services/notifyService.js`: every event below except `auth.otp`, plus the feed, unread count and mark-read routes in `routes/notifications.js`). `send()` never throws, so a lost notice doesn't undo the change behind it. Email goes out only for `auth.otp` (`authService.js`) and the verification decisions (`verificationService.js`), both sent after the response with failures logged. The other ✅ rows in the "planned" column send no email yet. There is no route to change `notificationPrefs`.

Each event always creates an in-app `Notification`. Email goes out only for the events marked below and only when the user's `notificationPrefs.email` is on. Email is sent after the response, with errors logged and no retry in the MVP; BullMQ adds retries later.

| Event                                                       | Recipients                                                                                   | Email? (planned) |           Email built?           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- | :--------------: | :------------------------------: |
| `auth.otp`                                                  | User                                                                                         |   ✅ (always)    | ✅ (email only, no in-app entry) |
| `verification.approved` / `rejected`                        | User                                                                                         |        ✅        |                ✅                |
| `booking.requested` (manual)                                | Unit managers                                                                                |        —         |                —                 |
| `booking.approved` / `rejected` / `waitlisted` / `promoted` | Borrower                                                                                     |        ✅        |                ❌                |
| `booking.cancelled`                                         | Other party                                                                                  |        ✅        |                ❌                |
| `booking.expired`                                           | Borrower                                                                                     |        ✅        |                ❌                |
| `booking.checked_in`                                        | Managers                                                                                     |        —         |                —                 |
| `booking.completed`                                         | Borrower (not when an incident's resolution closes the booking: `incident.resolved` says so) |        —         |                —                 |
| `booking.reminder_start` / `reminder_end`                   | Borrower                                                                                     |        ✅        |                ❌                |
| `booking.no_show`                                           | Borrower, managers                                                                           |        —         |                —                 |
| `booking.overdue`                                           | Borrower, managers                                                                           |        ✅        |                ❌                |
| `booking.checked_out`                                       | Managers ("confirm return")                                                                  |        —         |                —                 |
| `incident.created` / `resolved`                             | Borrower, reporter, managers, admins (high severity); never the person acting                |        ✅        |                ❌                |
| `incident.commented`                                        | Same as above                                                                                |        —         |                —                 |
| `badge.requested`                                           | Managers of the issuing unit (not the requester)                                             |        —         |                —                 |
| `badge.granted` / `rejected`                                | User                                                                                         |        —         |                —                 |

The mailer never sends to `*.test` addresses (the seeded demo users).

### 8.3 `cacheService`

✅ **Built** (`services/cacheService.js`), used by resource lists and details and by the badge and org-unit catalogues.

`getOrSet(key, ttl, loader)`, `del(key)`, `bumpVersion(ns)`. All calls are wrapped in try/catch: on Redis errors they log `warn` and fall through to the loader (fail open).

### 8.4 `uploadService`

✅ **Built** as described (`services/uploadService.js`, `config/cloudinary.js`, `POST /uploads/images`). Only verified members may upload photos (`requireVerifiedUploader()`), and photo URLs in reports are checked to be ours (`photoProblems()`).

`multer.memoryStorage()` with limits (5 MB, 3 files) → magic-byte check (`file-type`) → `cloudinary.uploader.upload_stream` with:

- folder `campuscommons/{kind}`
- random public IDs
- `type: 'authenticated'` for ID cards and badge evidence

Condition photos are resized on upload (Cloudinary transformation, max width 1600 px).

---

## 9. Seed data (fictional people, real unit names)

✅ **Built** (`server/scripts/seed.js`, `seedData.js`, `seedBookings.js`; tested in `test/integration/seed.test.js`). The units, badges, resources and users below are seeded as listed. Two differences: there are 16 bookings, and `newstudent` has no ID image (marked below).

`npm run seed` is idempotent: it upserts by `code` or `email`.

**OrgUnits:** the 18 units in `architecture.md` §1.2.

**Badges:**

| Badge                      | Issuer           | Validity | Self-serve (C-13) |
| -------------------------- | ---------------- | -------- | :---------------: |
| Workshop Safety Induction  | Central Workshop | 1 year   |         —         |
| 3D Printing Basics         | DIC              | 1 year   |         —         |
| Laser Cutter Operation     | DIC              | 6 months |         —         |
| GPU Usage Policy           | Computer Centre  | 1 year   |        ✅         |
| Electronics Lab Safety     | ECE              | 1 year   |        ✅         |
| Survey Instrument Training | Civil            | 1 year   |         —         |
| Drone Flight Safety        | SAC              | 6 months |         —         |

**Resources** (fictional inventory, plausible for each unit):

| Resource                     | Unit             | Mode / qty   | Eligibility                                  | Approval | Limits                       |
| ---------------------------- | ---------------- | ------------ | -------------------------------------------- | -------- | ---------------------------- |
| FDM 3D Printer               | DIC              | slot / 1     | All member types + 3D Printing Basics        | manual   | max 4 h, 6 h/week, 1 active  |
| CO₂ Laser Cutter             | DIC              | slot / 1     | All + Laser Cutter Operation; risk high      | manual   | max 2 h, 4 h/week            |
| Centre Lathe                 | Central Workshop | slot / 2     | All + Workshop Safety Induction; risk high   | manual   | max 3 h, 6 h/week            |
| Arc Welding Bay              | Central Workshop | slot / 1     | All + Workshop Safety Induction; risk high   | manual   | max 2 h                      |
| GPU Workstation              | Computer Centre  | slot / 2     | All + GPU Usage Policy                       | **auto** | max 8 h, 16 h/week, 1 active |
| Digital Storage Oscilloscope | ECE              | slot / 3     | All + Electronics Lab Safety                 | **auto** | max 3 h                      |
| IoT Starter Kit              | CSE              | **loan** / 5 | All                                          | **auto** | max 3 days, 1 active         |
| Total Station                | Civil            | loan / 1     | PG, RS, Faculty + Survey Instrument Training | manual   | max 2 days                   |
| Optical Microscope           | MME              | slot / 1     | PG, RS, Faculty                              | manual   | max 3 h                      |
| Discussion Room A            | Central Library  | slot / 1     | All                                          | **auto** | max 2 h, 4 h/week            |
| DSLR Camera Kit              | SAC              | loan / 2     | All                                          | manual   | max 2 days                   |
| Camera Drone                 | SAC              | loan / 1     | All + Drone Flight Safety; risk high         | manual   | max 1 day                    |
| Meeting Room                 | CIIC             | slot / 1     | All                                          | manual   | max 3 h                      |

**Demo users** (all `@demo.campuscommons.test`, password from the testing instructions):

| Login         | Role    | Profile                                                                                                                                                                | Purpose in the golden path           |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `student@`    | Member  | UG, CSE, 2024; verified; has Electronics Lab Safety; **lacks** 3D Printing Basics                                                                                      | Main borrower                        |
| `student2@`   | Member  | UG, Mech, 2023; verified; has 3D Printing Basics                                                                                                                       | Competing request → waitlisted       |
| `faculty@`    | Member  | Faculty, ECE; verified                                                                                                                                                 | Shows faculty-only resources         |
| `manager@`    | Manager | Manages DIC and Central Workshop                                                                                                                                       | Lists, approves, confirms return     |
| `admin@`      | Admin   | Institute admin                                                                                                                                                        | Verification queue, incidents, audit |
| `newstudent@` | Member  | `verification: pending`. Planned with an obviously fake "SAMPLE" ID image; **as built there is no image** (the seed can't upload one), so opening the card answers 404 | Fills the admin verification queue   |

**Bookings:** about 15 historical and upcoming bookings across every state (`completed`, `flagged` with an open incident, `waitlisted`, `no_show`, `cancelled`, …), so every list and timeline screen has data on first load.

✅ As built: 16 bookings (`STORIES` in `seedBookings.js`) that end in all 11 states, made through the booking services and the sweeper's steps, so each has its condition reports, incidents, audit entries and notifications. Seeding bookings needs Redis (the booking lock).

---

## 10. Testing

✅ **Built.** 60 test files in `server/test/`. `npm test` (no database) runs 358 tests: 356 pass and 2 are skipped. The 30 files in `test/integration/` and `test/routes/` need `TEST_MONGODB_URI`; with a local MongoDB the full run is 827 tests, all passing (30 Oct 2026).

**Tools:**

- Node's built-in test runner (`node:test` + `node:assert`), so the test files need no test framework. Supertest was planned for the routes but **isn't used**: the route tests in `test/routes/` start the real app on port 0 and call it with `fetch` (`test/routes/http.js`), signed in with real access tokens.
- **Redis:** `ioredis-mock`, which also runs the Lua scripts, for the lock, cache, rate-limit and AI-quota tests. No Redis server is needed. The one check still worth doing against the real provider (Upstash) is `connectRedis()` plus `pingRedis()`.
- **MongoDB:** the integration tests in `test/integration/`, and the route tests in `test/routes/`, run against a real server. They're skipped unless `TEST_MONGODB_URI` is set. Each file creates its own `campuscommons_test_<random>` database and drops it at the end. Point them at a local or test server, never production.

```
cd server
node --test                                                # everything; integration and route tests skip without TEST_MONGODB_URI
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 node --test test/integration
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test         # the full run
```

The `test` script in `package.json` is `node --test` ✅.

| Layer                         | Must-have cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |                                                      Status                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------: |
| `engines/eligibility` (unit)  | Each of the 12 rules passes and fails; badge expiry; loan vs slot open-hours logic; weekly-hours boundary (exactly at the cap)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |                                       ✅ `test/engines/eligibility.test.js`                                       |
| `engines/stateMachine` (unit) | Every illegal transition is rejected; a reason is required where specified; check-in time window                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |                                      ✅ `test/engines/stateMachine.test.js`                                       |
| Bookings API                  | Ineligible request → 422 with checklist; **two concurrent requests for the last slot → exactly one `pending`, one `waitlisted`**; reject → waitlist promotion; cancel by member; manager of another unit → 403                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |              ✅ `test/integration/bookingService.test.js` (the race), `test/routes/bookings.test.js`              |
| Sweeper                       | No-show after grace → `no_show` plus promotion; overdue → flag plus system incident; running twice changes nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |                        ✅ `test/jobs/sweeper.test.js`, `test/integration/sweeper.test.js`                         |
| Auth                          | Non-`nitjsr.ac.in` email → 400; wrong OTP 5 times → OTP invalidated; refresh rotation and reuse detection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |      ✅ `test/services/authOtp.test.js`, `test/integration/authService.test.js`, `test/routes/auth.test.js`       |
| Rate limits                   | 6th failed login for one email → 429 with `Retry-After`; **a different email from the same IP is unaffected** until that IP's coarse ceiling (100 failures in 15 min), and a login the ceiling refuses doesn't count against the account; a forged `X-Forwarded-For` entry gets no fresh counter, and IPv6 is counted per /56; behind Vercel and Render (the hop count `render.yaml` ships), one visitor's failures, demo logins or code requests don't lock out another behind the same Vercel address, and a direct caller who forges a visitor's address gets a counter of their own; one network's 50 code emails a day used up → that network gets 429 `otpSendIp` on register and resend-otp and an unverified login sends no code, while other networks sign up; a demo role used up from one network still signs in from another, under the role-wide ceiling; code-email cap used up → register and resend-otp 503 for every address with nothing written or sent, login 403 without a code |                        ✅ `test/middleware/rateLimit.test.js`, `test/routes/auth.test.js`                         |
| AI quota                      | 6th AI call in a day → 429 `AI_QUOTA_EXCEEDED`; cache hit doesn't consume quota; Redis down → AI disabled, normal search OK                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 🟡 The quota service is tested (`test/services/aiQuotaService.test.js`); there is no AI search to test end to end |
| Golden path (e2e API script)  | The full lifecycle with the seeded demo users; run against the deployed URL before submission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |   ✅ `npm run golden-path [url]` (`scripts/golden-path.mjs`), also run in `test/integration/goldenPath.test.js`   |

---

## 11. Third-party packages (to disclose in the submission)

| Purpose      | Packages (planned)                                                                                                                                                                                                                                                                                                                                             | Installed (`server/package.json`, 29 Oct 2026)                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Core (MVP)   | `express`, `mongoose`, `ioredis` (5.x: `ioredis-mock` doesn't support 6 yet), `zod`, `jsonwebtoken`, `bcryptjs`, `cookie-parser`, `helmet`, `cors`, `express-rate-limit`, `multer`, `file-type`, `cloudinary`, `nodemailer`, `node-cron`, `pino`, `pino-http`, `sanitize-html`. IST dates use the built-in `Intl` (IST has no DST), so there's no date library | All of them except **`zod`** and **`sanitize-html`**, which aren't used. Also `dotenv`. Versions: Express 5, Mongoose 9, ioredis 5   |
| Dev          | `ioredis-mock`, `supertest`, `pino-pretty`, `eslint`, `prettier`; tests use the built-in `node:test`                                                                                                                                                                                                                                                           | `ioredis-mock` and `pino-pretty` only. No `supertest` (route tests use `fetch`), and no `eslint` or `prettier` in the server package |
| Cool-to-have | `@google/genai`, `bullmq`, `@bull-board/express`, `socket.io`, `@socket.io/redis-adapter`, `pdfkit`, `ics`                                                                                                                                                                                                                                                     | None                                                                                                                                 |
