# CampusCommons: Backend Plan

> Node.js 22 · Express · MongoDB (Mongoose) · Redis (ioredis) · Zod · JWT · Cloudinary · Nodemailer · node-cron · pino
>
> System-level design (routes, Redis keys, rate limits, logging, deployment) is in [`architecture.md`](./architecture.md). This doc covers **what the backend builds**, **in what order**, and **how the core logic works**.

---

## Rating legend

| Scale | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **Wow**: how much it impresses a judge | Expected plumbing | Nice to have | Noticeable | Memorable | Standout |
| **Difficulty**: effort for one developer | < 1 h | 1–3 h | 3–6 h | 6–10 h | > 10 h |

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
3. **Every important mutation is audited.** It goes through `auditService.record()` inside the service layer, never in controllers, so nothing is forgotten.
4. **Validate at the edge, trust nothing.** A Zod schema on every route, and Mongoose validators as a second layer.
5. **Humans decide; the system explains.**
   - Automated checks may *block* a request (with a reason and a fix) or *suggest* an action.
   - Rejections, penalties, suspensions and incident outcomes always need a human actor and a written reason.
6. **Fail safely.**
   - The cache and rate limiter fail **open** if Redis is down.
   - The booking lock and AI quota fail **closed**.

---

## 2. MVP (P0): the basic product

### 2.1 MVP definition
> A **verified NIT Jamshedpur member** can find a resource, see exactly which requirements they meet, request a time slot, and (once a manager of the owning unit approves) check in and check out with condition photos.
>
> The manager confirms the return or flags damage, which opens an incident that a human resolves.
>
> Both sides, and the admin, can see a complete, append-only history of every decision.

**In the MVP:**
- `@nitjsr.ac.in` sign-up with an email OTP, and an ID card checked by an admin.
- One eligibility engine.
- One booking state machine.
- A FIFO waitlist.
- Weekly fair-usage caps.
- A cron sweeper for reminders, no-shows and overdue returns.
- In-app and email notifications.
- An audit log.
- Per-user rate limits.
- Caching.
- Seeded demo data.

**Not in the MVP** (see §3):
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

| ID | Feature | Lifecycle step | Wow | Diff | Notes |
|---|---|---|:-:|:-:|---|
| B-01 | Domain-restricted registration + email OTP | — | 2 | 2 | `ALLOWED_EMAIL_DOMAINS=nitjsr.ac.in`; OTP hashed in Redis, 10 min TTL, max 5 tries |
| B-02 | Email-pattern affiliation hints | — | 3 | 1 | `2024ugcs999@` → UG, 2024, CSE. Hints only; unknown formats fall back to the user choosing |
| B-03 | ID-card upload + admin verification queue | — | 3 | 2 | Cloudinary `authenticated` storage, 5-min signed view URL, audited views, image deleted after the decision |
| B-04 | JWT auth (15-min access, rotating refresh) + demo-login | — | 1 | 2 | Refresh `jti` allow-listed in Redis with reuse detection; `demo-login` only when `DEMO_MODE=true` |
| B-05 | RBAC + OrgUnit scope middleware | 5, 6 | 1 | 2 | `requireRole()`, `requireVerified()`, `loadAndAuthorize(model, policy)` |
| B-06 | Zod validation middleware + error envelope | all | 2 | 2 | `validate({ body, params, query })`; `AppError` class; field-level 400s |
| B-07 | OrgUnits + resource CRUD | 1 | 2 | 3 | Availability (weekly hours + blackouts), eligibility rules, limits, `quantity`, `bookingMode`, condition checklist, status |
| B-08 | Resource search and filters + Redis cache | 2 | 2 | 2 | Text index; filters for category, unit, member type, date; versioned list cache |
| B-09 | Badges: catalogue, request (with optional evidence), grant | 2, 4 | 2 | 2 | Expiry through `validityDays`; managers grant only their own unit's badges |
| B-10 | **Explainable eligibility engine** + `POST /bookings/check` | 2, 4 | **4** | 3 | Returns `[{rule, passed, message, fixHint}]`; the same engine runs inside `POST /bookings` |
| B-11 | Booking state machine (one `transition()` function) | 3–8 | 3 | 3 | Guards, allowed roles, required reasons, side effects (audit, notify, promote) |
| B-12 | Double-booking prevention | 3, 6 | 3 | 2 | Redis `SET NX PX` lock per resource, plus an overlap and capacity check |
| B-13 | Fair-usage caps | 4, 6 | 3 | 2 | Weekly hours per resource and max active bookings; part of the eligibility engine |
| B-14 | FIFO waitlist + auto-promotion | 6 | 3 | 2 | On reject, cancel, no-show or expiry, the next eligible waitlisted request moves to `pending` |
| B-15 | Condition reports: check-in, check-out, return confirmation | 7, 8 | 3 | 2 | Checklist items from the resource, up to 3 photos, overall rating |
| B-16 | Incidents + human resolution | 9 | 2 | 2 | Created by the member, by the manager on return, or by the system (overdue); outcome plus rationale required |
| B-17 | `node-cron` sweeper | 9 | 3 | 2 | Every 5 min: reminders, no-show, overdue, expiry of waitlisted and undecided requests; claims each booking before acting, so it's idempotent; Redis-locked, and still runs if Redis is down |
| B-18 | Notifications: in-app + email | 6–9 | 2 | 2 | `notifyService.send(users, event, data)`; email only for key events |
| B-19 | Audit log + booking timeline | 10 | 3 | 2 | Append-only collection; timeline = audit entries plus condition reports merged by time |
| B-20 | Rate limiting keyed by user or email (**never IP**) | — | 2 | 1 | `express-rate-limit` with a small Redis store (`lib/redisRateLimitStore.js`); tiers in `architecture.md` §11 |
| B-21 | pino logging, request IDs, `/health` | — | 1 | 1 | Redaction of secrets and PII |
| B-22 | Seed script (real NIT JSR units, fictional people and inventory) | demo | 2 | 1 | `npm run seed`, idempotent; data in §9 |

**Effort:** about 45 person-hours, which fits two backend developers in hours 4–28 of the timeline.

---

## 3. Cool-to-have features (after MVP freeze)

| ID | Feature | Wow | Diff | Priority | Why it's worth it / notes |
|---|---|:-:|:-:|:-:|---|
| C-01 | **Auto-quarantine on damage** | 3 | 1 | P1 | A `high`-severity damage incident sets the resource to `maintenance` until a manager clears it. Cheap safety win |
| C-02 | **Hash-chained audit log** + `GET /audit/verify` | 4 | 2 | P1 | `hash = sha256(prevHash + canonicalJSON(entry))`; a tamper-evident badge in the admin UI. Strong trust story |
| C-03 | **Smart alternatives on conflict** | 4 | 2 | P1 | When a slot is taken, return the next 3 free slots plus similar resources (same category, user eligible) |
| C-04 | **QR booking pass** + scan endpoint | 4 | 2 | P1 | Signed short-lived token (`bookingId`, `exp`); the manager scans it at handover to check in or out. Feels like a real product |
| C-05 | **Gemini smart search** with a **hard Redis daily quota** | 5 | 3 | P1 | Natural-language query → filters + ranked results with reasons. Lua quota: 5 per user per day, global per-minute and daily caps, cache hits are free, circuit breaker on Gemini 429. **No PII sent.** See `architecture.md` §15 |
| C-06 | **Priority score for contested slots** | 5 | 3 | P1 | Published formula (purpose + fairness bonus − reliability penalty) stored with a breakdown on each booking. Manager sees it as a recommendation and can override with a reason. Big win for fairness points |
| C-07 | Booking extensions | 2 | 2 | P1 | The problem statement lists extensions among audited actions; conflict re-check; manager decides |
| C-08 | Timed waitlist offers | 3 | 2 | P1 | Promoted user has 30 min to accept, otherwise the offer passes on (checked by the sweeper) |
| C-09 | Strikes + reliability score | 3 | 2 | P1 | No-shows and late returns add strikes. At 3 strikes an admin gets a *suggestion* to suspend; never automatic |
| C-10 | Socket.io real-time updates | 3 | 2 | P2 | Rooms `user:{id}` and `resource:{id}`; JWT handshake; replaces 30-s polling |
| C-11 | BullMQ jobs | 2 | 3 | P2 | Delayed jobs at approval time (reminder, no-show check, overdue check), email queue with retries, Bull Board. Needs Redis Cloud or Render Key Value |
| C-12 | WhatsApp notifications | 4 | 3 | P2 | Meta WhatsApp Cloud API. The test number can message up to 5 verified recipients (enough for a demo); business-initiated messages need approved templates; explicit user opt-in with an E.164 phone number |
| C-13 | Training micro-quiz auto-grants low-risk badges | 4 | 2 | P2 | 5 questions with a pass mark of 4; only for badges marked `selfServe` (e.g. "GPU Usage Policy"); high-risk badges still need a manager |
| C-14 | AI incident summary | 3 | 2 | P2 | Neutral summary of the incident thread for the resolver; names and roll numbers replaced with placeholders first |
| C-15 | AI before/after photo comparison | 5 | 4 | P2 | Gemini vision flags visible differences as a *suggestion* on the return-confirmation screen. Equipment photos only |
| C-16 | Analytics aggregation | 4 | 3 | P2 | Utilisation % per resource, **most underused resources**, demand by hour and weekday, no-show rate, **Gini coefficient** of hours |
| C-17 | Incident appeals | 2 | 2 | P2 | Borrower contests an outcome; goes to an admin; full thread audited |
| C-18 | Suspicious-pattern flags | 3 | 3 | P3 | Rule-based: repeated last-minute cancellations, the same people trading slots, frequent overdue returns. Flags for admin review only |
| C-19 | `.ics` calendar feed | 2 | 2 | P3 | Tokenised personal feed for Google Calendar |
| C-20 | Team bookings + group quotas | 2 | 3 | P3 | Club or project teams share one quota so a group can't book in several names |
| C-21 | PDF transaction record | 2 | 2 | P3 | `pdfkit` export of one booking's timeline |
| C-22 | Personal data export and account deletion | 2 | 2 | P3 | Anonymise the user in old audit entries instead of deleting the entries |
| C-23 | Delegate ID verification to department managers | 2 | 1 | P3 | Spreads the admin's workload |
| C-24 | Passwordless OTP login | 2 | 2 | P3 | Also reduces the login-lockout abuse risk |

**Suggested P1 order** (best wow per hour first): C-01 → C-02 → C-03 → C-04 → C-05 → C-06 → C-07 → C-08 → C-09.

---

## 4. Folder structure

```
server/
├── package.json            # "type": "module"; scripts: dev, start, seed, test, lint
├── .env.example
└── src/
    ├── app.js              # express app: middleware order, routers, error handler
    ├── server.js           # connect Mongo + Redis, start HTTP, start cron
    ├── config/
    │   ├── env.js          # Zod-validated process.env (boot fails on bad config)
    │   ├── db.js  redis.js  cloudinary.js  mailer.js
    ├── models/             # User, OrgUnit, Resource, Badge, UserBadge, Booking,
    │                       # ConditionReport, Incident, Notification, AuditLog
    ├── validators/         # auth.js, resources.js, bookings.js, incidents.js, … (Zod)
    ├── middleware/
    │   ├── requestId.js  httpLogger.js  auth.js  rbac.js  validate.js
    │   ├── rateLimit.js  upload.js (multer + file-type)  errorHandler.js
    ├── routes/             # one router per group, mounted under /api/v1
    ├── controllers/        # parse req → call service → send envelope
    ├── services/
    │   ├── authService.js  verificationService.js  resourceService.js
    │   ├── badgeService.js  bookingService.js  waitlistService.js
    │   ├── bookingContext.js (engine inputs)  bookingTransitions.js (apply + audit + notify)
    │   ├── bookingViews.js (conflict groups, timeline text)
    │   ├── orgUnitService.js  access.js (isAdmin, managesUnit, requireAdmin, requireUnitManager, auditRole)
    │   ├── incidentService.js  notifyService.js  auditService.js
    │   ├── cacheService.js  aiQuotaService.js  uploadService.js  mailService.js
    ├── engines/
    │   ├── eligibility.js  # pure: evaluate(user, resource, slot, ctx) → results[]
    │   ├── stateMachine.js # pure: TRANSITIONS map + canTransition()
    │   └── availability.js # pure: openWindows() and busySegments() for the availability grid
    ├── jobs/sweeper.js     # node-cron, every 5 min
    ├── lib/
    │   ├── AppError.js  logger.js  time.js (IST helpers)  emailPattern.js
    │   ├── log.js (logger used by domain modules)  serviceError.js
    │   ├── lock.js (Redis lock + Lua release)  redisKeys.js  redisRateLimitStore.js  sanitize.js
    └── seed/               # index.js + data/*.js
```

---

## 5. Data models

The models are shown as field lists, not final code. All have `timestamps: true`.

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
strikes         Number, default 0                     # used by C-09
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
           evidenceRequired Boolean, selfServe Boolean (C-13)
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
status   enum open|in_review|resolved
comments [{ by, text ≤ 1000, at }]
resolution { outcome enum no_action|warning|repair_required|strike, rationale, decidedBy, at }
aiSummary  { text, generatedAt }      # C-14, suggestion only
```

### Notification
```
user, type (e.g. booking.approved), title, body, link, readAt | null
```
TTL index of 60 days on `createdAt`.

### AuditLog
```
at, actor { id | null, role | "system" }, action ("booking.approved"),
entity { type, id }, orgUnit, reason, changes { field: [before, after] },
requestId, meta
prevHash, hash        # C-02
```
Indexes: `{ 'entity.type': 1, 'entity.id': 1, at: 1 }`, `{ orgUnit: 1, at: -1 }`, `{ 'actor.id': 1, at: -1 }`. `pre` hooks throw on any update or delete.

---

## 6. Core engines

### 6.1 Eligibility engine

`evaluate(user, resource, slot, ctx) → { eligible, outcome, results[] }` is a **pure** function. `ctx` is pre-loaded by the service:
- the user's valid badges
- hours booked this week on this resource
- the user's active booking count on it
- the overlap count for the slot
- the current time in IST

| # | Rule ID | Hard? | Fails when | Example message → fix hint |
|---|---|:-:|---|---|
| 1 | `ACCOUNT_VERIFIED` | ✅ | `verification.status ≠ approved` | "Your ID card isn't verified yet." → "Upload your ID card (Profile → Verification)." |
| 2 | `NOT_SUSPENDED` | ✅ | `suspendedUntil > now` | "Booking paused until 5 Nov: repeated no-shows." → "Contact the admin to appeal." |
| 3 | `RESOURCE_ACTIVE` | ✅ | `status ≠ active` | "This resource is under maintenance." → "See similar resources." |
| 4 | `MEMBER_TYPE` | ✅ | `memberType ∉ eligibility.memberTypes` | "Only PG, Research Scholars and Faculty can book this." |
| 5 | `DEPARTMENT` | ✅ | list non-empty and user's department not in it | "Restricted to ECE and EE students." |
| 6 | `BADGES` | ✅ | any required badge missing or expired | "Missing badge: 3D Printing Basics." → "Request it from the Design and Innovation Centre." |
| 7 | `OPEN_HOURS` | ✅ | slot mode: interval outside weekly hours or in a blackout; loan mode: pickup or return outside hours | "The Central Workshop is open 09:00–17:00, Mon–Sat." |
| 8 | `DURATION` | ✅ | outside `[minDurationMins, maxDurationMins]` | "Maximum booking length is 4 hours." |
| 9 | `BOOKING_WINDOW` | ✅ | `start < now + leadTime` or `start > now + maxAdvanceDays` | "Book at least 2 hours ahead and at most 14 days ahead." |
| 10 | `WEEKLY_HOURS` | ✅ | `hoursThisWeek + duration > maxHoursPerWeek` | "You've used 5 of 6 hours this week on this printer." → "Try next week or a shorter slot." |
| 11 | `ACTIVE_BOOKINGS` | ✅ | `activeCount ≥ maxActiveBookings` | "You already have 1 active booking for this resource." |
| 12 | `AVAILABILITY` | ❌ soft | `overlapCount ≥ quantity` | "This slot is held by an earlier request. Join the waitlist as #2?" |

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
  approve:        { from: ['pending'],              to: 'approved',    by: ['unitManager', 'admin'], reason: false },
  reject:         { from: ['pending'],              to: 'rejected',    by: ['unitManager', 'admin'], reason: true  },
  waitlist:       { from: ['pending'],              to: 'waitlisted',  by: ['unitManager', 'admin'], reason: true  },
  cancel:         { from: ['pending', 'approved', 'waitlisted'], to: 'cancelled', by: ['borrower', 'unitManager', 'admin'], reason: 'ifNotBorrower' },
  promote:        { from: ['waitlisted'],           to: 'pending',     by: ['system'] },
  expire:         { from: ['waitlisted', 'pending'], to: 'expired',    by: ['system'] },  // undecided requests expire at start
  checkIn:        { from: ['approved'],             to: 'checked_in',  by: ['borrower', 'unitManager'], report: 'check_in' },
  markNoShow:     { from: ['approved'],             to: 'no_show',     by: ['system'] },
  checkOut:       { from: ['checked_in'],           to: 'checked_out', by: ['borrower', 'unitManager'], report: 'check_out' },
  confirmOk:      { from: ['checked_out'],          to: 'completed',   by: ['unitManager', 'admin'] },
  confirmIssue:   { from: ['checked_out'],          to: 'flagged',     by: ['unitManager', 'admin'], incident: true },
  closeFlagged:   { from: ['flagged'],              to: 'completed',   by: ['system'] },  // on incident resolution
};
```

`bookingService.transition(bookingId, action, actor, payload)` does five things:
1. Loads the booking.
2. Checks `from`, the actor's relation (`borrower`, `unitManager`, `admin`, `system`), the reason requirement and the time window (check-in is allowed only from 15 min before `start`). A manager can't approve, reject, waitlist or confirm the return of **their own** booking; another manager of the unit or an admin must.
3. Applies the change with a **conditional update**: `findOneAndUpdate({ _id, status: from })`. If a concurrent change already moved the booking, this returns `INVALID_TRANSITION` (409).
4. Calls `auditService.record()`.
5. Calls `notifyService.send()` and, for slot-freeing transitions, `waitlistService.promote()`.

### 6.3 Waitlist promotion

This runs after any transition that frees a slot: `reject`, `cancel` of a slot-holder, `markNoShow`, `expire` of a pending request, and `waitlist`. When a manager moves a pending request to the waitlist, promotion skips that request, or it would come straight back as the oldest. It runs under the resource lock. If the lock can't be taken, the promotion is skipped and logged, and the change that freed the slot still succeeds.

1. Find `waitlisted` bookings for the same resource that overlap the freed interval and haven't started yet, ordered by `createdAt` (FIFO).
2. For each one, re-run the eligibility engine with fresh context: the person may have been suspended or hit a cap since joining. Every hard rule is re-checked except `BOOKING_WINDOW`, because the request was on time when it was made.
3. **Every** request that passes and still fits capacity moves to `pending` (or `approved` if the resource uses auto approval), oldest first. Capacity is the number of units in use at the busiest moment of the slot, recounted after each promotion. Each promotion is audited as `booking.promoted` (actor `system`) and sends a notification: "A slot opened up: your request moved from the waitlist to review."
4. The others stay waitlisted with recalculated positions. **Position = count of earlier waitlisted overlapping requests + 1**, computed on read, never stored.

### 6.4 Sweeper

Covered in [`architecture.md` §14](./architecture.md#14-scheduled-jobs-mvp-node-cron). Each step calls `bookingService.transition()` with actor `system`, so cron-driven changes get the same guards, audit and notifications as human actions.

---

## 7. Validation catalogue

Every route has a Zod schema in `validators/`. The `validate` middleware parses `req.body`, `req.params` and `req.query`, replaces them with the parsed values, and turns `ZodError` into `400 VALIDATION_ERROR` with `details[{ path, message }]`.

**Shared primitives:**

| Primitive | Rule |
|---|---|
| `objectId` | `z.string().regex(/^[a-f\d]{24}$/i)` |
| `campusEmail` | Trimmed, lower-cased, valid email, domain in `ALLOWED_EMAIL_DOMAINS` |
| `password` | `.min(8).max(72)` plus regex for at least one letter and one digit |
| `otp` | `/^\d{6}$/` |
| `safeText(min, max)` | Trimmed, HTML stripped (`sanitize-html` with no allowed tags), length-checked |
| `isoDate` | `z.coerce.date()` |
| `pagination` | `page` int ≥ 1 (default 1); `limit` int 1–50 (default 20) |

**Per-route schemas:**

| Route group | Schema highlights |
|---|---|
| `auth.register` | `name: safeText(2,80)`, `email: campusEmail`, `password` |
| `auth.verifyOtp` / `resendOtp` / `login` | `email: campusEmail` (login also accepts the `.test` demo domain only when `DEMO_MODE`), `otp`, `password: string ≤ 72` |
| `verification.idCard` | `memberType` enum, `department: objectId`; file: jpg/png/webp/pdf, ≤ 5 MB, magic-byte checked |
| `resources.create` / `update` | `title: safeText(3,120)`; `category`, `bookingMode`, `riskLevel` enums; `quantity` int 1–50; `availability.weekly[]` with `day` 0–6 and `HH:mm` times, `open < close`; `blackouts[]` with `start < end`; `slotMinutes` ∈ {15, 30, 60}; `limits` positive ints with `minDuration ≤ maxDuration`, `maxHoursPerWeek ≥ maxDuration/60`; `checklist` 1–10 items of `safeText(2,80)`; `eligibility.memberTypes` non-empty |
| `resources.list` | `q ≤ 100`, `category?`, `orgUnit?: objectId`, `date?: isoDate`, `eligibleOnly?: boolean`, plus pagination |
| `bookings.check` / `create` | `resourceId`, `start`, `end` with `end > start`, both aligned to `slotMinutes`, `start > now`; `purpose: safeText(10,300)`; `joinWaitlist?: boolean`. Resource-specific rules (hours, caps) are enforced by the eligibility engine, not Zod |
| `bookings.reject` / `waitlist` | `reason: safeText(10,500)` (**required**) |
| `bookings.cancel` | `reason: safeText(10,500)`; the service makes it required unless the actor is the borrower |
| `bookings.checkIn` / `checkOut` | `items[]` (labels must match `resource.checklist`), `overall` enum, `notes: safeText(0,1000)`, `photos[]` ≤ 3 `{url, publicId}` from our own Cloudinary folder |
| `bookings.confirmReturn` | `outcome: ok \| issue`; if `issue`, then `incident.{type, severity, description}` is required (`superRefine`) |
| `badges.create` | `name: safeText(2,80)`, `code` `/^[a-z0-9-]{2,40}$/` (lower-cased), `orgUnit: objectId`, `description: safeText(0,500)`, `validityDays` int 1–3650 or `null`, `evidenceRequired?: boolean`. `selfServe` is refused until the quiz (C-13) exists |
| `badges.request` | `note: safeText(0,500)`; multipart `evidence` (jpg/png/webp/pdf, ≤ 5 MB), uploaded first and passed on as `{ publicId }` |
| `badgeRequests.list` | `status?` (a `USER_BADGE_STATUSES` value, default `requested`), `badgeId?: objectId`, plus pagination |
| `badgeRequests.decide` | `decision: approve \| reject`, `reason: safeText(0,500)` (**required** to reject) |
| `badges.grant` | `userId: objectId`, `note: safeText(0,500)` |
| `incidents.create` | `type`, `severity` enums, `description: safeText(20,2000)`, `bookingId?`, `resourceId` |
| `incidents.resolve` | `outcome` enum, `rationale: safeText(10,1000)` |
| `admin.verify` | `decision` enum, `reason: safeText(5,500)` (required when rejecting), `memberType`, `department` |
| `admin.suspend` | `until: isoDate \| null` (must be in the future), `reason: safeText(10,500)` |

**Error handling:**

```js
// lib/AppError.js (illustrative)
class AppError extends Error {
  constructor(status, code, message, details) { super(message); Object.assign(this, { status, code, details }); }
}
// errorHandler: AppError → its status; ZodError → 400; Mongoose CastError → 400;
// duplicate key (11000) → 409; anything else → 500 "Something went wrong" + log stack with requestId
```

---

## 8. Cross-cutting services

### 8.1 `auditService.record({ actor, action, entity, orgUnit, reason, changes, meta })`
- Called **only from services**. It runs after the domain change succeeds, so the log never claims something that didn't happen.
- Writes are awaited, not fire-and-forget: if the audit write fails, the request fails with a 500 and the error is logged.
- `GET /bookings/:id/timeline` merges audit entries for the booking with its condition reports, sorted by `at`, and returns display-ready items such as "Manager (DIC) approved: 'Slot fine, bring your own filament'".

### 8.2 `notifyService.send(userIds, event, data)`
Each event always creates an in-app `Notification`. Email goes out only for the events marked below and only when the user's `notificationPrefs.email` is on. Email is sent after the response, with errors logged and no retry in the MVP; BullMQ adds retries later.

| Event | Recipients | Email? |
|---|---|:-:|
| `auth.otp` | User | ✅ (always) |
| `verification.approved` / `rejected` | User | ✅ |
| `booking.requested` (manual) | Unit managers | — |
| `booking.approved` / `rejected` / `waitlisted` / `promoted` | Borrower | ✅ |
| `booking.cancelled` | Other party | ✅ |
| `booking.expired` | Borrower | ✅ |
| `booking.checked_in` | Managers | — |
| `booking.completed` | Borrower | — |
| `booking.reminder_start` / `reminder_end` | Borrower | ✅ |
| `booking.no_show` | Borrower, managers | — |
| `booking.overdue` | Borrower, managers | ✅ |
| `booking.checked_out` | Managers ("confirm return") | — |
| `incident.created` / `resolved` | Borrower, managers, admins (high severity) | ✅ |
| `badge.requested` | Managers of the issuing unit (not the requester) | — |
| `badge.granted` / `rejected` | User | — |

The mailer never sends to `*.test` addresses (the seeded demo users).

### 8.3 `cacheService`
`getOrSet(key, ttl, loader)`, `del(key)`, `bumpVersion(ns)`. All calls are wrapped in try/catch: on Redis errors they log `warn` and fall through to the loader (fail open).

### 8.4 `uploadService`
`multer.memoryStorage()` with limits (5 MB, 3 files) → magic-byte check (`file-type`) → `cloudinary.uploader.upload_stream` with:
- folder `campuscommons/{kind}`
- random public IDs
- `type: 'authenticated'` for ID cards and badge evidence

Condition photos are resized on upload (Cloudinary transformation, max width 1600 px).

---

## 9. Seed data (fictional people, real unit names)

`npm run seed` is idempotent: it upserts by `code` or `email`.

**OrgUnits:** the 18 units in `architecture.md` §1.2.

**Badges:**

| Badge | Issuer | Validity | Self-serve (C-13) |
|---|---|---|:-:|
| Workshop Safety Induction | Central Workshop | 1 year | — |
| 3D Printing Basics | DIC | 1 year | — |
| Laser Cutter Operation | DIC | 6 months | — |
| GPU Usage Policy | Computer Centre | 1 year | ✅ |
| Electronics Lab Safety | ECE | 1 year | ✅ |
| Survey Instrument Training | Civil | 1 year | — |
| Drone Flight Safety | SAC | 6 months | — |

**Resources** (fictional inventory, plausible for each unit):

| Resource | Unit | Mode / qty | Eligibility | Approval | Limits |
|---|---|---|---|---|---|
| FDM 3D Printer | DIC | slot / 1 | All member types + 3D Printing Basics | manual | max 4 h, 6 h/week, 1 active |
| CO₂ Laser Cutter | DIC | slot / 1 | All + Laser Cutter Operation; risk high | manual | max 2 h, 4 h/week |
| Centre Lathe | Central Workshop | slot / 2 | All + Workshop Safety Induction; risk high | manual | max 3 h, 6 h/week |
| Arc Welding Bay | Central Workshop | slot / 1 | All + Workshop Safety Induction; risk high | manual | max 2 h |
| GPU Workstation | Computer Centre | slot / 2 | All + GPU Usage Policy | **auto** | max 8 h, 16 h/week, 1 active |
| Digital Storage Oscilloscope | ECE | slot / 3 | All + Electronics Lab Safety | **auto** | max 3 h |
| IoT Starter Kit | CSE | **loan** / 5 | All | **auto** | max 3 days, 1 active |
| Total Station | Civil | loan / 1 | PG, RS, Faculty + Survey Instrument Training | manual | max 2 days |
| Optical Microscope | MME | slot / 1 | PG, RS, Faculty | manual | max 3 h |
| Discussion Room A | Central Library | slot / 1 | All | **auto** | max 2 h, 4 h/week |
| DSLR Camera Kit | SAC | loan / 2 | All | manual | max 2 days |
| Camera Drone | SAC | loan / 1 | All + Drone Flight Safety; risk high | manual | max 1 day |
| Meeting Room | CIIC | slot / 1 | All | manual | max 3 h |

**Demo users** (all `@demo.campuscommons.test`, password from the testing instructions):

| Login | Role | Profile | Purpose in the golden path |
|---|---|---|---|
| `student@` | Member | UG, CSE, 2024; verified; has Electronics Lab Safety; **lacks** 3D Printing Basics | Main borrower |
| `student2@` | Member | UG, Mech, 2023; verified; has 3D Printing Basics | Competing request → waitlisted |
| `faculty@` | Member | Faculty, ECE; verified | Shows faculty-only resources |
| `manager@` | Manager | Manages DIC and Central Workshop | Lists, approves, confirms return |
| `admin@` | Admin | Institute admin | Verification queue, incidents, audit |
| `newstudent@` | Member | `verification: pending`, with an obviously fake "SAMPLE" ID image | Fills the admin verification queue |

**Bookings:** about 15 historical and upcoming bookings across every state (`completed`, `flagged` with an open incident, `waitlisted`, `no_show`, `cancelled`, …), so every list and timeline screen has data on first load.

---

## 10. Testing

**Tools:**
- Node's built-in test runner (`node:test` + `node:assert`), so the test files need no test framework. Supertest is added once routes exist.
- **Redis:** `ioredis-mock`, which also runs the Lua scripts, for the lock, cache, rate-limit and AI-quota tests. No Redis server is needed. The one check still worth doing against the real provider (Upstash) is `connectRedis()` plus `pingRedis()`.
- **MongoDB:** the integration tests in `test/integration/` run against a real server. They're skipped unless `TEST_MONGODB_URI` is set. Each file creates its own `campuscommons_test_<random>` database and drops it at the end. Point them at a local or test server, never production.

```
cd server
node --test                                                # everything; integration tests skip without TEST_MONGODB_URI
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 node --test test/integration
```

The `test` script in `package.json` should be `node --test`.

| Layer | Must-have cases |
|---|---|
| `engines/eligibility` (unit) | Each of the 12 rules passes and fails; badge expiry; loan vs slot open-hours logic; weekly-hours boundary (exactly at the cap) |
| `engines/stateMachine` (unit) | Every illegal transition is rejected; a reason is required where specified; check-in time window |
| Bookings API | Ineligible request → 422 with checklist; **two concurrent requests for the last slot → exactly one `pending`, one `waitlisted`**; reject → waitlist promotion; cancel by member; manager of another unit → 403 |
| Sweeper | No-show after grace → `no_show` plus promotion; overdue → flag plus system incident; running twice changes nothing |
| Auth | Non-`nitjsr.ac.in` email → 400; wrong OTP 5 times → OTP invalidated; refresh rotation and reuse detection |
| Rate limits | 6th failed login for one email → 429 with `Retry-After`; **a different email from the same IP is unaffected** |
| AI quota | 6th AI call in a day → 429 `AI_QUOTA_EXCEEDED`; cache hit doesn't consume quota; Redis down → AI disabled, normal search OK |
| Golden path (e2e API script) | The full lifecycle with the seeded demo users; run against the deployed URL before submission |

---

## 11. Third-party packages (to disclose in the submission)

| Purpose | Packages |
|---|---|
| Core (MVP) | `express`, `mongoose`, `ioredis` (5.x: `ioredis-mock` doesn't support 6 yet), `zod`, `jsonwebtoken`, `bcryptjs`, `cookie-parser`, `helmet`, `cors`, `express-rate-limit`, `multer`, `file-type`, `cloudinary`, `nodemailer`, `node-cron`, `pino`, `pino-http`, `sanitize-html`. IST dates use the built-in `Intl` (IST has no DST), so there's no date library |
| Dev | `ioredis-mock`, `supertest`, `pino-pretty`, `eslint`, `prettier`; tests use the built-in `node:test` |
| Cool-to-have | `@google/genai`, `bullmq`, `@bull-board/express`, `socket.io`, `@socket.io/redis-adapter`, `pdfkit`, `ics` |
