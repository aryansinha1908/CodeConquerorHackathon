# CampusCommons API reference

The HTTP API as built. This is the contract the client is written against: when the code and this file disagree, fix one of them. The design rationale lives in `architecture.md` §6; this file is what the routes actually accept and return.

## Conventions

### Requests

- Base path `/api/v1` for every route except `GET /health`.
- JSON bodies need `Content-Type: application/json` and can be at most 100 kB. A larger body gets **413** with code `VALIDATION_ERROR` ("The request body is too large."). Malformed JSON gets `400 VALIDATION_ERROR` "The request body isn't valid JSON." with no `details`.
- Multipart (`multipart/form-data`) routes: `POST /verification/id-card`, `POST /uploads/images`, and `POST /badges/:id/requests` (which also takes JSON).
- Cookies: `/auth/*` uses two httpOnly cookies scoped to `/api/v1/auth` (see [Auth](#auth-auth)). Send requests same-origin or with `credentials: "include"`. The client can't read either cookie.
- `X-Request-Id`: optional request header, 1–128 characters of `A–Z a–z 0–9 _ -`. If it's valid the server reuses it, otherwise it generates one. Every response carries the `X-Request-Id` header and every envelope carries `requestId`.

### Responses

- **Success:** `{ success: true, data, meta?, requestId }`.
  - "list + meta": `data` is an array and `meta` is present.
  - "list (no meta)": `data` is an array and there is no `meta`.
  - Otherwise `data` is an object.
- **Error:** `{ success: false, error: { code, message, details? }, requestId }`. `message` is written for the user.
- **Field errors:** `400 VALIDATION_ERROR` with `details: [{ path, message }]`. `path` takes one of these forms:
  - the field name;
  - `a.b` for a nested key;
  - `list.<i>` for a list entry (`managerIds.1`, `photos.0`, `items.2.note`).
- A body that isn't a JSON object, on a route that needs one, gets 400 with no `details`.
- **Model messages:** some field messages come from the database model, not the service. Examples: "Path \`description\` is required.", "Path \`title\` (\`ab\`) is shorter than the minimum allowed length (3).", "close must be after open", "quantity must be a whole number", "photos can have at most 3 items". The tables say "model messages" where these can appear. Show them beside the field, and never match on their text.
- **Unknown path:** `404 NOT_FOUND` "There's nothing at this address."
- **Unexpected failure:** `500 INTERNAL` "Something went wrong."

### Error codes

| Code | Status | Meaning / what the client does |
|---|---|---|
| `VALIDATION_ERROR` | 400 (413 for a body over 100 kB) | Bad input. Mark the fields named in `details`. |
| `INVALID_OTP` | 400 | Wrong, expired or used code, or a missing or stale sign-up proof (`/auth/verify-otp` only). |
| `UNAUTHENTICATED` | 401 | Missing, bad or expired access token, or a refresh that can't succeed. **The only code to refresh on:** call `POST /auth/refresh` once and retry the request. If the refresh is also 401, show the login page. |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password at login. This is not a session problem, so never refresh on it. |
| `FORBIDDEN` | 403 | Role, unit scope, ownership or suspension. |
| `EMAIL_NOT_VERIFIED` | 403 | Login with the right password on an unverified account. `details: { email }`. |
| `NOT_FOUND` | 404 | Unknown or malformed id, something hidden from this viewer, or the signed-in user no longer exists ("User not found."). |
| `EMAIL_TAKEN` | 409 | Register with an email that already has a verified account. |
| `INVALID_TRANSITION` | 409 | The current state doesn't allow this, or it changed meanwhile. The message says whether to reload. |
| `SLOT_TAKEN` | 409 | Booking create (with `details: { waitlistPosition }`) or approve. |
| `CONFLICT` | 409 | An unexpected duplicate: "This conflicts with an existing record." |
| `INELIGIBLE` | 422 | Booking create. `details` lists the failed rules. |
| `PASS_EXPIRED` | 400 | `POST /bookings/scan`: the QR pass is older than its 2 minutes. Ask the borrower to open it again. |
| `RATE_LIMITED` | 429 | See [Rate limits](#rate-limits). |
| `AI_QUOTA_EXCEEDED` | 429 | An AI request over a limit. `details: { reason: USER_DAILY\|POOL_DAILY\|GLOBAL_DAILY\|BURST\|GLOBAL_MINUTE, limit, resetsAt, retryAfterSeconds }` and `Retry-After`. Show the message; fall back to the non-AI way (see [AI](#ai-ai)). |
| `INTERNAL` | 500 | — |
| `SERVICE_UNAVAILABLE` | 503 | Redis (codes, refresh, booking create/approve) or Cloudinary is down or not configured, or today's code emails are used up (see [Rate limits](#rate-limits); that one has `details: { retryAfterSeconds }` and `Retry-After`). Retry later. |
| `AI_UNAVAILABLE` | 503 | AI isn't set up (no `GEMINI_API_KEY`), is paused for 10 minutes after Gemini refused for its own rate limit, Redis is down (the quota fails closed), or Gemini couldn't answer. Fall back to the non-AI way. |

### Auth and roles

- **Authorization header:** needed on every route except the public auth routes (`register`, `verify-otp`, `resend-otp`, `login`, `refresh`, `logout`, `demo-config`, `demo-login`) and `GET /health`. Send `Authorization: Bearer <accessToken>`.
  - Header missing: `401` "Sign in to continue."
  - Token bad or expired: `401` "Your session has expired. Sign in again."
- **Freshness:** roles, managed units, verification and suspension are read from the database on every request, never from the token, so a change applies at once.
- **Terms used in the tables:**
  - "manager\*": a user with the `manager` role who manages the owning unit, or an admin.
  - "verified": the ID card is approved (`verification.status === "approved"`).
- **Deleted user:** if the token's user no longer exists, most routes answer `404 NOT_FOUND` "User not found.". `GET /auth/me` answers 401 instead.

### Suspension

- A suspended user is one whose `suspendedUntil` is in the future.
- They get `403 FORBIDDEN` on every POST, PUT and PATCH, except the auth routes and `POST /bookings/check`.
  - Message: "Your account is suspended until 5 Nov 2026, 14:30 IST: <reason>".
  - `details: { suspendedUntil, reason }`. `reason` may be null.
- GET requests still work.
- The check runs after the general rate limit and before everything else.

### Rate limits

| Tier | Limit | Counted per | Routes | What counts |
|---|---|---|---|---|
| `general` | 300 / 5 min | user | Every authenticated route, plus `/auth/refresh` and `/auth/logout` (counted for the refresh cookie's user) | Every request |
| `login` | 5 / 15 min | email | `POST /auth/login` | Responses ≥ 400 only, except `403 EMAIL_NOT_VERIFIED`: the password was right, so it isn't a failed attempt. A login `loginIp` refuses isn't counted here either |
| `loginIp` | 100 / 15 min | client IP | `POST /auth/login`, after `login` | The same failures as `login`, from every account. Only requests `login` let through |
| `register` | 3 / hour | email | `POST /auth/register` | Every request that passes validation |
| `registerIp` | 100 / hour | client IP | `POST /auth/register`, after `register` | Every request that passes validation and `register` |
| `otpSend` and `otpSendDaily` | 3 / 15 min and 10 / day | email | `POST /auth/resend-otp`, and the code `POST /auth/login` emails to an unverified account | Every resend-otp request that passes validation, and every code login would email. Once either is used up, login sends no code (it still answers `403 EMAIL_NOT_VERIFIED`) |
| `otpSendIp` | 50 / day | client IP | `POST /auth/register` after `registerIp`, `POST /auth/resend-otp` after `otpSendDaily`, and the code `POST /auth/login` emails to an unverified account | Every request the tiers before it let through, and every code login would email. One network's share of the code-email cap. Once it is used up, login sends no code (it still answers `403 EMAIL_NOT_VERIFIED`) |
| `otpVerify` | 10 / 15 min | email | `POST /auth/verify-otp` | Every request that passes validation |
| `demoIp` | 60 / 15 min | demo role and client IP | `POST /auth/demo-login` | Every request that passes validation. Judges on other networks are unaffected |
| `demo` | 1000 / 15 min | demo role | `POST /auth/demo-login`, after `demoIp` | Every request that passes validation and `demoIp` |
| `bookingCreate` | 10 / hour | user | `POST /bookings` | Every request past the suspension check, refused ones included |
| `upload` | 20 / hour, shared by its routes | user | `POST /uploads/images`, `POST /verification/id-card`, and `POST /badges/:id/requests` when sent as multipart | Every request that reaches it (each route says where it sits) |
| `fileLink` | 20 / 15 min, shared by its routes | user | `GET /badge-requests/:id/evidence`, `GET /admin/verifications/:userId/id-card`, `GET /admin/verifications/:userId/id-card/file` | Every request past the general tier. Each link costs a Cloudinary API call from a quota every reviewer shares |

- A 429 is `RATE_LIMITED` with `details: { tier, limit, retryAfterSeconds }`. The message says whose limit it is: "…for this account", "…from your network", "This demo account is being used a lot right now".
- A 429 also has `Retry-After`, `RateLimit` and `RateLimit-Policy` headers. Use `details.retryAfterSeconds`, because cross-origin scripts can read only `X-Request-Id`.
- Validation runs before the email and role tiers, so a typo isn't counted. Where two tiers stack, the first one listed runs first, and a request it refuses isn't counted by the second.
- The client IP is every address the trusted proxies forwarded (`TRUST_PROXY_HOPS`, 2 behind Vercel): through the site, the visitor's address and then Vercel's. IPv6 is counted per /56. Through the site, sending `X-Forwarded-For` yourself changes nothing, because Vercel replaces it. Calling the Render URL directly, what you send only ever gets you a fresh counter, never someone else's.
- **Code emails:** at most 50 a day per network (`otpSendIp`, a 429), and at most 250 in any 24 hours to everyone together. Once the 250 are used up:
  - `POST /auth/register` and `POST /auth/resend-otp` answer **503 `SERVICE_UNAVAILABLE`** "We've reached today's limit for emailing codes, so no code was sent. Try again in 3 hours." with `details: { retryAfterSeconds }` and `Retry-After`. Show the message. Nothing is created or changed, so the last code sent still works.
  - resend-otp answers this for every address, existing or not.
  - `POST /auth/login` on an unverified account still answers `403 EMAIL_NOT_VERIFIED`, with "Verify your email first. Enter the last code we sent to your inbox, or ask for a new one later." and no new code.
- While Redis is down, no limit is enforced (the code routes answer 503 anyway).
- `GET /auth/demo-config` and `GET /health` have no limit.
- The AI routes also have their own daily quota, which isn't a rate-limit tier: see [AI](#ai-ai).

### Values

- **Ids:** 24-character hex strings, either case.
  - A malformed id in a path gets 404, the same as an unknown one.
  - A malformed id in a query or body gets 400 "Must be a valid id.".
- **Dates and times:**
  - Responses carry ISO 8601 strings in UTC.
  - Request instants are ISO strings. A JSON body may also send epoch milliseconds as a number; a query string may not.
  - Opening hours (`HH:mm`), weeks (Mon–Sun) and calendar dates (`YYYY-MM-DD`) are in IST. Show everything in IST.
- **Text:** inputs are trimmed, and a blank value counts as not sent.
- **Booleans in a query:** only `true` or `false`.
- **Paging:** `page` is a whole number 1–10000 (default 1). `limit` is a whole number ≥ 1 (default 20); values over 50 become 50.
  - `meta: { page, limit, total }`. `limit` is the value actually used.
  - Errors: `page` "Must be a whole number from 1 to 10000.", `limit` "Must be a whole number above 0.".
- **Repeated query keys:** refused with a 400 on that key, except where a route says the key takes a list. A repeated `includeInactive` on `GET /org-units` just doesn't count as `true`.
- **References:** each shape below says which references come populated as objects. Every other reference is a bare id string.
- **`__v`:** MongoDB's version key also appears on objects returned as stored. Ignore it. It appears on:
  - every Booking object;
  - the unit from `POST/PATCH /org-units` and `PUT /org-units/:id/managers`;
  - the badge from `POST /badges`;
  - the incident from confirm-return.

## Auth (`/auth`)

### Cookies

| Cookie | Set by | Attributes | Lifetime | Cleared by |
|---|---|---|---|---|
| `refreshToken` | verify-otp, login, refresh (rotated on every use), demo-login | httpOnly, `SameSite=Strict`, `Path=/api/v1/auth`, `Secure` in production | 7 days | logout (always); refresh when it answers 401 |
| `signupProof` | register; a login that answers `403 EMAIL_NOT_VERIFIED` | same as `refreshToken` | 1 day | a successful verify-otp |

- `refreshToken` is the session credential for `/auth/refresh` and `/auth/logout`.
- `signupProof` ties the code entry to the browser that registered, or that logged in with the right password. `verify-otp` refuses a code without it.
- If Redis can't store a new session, the session answer comes **without** `refreshToken`. The access token then works for its 15 minutes, and the next refresh is 401.

### Session and user view

- **Session** (the `data` of verify-otp, login, refresh and demo-login): `{ accessToken, user }`.
  - Sent with `Cache-Control: no-store`.
  - Sets the `refreshToken` cookie.
- **`accessToken`:** a JWT (HS256) that expires after 15 minutes. Keep it in memory only.
  - Claims: `{ sub (user id), roles, memberType, managedOrgUnits, verified, iat, exp }`.
  - The claims are a snapshot. Use `GET /auth/me` for current values.
- **User view** (`user` in a session, and `GET /auth/me`): `{ _id, name, email, roles: ["member"|"manager"|"admin"], memberType: ug|pg|rs|faculty|staff|null, department: { _id, code, name } | null, managedOrgUnits: [orgUnitId], emailVerified, verification: { status: unsubmitted|pending|approved|rejected, reason|null, submittedAt|null }, strikes, suspendedUntil|null, suspensionReason|null, emailHints: { year, level: ug|pg|rs, branch, serial } | null }`.
  - `emailHints` is parsed from a roll-number email such as `2024ugcs999@nitjsr.ac.in`. It is only for pre-filling the ID-card form.

### Routes

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| POST | `/auth/register` | public | body `{ name, email, password }` | **201** `{ email, otpSent: true }`. Sets `signupProof`. A 6-digit code is emailed; it expires in 10 minutes. Registering an unverified email again replaces its name and password and sends a new code | 400 (`name`, `email`, `password`); 409 `EMAIL_TAKEN` "An account with this email already exists. Sign in instead."; 429 `register`, `registerIp` or `otpSendIp` "Too many verification codes asked for from your network today. Try again in 1 day."; 503 "We can't send or check codes right now. Try again in a minute." (nothing is created) |
| POST | `/auth/verify-otp` | public, with this browser's `signupProof` cookie | body `{ email, otp }` (`otp`: the 6 digits as a string) | Session. The email is now verified, and `signupProof` is cleared | 400 `VALIDATION_ERROR` (`email`; `otp` "Required." / "Must be the 6-digit code."); 400 `INVALID_OTP` (messages below); 429 `otpVerify`; 503 |
| POST | `/auth/resend-otp` | public | body `{ email }` | `{ sent: true, retryAfter: 60 }` for every address. Only an existing unverified account gets a code. A new code replaces the old one and resets its tries. Wait `retryAfter` seconds before offering "resend" again | 400 `email`; 429 `otpSend`, `otpSendDaily` or `otpSendIp`; 503 |
| POST | `/auth/login` | public | body `{ email, password }` | Session | 400 (`email`, `password`); **401 `INVALID_CREDENTIALS`** "That email and password don't match an account." (unknown emails too); **403 `EMAIL_NOT_VERIFIED`** "Verify your email first. We've sent a 6-digit code to your inbox." with `details: { email }`, which also sets `signupProof` and emails a fresh code unless one went out in the last 60 s, or the address has used up `otpSend` or `otpSendDaily`, or the network `otpSendIp` (a code emailed here counts against all three). Then nothing is sent and the message is "Verify your email first. Enter the last code we sent to your inbox, or ask for a new one later." Either way, go to the code screen and call verify-otp; 429 `login`; 503 (only for an unverified account while Redis is down) |
| POST | `/auth/refresh` | holder of the `refreshToken` cookie; no Authorization header | none | Session; the cookie is rotated | **401 `UNAUTHENTICATED`**, which also clears the cookie, so show the login page. Reasons: no, bad or expired cookie, logged out, or deleted user: "Your session has ended. Sign in again."; reused cookie: "Your session was ended for your security. Sign in again."; demo account while demo mode is off: "Demo accounts are switched off. Sign in again." Also 429 `general`; **503** "Sign-in is briefly unavailable. Try again in a minute.", which keeps the cookie, so retry later |
| POST | `/auth/logout` | anyone; no Authorization header needed | none | `{ loggedOut: true }`, always. Ends this cookie's session and clears the cookie | 429 `general` only |
| GET | `/auth/me` | signed-in user | — | User view | 401 (bad token; "Your account no longer exists."; "Demo accounts are switched off. Sign in again."); 429 |
| GET | `/auth/demo-config` | public | — | `{ demoMode: boolean, roles }`. `roles` is `["student", "student2", "faculty", "manager", "admin"]` while demo mode is on, `[]` otherwise | none |
| POST | `/auth/demo-login` | public, only while `DEMO_MODE=true` | body `{ role }` (one of `roles` above) | Session as the seeded `<role>@demo.campuscommons.test` | 404 `NOT_FOUND` (demo mode off: "There's nothing at this address."; not seeded: "The demo accounts haven't been created yet. Run npm run seed."); 400 `role` "Required." / "Must be one of: student, student2, faculty, manager, admin."; 429 `demo` |

**Field rules**

- **`email`:** required text, trimmed and lower-cased, ≤ 254 characters. It must be a valid address on an allowed domain (`ALLOWED_EMAIL_DOMAINS`, default `nitjsr.ac.in`).
  - Messages: "Required.", "Must be text.", "Must be a valid email address.", "Use your college email (@nitjsr.ac.in)."
  - Demo domain on register, verify-otp and resend-otp: "Demo accounts can't sign up or get codes."
  - Demo domain at login: accepted while demo mode is on, otherwise "Demo accounts are switched off."
- **`name`** (register): 2–80 characters on one line.
  - Messages: "Required.", "Must be text.", "Must be at least 2 characters.", "Can be at most 80 characters.", "Can't contain line breaks or control characters."
- **`password`** (register): 8–72 characters and at most 72 bytes, with at least one letter and one digit.
  - Messages: "Required.", "Must be text.", "Must be at least 8 characters.", "Can be at most 72 characters (accented letters and emoji count as more than one).", "Must contain at least one letter and one digit."
  - At login the password is only checked for "Required.", "Must be text." and "Can be at most 72 characters."
- **`INVALID_OTP` messages:**
  - "That code is wrong. You have N tries left."
  - "That code is wrong, and it can't be used any more. Request a new code." (the 5th wrong try deletes the code)
  - "This code has expired or was already used. Request a new code."
  - "This code is for a sign-up made in another browser, or one changed since. Sign in, or sign up again, here to get a new code." (`signupProof` is missing or stale; the code is used up)

**Notes**

- **Sign-up flow:** register, then the code screen, then verify-otp, which signs the user in.
- **Unverified user coming back later:** login answers 403 `EMAIL_NOT_VERIFIED`; go to the code screen, then verify-otp.
- **Suspension:** suspended users can still sign in, refresh and read.
- **Concurrent refreshes:** two tabs that refresh with the same cookie within 30 s both succeed. A cookie used again after that ends its session.
- **Demo mode switched off:** a demo session's `/auth/me` and next refresh answer 401. Its access token keeps working on other routes until it expires, at most 15 minutes.

## Verification and uploads

**Status view** (`GET /verification/status`, `POST /verification/id-card`):

`{ status: unsubmitted|pending|approved|rejected, reason: string|null (why it was rejected), submittedAt|null, reviewedAt|null, memberType|null, department: { _id, code, name } | null, hasIdCard: boolean }`

The card file itself is never exposed to its owner.

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| POST | `/verification/id-card` | signed-in user, not suspended, whose status is `unsubmitted`, `pending` (the new card replaces the old one) or `rejected` | multipart with:<br>file `idCard`: one JPG, PNG, WebP or PDF of at most 5 MB, type read from the bytes;<br>text `memberType`: ug\|pg\|rs\|faculty\|staff;<br>text `department`: the id of an active org unit from `GET /org-units`;<br>text `ocrCheck?` (≤300 characters, before the file): the on-device check's answers as JSON, `{"v":1,"checks":{"institute":true,"rollNumber":true,"name":false,"year":true}}`, booleans only. The server decides which checks count (institute and year always; the roll number when the email is one; the name when it has a word of 3+ letters): a missing one counts as not found, an extra one is dropped. Without it, an earlier card's check is cleared | **201** status view: `status: "pending"`, `submittedAt` now, `reason` and `reviewedAt` null | In order:<br>403 suspended;<br>503 "Uploads aren't configured." (before the body is read);<br>429 `upload`;<br>400 [multipart errors](#multipart-errors) on `idCard`;<br>404 user;<br>409 "Your ID card is already verified.";<br>400 `memberType` "Required." / "Must be one of: ug, pg, rs, faculty, staff.";<br>400 `department` "Required." / "Must be a valid id." / "No such unit." / "This unit is inactive.";<br>400 `ocrCheck` "Must be the device check's answers." (any other shape; nothing is uploaded);<br>400 `idCard` "Attach a photo or PDF of your ID card." / "Must be a JPG, PNG, WebP or PDF file." / "This file couldn't be read. Is it damaged?";<br>503 "The upload didn't go through. Try again in a minute.";<br>409 "Your verification changed while you were uploading. Reload and try again."<br>(403 `EMAIL_NOT_VERIFIED` exists but can't be reached by a signed-in user) |
| GET | `/verification/status` | signed-in user | — | Status view | 404 user |
| POST | `/uploads/images` | verified user, not suspended | multipart: 1–3 files in field `images`, each a JPG, PNG or WebP of at most 5 MB | **201** list (no meta) of `[{ url, publicId }]`, in the order sent. Photos are public and resized to at most 1600 px wide | In order:<br>403 suspended;<br>503 "Uploads aren't configured.";<br>404 user;<br>403 "Your ID card must be verified before you can upload photos.";<br>429 `upload`;<br>400 [multipart errors](#multipart-errors);<br>400 `images` "Attach 1 to 3 photos.";<br>400 `images.<i>` "Must be a JPG, PNG or WebP file.";<br>400 `images` "This file couldn't be read. Is it damaged?";<br>503 "The upload didn't go through. Try again in a minute." (if one file fails, none is kept) |

**Using photos.** Check-in, check-out, confirm-return and `POST /incidents` take `photos?`, and `POST/PATCH /resources` take `images`: each `{ url, publicId }` exactly as `POST /uploads/images` returned it. A URL changed in any way (a transformation, query, fragment, other path or version) gets 400 `photos.<i>` (`images.<i>` for a resource) "Must be a photo uploaded through /uploads/images." A non-list `photos` gets 400 `photos` "Must be a list." While Cloudinary isn't configured, no photo is accepted.

The URL form is `https://res.cloudinary.com/<cloud>/image/upload/v<version>/<publicId>.<ext>`.

### Multipart errors

These apply to all three upload routes. All are `400 VALIDATION_ERROR`.

| `path` | Message | When |
|---|---|---|
| the file field | "Each file can be at most 5 MB." | A file is too big |
| the file field | "Attach at most N files." ("1 file" when N is 1) | Too many files |
| the other field's name | `Send the file as "<field>".` | A file was sent under another field name |
| the text field's name | "Too long." | A text field is over 1024 bytes (2000 bytes for the badge `note`) |
| the file field | "The upload couldn't be read. Try again." | The multipart body is broken |
| the file field | "This form couldn't be read." | Too many parts or fields |

A JSON request to one of these routes is read as having no file.

## Org units (`/org-units`)

**Unit** (from POST, PATCH and PUT): `{ _id, name, code, type: department|centre|central_facility, location?: { building?, notes? }, managers: [userId], isActive, createdAt, updatedAt, __v }`.

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| GET | `/org-units` | any signed-in user | query `includeInactive=true` (only the exact string `true` counts; anyone may send it) | list (no meta) of `{ _id, name, code, type, location?, isActive }`, sorted by name. Admins also get `managers: [userId]` | 404 user |
| POST | `/org-units` | admin | body `{ name (2–120), code (2–20 of a–z, 0–9 and -; lower-cased), type, location?: { building? (≤120), notes? (≤300) }, isActive? (default true) }`. Any other key is refused | **201** unit with `managers: []` | 400:<br>`code` "Already used by another org unit.";<br>an unknown key "This field can't be set." (`managers`: "Managers are assigned separately.");<br>`location` "Must be an object.";<br>model messages for `name`, `code`, `type`, `location.*`, `isActive`;<br>a non-object body "Expected an object of org unit fields." (no details).<br>403 "Only an admin can manage org units.", or suspended |
| PATCH | `/org-units/:id` | admin | body: any of `{ name, type, location (replaced whole; null clears it), isActive }`. Resending the current `code` is allowed | Unit, as it was if nothing changed | 403; 404 "Org unit not found."; 400 (`code` "An org unit's code can't change."; `managers`; the rest as POST) |
| PUT | `/org-units/:id/managers` | admin | body `{ managerIds: [userId] }`, at most 50 distinct ids. Replaces the whole list. Listed users get the `manager` role and the unit. Removed users lose the unit, and lose the role once they manage no unit. Sending the same list again repairs a sync that failed part-way | Unit with its new `managers` | 403; 404; 400:<br>`managerIds` "Must be a list of user ids." / "At most 50 managers.";<br>`managerIds.<i>` "Must be a valid id." / "No user has the id <id>.".<br>**409 `INVALID_TRANSITION`** "Someone else changed this unit's managers. Reload and try again." |

A manager's new role and units apply to every route at once, because roles are read from the database. They reach the access token's claims at its next refresh.

## Resources (`/resources`)

**Card** (an item from `GET /resources`):

`{ _id, title, slug, description?, images: [{ url, publicId }], category: space|equipment|computing|tool, bookingMode: slot|loan, quantity, riskLevel: low|medium|high, location?: { building?, room?, floor? }, status: active|maintenance|archived, availability: { weekly: [{ day (0 = Sun … 6 = Sat), open: "HH:mm", close: "HH:mm" }], slotMinutes: 15|30|60 }, eligibility: { memberTypes: [ug|pg|rs|faculty|staff], departments: [{ _id, code, name }], badges: [{ _id, name, code, orgUnit: { _id, name } }], approvalMode: manual|auto }, limits?: { minDurationMins?, maxDurationMins?, maxHoursPerWeek?, maxActiveBookings?, leadTimeMins?, maxAdvanceDays? }, orgUnit: { _id, name, code, type }, openHours, createdAt, updatedAt }`

- `openHours` reads like "Mon–Fri 09:00–17:00; Sat 09:00–13:00", or "closed all week".
- An empty `memberTypes`, `departments` or `badges` list means no restriction.

**Detail** (`GET /resources/:id` and every write): the card plus `usageRules?`, `checklist: [string]`, `availability.blackouts: [{ _id, start, end, reason? }]` and `canManage: boolean`.

**Listing form** (the body of POST and PATCH):

| Field | Rules |
|---|---|
| `orgUnit` | POST only, required. A unit you manage (admins: any) that exists and is active |
| `title` | Required, 3–120 |
| `category` | Required: space \| equipment \| computing \| tool |
| `description`, `usageRules` | ≤ 2000 each |
| `images` | ≤ 5 `{ url, publicId }`, each exactly as `POST /uploads/images` returned it (see [Using photos](#verification-and-uploads)) |
| `bookingMode` | `slot` (default; the whole interval inside one opening window) \| `loan` (pickup and return inside opening hours) |
| `quantity` | Whole number 1–50, default 1: identical units bookable in parallel |
| `riskLevel` | `low` (default) \| `medium` \| `high` |
| `location` | `{ building ≤120, room ≤60, floor ≤20 }` |
| `availability` | `{ weekly: [{ day 0–6, open, close }], blackouts: [{ start, end, reason? ≤200 }], slotMinutes: 15 \| 30 (default) \| 60 }`. Times are `HH:mm` IST, and `close` must be after `open`. A blackout's `end` must be after its `start` |
| `eligibility` | `{ memberTypes: [...], departments: [orgUnitId], badges: [badgeId], approvalMode: manual (default) \| auto }` |
| `limits` | `{ minDurationMins ≥1, maxDurationMins ≥1, maxHoursPerWeek ≥1, maxActiveBookings ≥1, leadTimeMins ≥0, maxAdvanceDays 1–365 }`. Whole numbers. min ≤ max, otherwise `limits.minDurationMins` "Minimum duration can't exceed the maximum" |
| `checklist` | ≤ 10 strings of 2–80 characters. Check-in and check-out reports must cover each one |

- A nested section (`location`, `availability`, `eligibility`, `limits`) sets only the keys it names. `{ limits: { maxHoursPerWeek: 8 } }` keeps the other limits.
- Lists are replaced whole, and `null` clears a list.
- Unknown keys are refused, not dropped.

**Form errors** (400):

- `<field>` "This field can't be set." for an unknown key, `slug` and `createdBy`.
  - `status`: "Change the status with the status action, which asks for a reason."
  - `orgUnit` on PATCH: "A resource can't move to another unit."
- `<section>` "Must be an object."; `<section>.<key>` "This field can't be set."
- `<list>` "Must be a list."; `<list>.<i>` "Must be an object." or "Must be text."
- `images.<i>` "Must be a photo uploaded through /uploads/images." (an entry that isn't an object gets only "Must be an object.")
- `orgUnit` "Required." / "Must be a valid id." / "No such unit." / "This unit is inactive."
- `eligibility.departments.<i>` "Must be a valid id." / "No such department."
- `eligibility.badges.<i>` "Must be a valid id." / "No such badge."
- Model messages for the rest, e.g. `availability.weekly.0.close` "close must be after open".
- A non-object body: "Send the resource's fields as an object." (no details).

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| GET | `/resources` | any signed-in user | query:<br>`q` (≤100; text search on title and description);<br>`category`;<br>`orgUnit` (id);<br>`memberType` (resources open to that member type, unrestricted ones included);<br>`date` (IST `YYYY-MM-DD`: resources with opening hours on that weekday);<br>`status` (one, a comma list or a repeated key of active\|maintenance\|archived; default `active`);<br>`page`, `limit`;<br>`eligibleOnly` (`true`/`false`) | list + meta of cards, sorted by title (by relevance with `q`). `meta: { page, limit, total }`.<br>With `eligibleOnly=true`: only the resources whose no-slot member rules the viewer passes, taken from the first 200 matches. `meta` then also has `capped` (true when more than 200 matched) | 400:<br>`q` "Must be text." / "Can be at most 100 characters.";<br>`category`, `memberType` "Must be one of: …";<br>`orgUnit` "Must be a valid id.";<br>`date` "Must be a date as YYYY-MM-DD.";<br>`status` "Must be one or more of: active, maintenance, archived.";<br>`eligibleOnly` "Must be true or false.";<br>paging.<br>403 "Only managers can list resources that aren't active." / "You can only list your own units' resources that aren't active.";<br>404 user |
| GET | `/resources/:id` | any signed-in user | — | Detail | 404 "Resource not found." (unknown, malformed, or archived for anyone who doesn't manage the unit) |
| POST | `/resources` | a manager of `orgUnit`, or an admin | body: the listing form | **201** detail (`canManage: true`) | 400 form errors; 403 "Only this unit's managers can list resources for it." (checked before the unit is looked up), or suspended |
| PATCH | `/resources/:id` | manager\* | body: any listing-form field except `orgUnit` and `status` | Detail (`canManage: true`). A patch that changes nothing is still validated | 404 (unknown, or archived and you don't manage it); 403 "Only this unit's managers can edit it.", or suspended; 400 form errors |
| PATCH | `/resources/:id/status` | manager\* | body `{ status: active\|maintenance\|archived (required), reason (required unless status is active, ≤500) }` | `{ resource: detail, affectedBookings: number }`. Nothing is cancelled. `affectedBookings` counts the pending, approved and checked-in bookings that haven't ended, so the screen can warn. Sending the current status changes nothing | 404; 403 "Only this unit's managers can change its status."; 400 `status` "Required." / "Must be one of: active, maintenance, archived."; 400 `reason` "Say why, so members and the audit log know." / "Can be at most 500 characters." / "Must be text."; 409 `INVALID_TRANSITION` "The status changed while you were saving. Reload and try again." |
| GET | `/resources/:id/availability` | any signed-in user | query `from`, `to` (both required; `to` after `from`; at most 14 days apart) | `{ quantity, openWindows: [{ start, end }], busy: [{ start, end, inUse, full }] }`:<br>`openWindows`: the opening hours inside the range, sorted, with blackouts cut out and overlapping windows merged (windows that only touch stay apart);<br>`busy`: runs where `inUse` units are held by pending, approved or checked-in bookings; `full` is `inUse >= quantity`.<br>No borrower data | 404 (unknown, malformed or archived, for everyone, managers included); 400 `from` / `to` "Required." / "Must be a valid date."; 400 `to` "Must be after from." / "The range can be at most 14 days." |
| GET | `/resources/:id/eligibility` | any signed-in user | query `start`, `end` (send both or neither) | **Without a slot:** `{ eligible, results: [{ rule, hard, passed, message, fixHint, meta? }], quota: { hoursThisWeek, maxHoursPerWeek\|null, activeCount, maxActiveBookings\|null } }`. The rules are ACCOUNT_VERIFIED, NOT_SUSPENDED, RESOURCE_ACTIVE, MEMBER_TYPE, DEPARTMENT, BADGES and ACTIVE_BOOKINGS. `quota` covers this resource in the current IST week.<br>**With a slot:** exactly the answer of `POST /bookings/check` | 404 (unknown, or archived unless you manage it); 400 `start` / `end` "Required." (only one sent) / "Must be a valid date." |
| GET | `/resources/:id/bookings` | manager\* | query `status` (one booking status), `from`, `to` (bookings that overlap the range), `page`, `limit` | list + meta of Booking objects sorted by `start`, with `borrower: { _id, name, memberType, department: { _id, code, name } }` (never an email). Every other reference is a bare id | 404; 403 "Only this unit's managers can see its bookings."; 400 `status` "Must be one of: …", `from` / `to` "Must be a valid date.", `to` "Must be after from.", paging |

Once a non-active status is requested from `GET /resources`, a manager's list covers only their own units, active resources included. An admin's list covers every unit.

### AI search

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| POST | `/resources/ai-search` | verified user (or a manager or admin), not suspended | body `{ query }`: 3–200 characters, counted without invisible characters | `{ items: [Card + reason + eligible], quota: { used, limit, remaining, resetsAt } \| null, cached, capped }`:<br>`items`: at most 6 active resources Gemini picked, best first, each a [card](#resources-resources) plus `reason` (≤160 characters, Gemini's; replaced by "Matches your request." when it held a link, an email or a phone number) and `eligible` (whether the viewer passes the member rules that need no time, worked out here, never by the model);<br>`cached`: answered from the 24-hour cache (no request spent; `quota` is then the current one);<br>`capped`: the catalogue had more than 150 active resources, and Gemini saw the first 150 by title | In order:<br>400 a non-object body "Send the question as an object."; `query` "Required." / "Must be text." / "Can be at most 200 characters." / "Describe what you need in at least 3 characters.";<br>503 `AI_UNAVAILABLE` "AI isn't set up on this server yet…" (before anything is spent);<br>404 user;<br>403 "Your ID card must be verified before you can use AI search.", or suspended;<br>503 `AI_UNAVAILABLE` (paused, Redis down, Gemini couldn't answer);<br>429 `AI_QUOTA_EXCEEDED`.<br>On either, show the message and run `GET /resources?q=` with the same words |

**What Gemini receives:** the question and one line per active resource (title, category, unit, building, booking mode, badges needed, a description cut to 180 characters), with emails, roll numbers and phone numbers replaced by placeholders in both. Nothing about the viewer. The cache key is that exact text, so editing a resource, a unit or a badge asks again.

## Badges (`/badges`) and badge requests (`/badge-requests`)

**Badge** (an item from `GET /badges`): `{ _id, name, code, orgUnit: { _id, name, code, isActive }, description?, validityDays: number|null (null = never expires), evidenceRequired, selfServe }`.

**Member row:** `{ _id, badge: { _id, name, code, orgUnit: { _id, name, code }, validityDays, evidenceRequired, selfServe }, status: requested|active|rejected|revoked, state: requested|active|expired|rejected|revoked, note, reason, requestedAt, decidedAt, expiresAt }` plus `hasEvidence`. Fields that aren't set are null.

- Show `state`, not `status`: "expired" exists only in `state`.

**Queue row:** the member row plus `user: { _id, name, memberType, department: { _id, code, name } }`, `decidedBy: { _id, name } | null` and `evidence: { publicId } | null`.

- The evidence is a private Cloudinary file. `evidence.publicId` opens nothing by itself: ask `GET /badge-requests/:id/evidence` for a link each time it is shown.

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| GET | `/badges` | any signed-in user | query `orgUnit?` (id) | list (no meta) of badges, sorted by name. Badges of inactive units are left out | 400 `orgUnit` "Must be a valid id." |
| POST | `/badges` | a manager of `orgUnit`, or an admin | body `{ name (2–80), code (2–40 of a–z, 0–9 and -; lower-cased), orgUnit (id, required), description? (≤500), validityDays? (whole number 1–3650, or null; default null), evidenceRequired? (default false) }`. `selfServe` and any other key are refused | **201** the badge as stored: `{ _id, name, code, orgUnit (id), description?, validityDays, evidenceRequired, selfServe: false, createdAt, updatedAt, __v }` | 400:<br>an unknown key "This field can't be set.";<br>`selfServe` "Self-serve badges come with the training quiz (C-13), which isn't built yet.";<br>`orgUnit` "Required." / "Must be a valid id." / "No such unit." / "This unit is inactive.";<br>`code` "Already used by another badge.";<br>model messages;<br>a non-object body "Send the badge's fields as an object.".<br>403 "Only this unit's managers can create badges for it." (checked before the unit is looked up), or suspended |
| GET | `/badges/mine` | any signed-in user | — | list (no meta) of member rows, most recently changed first | 404 user |
| POST | `/badges/:id/requests` | a verified member, not suspended | either JSON `{ note? (≤500) }`, or multipart with the text field `note` and an optional file `evidence` (one JPG, PNG, WebP or PDF of at most 5 MB; type read from the bytes). Evidence is required when the badge has `evidenceRequired`. It is accepted **only as a file**: an `evidence` value in the JSON or as a text field is 400 | **201** member row (`state: "requested"`, `hasEvidence`) | 400 `evidence`: "This badge needs evidence, such as a training certificate." / "Must be a JPG, PNG, WebP or PDF file." / "This file couldn't be read. Is it damaged?" / 'Attach the evidence as a file in the multipart field "evidence".' / [multipart errors](#multipart-errors).<br>400 `note` "Must be text." / "Can be at most 500 characters." / "Too long.".<br>403 "Your ID card must be verified before you can request badges.", or suspended.<br>404 "Badge not found.".<br>**409 `INVALID_TRANSITION`**: "You've already requested this badge. <unit> will review it." / "You already hold this badge." / "<unit> isn't taking badge requests right now." / "This badge changed while you were saving. Reload and try again.".<br>429 `upload` (multipart only).<br>503 "Uploads aren't configured." / "The upload didn't go through. Try again in a minute." (a file was sent) |
| POST | `/badges/:id/grant` | a manager of the issuing unit, or an admin. Not to yourself unless you are an admin. A demo account (the demo manager and admin included) grants only to demo accounts: a real member answers as an unknown one, by id or by email | body `{ userId \| email, note? (≤500; goes to the audit log only) }`: the member by id, **or** by email (exactly one of the two). The email must match the account's exactly, in any case (`Student@NITJSR.ac.in` finds `student@nitjsr.ac.in`); it isn't a search | **200** queue row: `status: "active"`, `expiresAt` = now + `validityDays` (or null).<br>Works from any state: no row, requested, rejected, revoked, expired, or active with an expiry (which renews it). Regranting a badge that never expires changes nothing | 404 "Badge not found.";<br>403 "Only the issuing unit's managers can grant this badge." / "You can't grant a badge to yourself. Another manager of this unit or an admin must.", or suspended;<br>400 a non-object body "Send the grant as an object.";<br>400 neither sent: both `userId` and `email` "Required." (so a form with either input marks it);<br>400 both sent: `email` "Send either userId or email, not both.";<br>400 `userId` "Must be a valid id." / "No such user." (for a demo account, a real member too);<br>400 `email` "Must be text." / "Can be at most 254 characters." / "No account has this email." (for a demo account, a real member's email too);<br>400 `note` |
| GET | `/badge-requests` | managers (badges of their own units), admins (all). A demo account (the demo manager and admin included) sees only demo accounts' requests | query `status` (requested\|active\|rejected\|revoked, default `requested`), `badgeId?`, `page`, `limit` | list + meta of queue rows. `requested`: oldest request first. Other statuses: newest decision first | 400 (`status` "Must be one of: …", `badgeId`, paging; checked first); 403 "Only unit managers can see badge requests." / "You can only see requests for your units' badges." (also for a `badgeId` that doesn't exist) |
| GET | `/badge-requests/:id/evidence` (`:id` is the queue row's `_id`) | a manager of the issuing unit, an admin, or the member who sent the request. A demo account (the demo manager and admin included) opens only demo accounts' evidence | — | `{ url, expiresAt }`: a signed download link that stops working after 5 minutes (a PDF stays a PDF). Sent with `Cache-Control: no-store`, and every call is audited (`badge.evidence_viewed`). Ask again each time rather than storing it | 404 "Badge request not found." (unknown or malformed id; for a demo account, a real member's request too);<br>403 "Only the issuing unit's managers or the member who sent it can open this evidence.";<br>404 "Evidence not found." (none was sent, a later request came without one, or Cloudinary no longer has it);<br>429 `fileLink`;<br>503 "Uploads aren't configured." / "The file can't be opened right now. Try again in a minute." |
| PATCH | `/badge-requests/:id` (`:id` is the queue row's `_id`) | a manager of the issuing unit, or an admin. Your own request only as an admin. A demo account decides only demo accounts' requests | body `{ decision: approve\|reject (required), reason (required to reject, ≤500) }` | Queue row: `status` `active` with `expiresAt` set, or `rejected` with `reason` | 404 "Badge request not found." (for a demo account, a real member's request too);<br>403 "Only the issuing unit's managers can decide this request." / "You can't decide on your own badge request. Another manager of this unit or an admin must.", or suspended;<br>400 `decision` "Required." / "Must be one of: approve, reject.";<br>400 `reason` "Say why, so the member knows what to do next." / "Can be at most 500 characters." / "Must be text.";<br>400 a non-object body "Send the decision as an object.";<br>**409 `INVALID_TRANSITION`** "This badge has already been granted." / "This request has already been rejected." / "This badge has been revoked." / "This badge changed while you were saving. Reload and try again." (reload) |

Notes on `POST /badges/:id/requests`:

- **When it's allowed:** the member has no row yet, or theirs is rejected, revoked or expired.
- **Replacing:** a new request replaces the earlier note and evidence, and the earlier file is deleted.
- **Order of checks:**
  1. Suspension.
  2. The `upload` tier (multipart only).
  3. Multipart parsing.
  4. The `evidence` text check.
  5. The file's type check and upload (400 or 503).
  6. Badge, ID verification, fields and state.
- **Clean-up:** if the request is refused after the file was stored, the file is deleted again, unless the saved request row already points to it.

## Bookings (`/bookings`)

Who can act on a booking:

- the borrower;
- a unit manager: a user with the `manager` role who manages the booking's unit;
- an admin.

For any action, a status that doesn't allow it is checked before who you are. So an unrelated user can get 409 instead of 403.

**Booking object** (returned by create, the decisions and the handovers, and inside the lists):

`{ _id, resource, orgUnit, borrower, start, end, purpose, status, eligibilitySnapshot: [{ rule, passed, message }], decision?: { action: approve|reject|waitlist, by?, at, reason? }, cancellation?: { by, at, reason? }, checkIn?: { at, by, report }, checkOut?: { at, by, report }, returnConfirmation?: { at, by, outcome: ok|issue, report? }, incidents: [incidentId], flags: { overdue, startReminderAt?, endReminderAt?, overdueAt? }, createdAt, updatedAt, __v }`

- References are bare ids unless a route says otherwise. `report` is a condition report id; the timeline shows its contents.
- An auto-approved booking has `decision: { action: "approve", at, reason: "Auto-approved" }`, with no `by`.

`status` is one of `pending | approved | rejected | waitlisted | cancelled | expired | checked_in | checked_out | completed | flagged | no_show`.

**Eligibility rules**, in this order:

ACCOUNT_VERIFIED, NOT_SUSPENDED, RESOURCE_ACTIVE, MEMBER_TYPE, DEPARTMENT, BADGES, OPEN_HOURS, DURATION, BOOKING_WINDOW, WEEKLY_HOURS, ACTIVE_BOOKINGS, AVAILABILITY.

- Each result is `{ rule, hard, passed, message, fixHint: string|null, meta? }`.
- AVAILABILITY is the only rule with `hard: false`.
- `meta` appears on:
  - WEEKLY_HOURS, always: `{ used, requested, limit|null }`, in hours.
  - ACTIVE_BOOKINGS, when the resource has a limit: `{ used, limit }`.
  - AVAILABILITY, always: `{ taken, quantity, waitlistPosition? }`. `waitlistPosition` is there only when the slot is taken.
  - A failed BADGES: `{ badges: [{ id, name, issue: missing|requested|expired }] }`.
- A resource under maintenance isn't a 404 here: RESOURCE_ACTIVE fails instead.
- An archived resource is **404** "Resource not found." on `/bookings/check` and `POST /bookings`, as on every resource read, except for its unit's managers and admins, for whom RESOURCE_ACTIVE fails. Existing bookings on it can still be cancelled, handed over and returned.

| Method | Path | Who | Input | Returns (`data` / `meta`) | Errors to handle |
|---|---|---|---|---|---|
| POST | `/bookings/check` | any signed-in user. Missing verification and suspension show up as failed rules, not errors. Not blocked for suspended users | body `{ resourceId, start, end }` (instants) | `{ eligible, outcome: "ineligible"\|"slot_taken"\|"pending"\|"approved", results: [12 rules], waitlistPosition: number\|null }`. `waitlistPosition` is set only when `outcome` is `slot_taken`. Nothing is saved | 400 `start` / `end` "Required." / "Must be a valid date." (checked before the resource, so before a 404); 404 "Resource not found." (unknown, malformed or missing `resourceId`, or archived for anyone who doesn't manage its unit) |
| POST | `/bookings` | signed-in member, not suspended. Every hard rule is enforced | body `{ resourceId, start, end, purpose (required, 10–300 after trimming), joinWaitlist? }`. `joinWaitlist` is `true` or `false` (the strings `"true"` and `"false"` are read the same); only `true` joins the waitlist | **201** `{ booking: Booking, evaluation: { eligible, outcome, results }, waitlistPosition: number\|null }`. `booking.status` is:<br>`pending` (manual approval);<br>`approved` (auto approval);<br>`waitlisted` (joined the waitlist on a taken slot; `waitlistPosition` set) | In order:<br>400 the body, every problem at once: `start` / `end` as for `/check`; `purpose` "Required." / "Must be text." / "Must be at least 10 characters." / "Can be at most 300 characters."; `joinWaitlist` "Must be true or false.";<br>404 resource (as for `/check`);<br>**503 `SERVICE_UNAVAILABLE`** "Booking is temporarily unavailable. Please try again in a moment." / "This resource is busy right now. Please try again.";<br>**422 `INELIGIBLE`**, with `details: [{ rule, passed: false, message, fixHint }]` for each failed hard rule;<br>**409 `SLOT_TAKEN`** "This slot is held by an earlier request. You can join the waitlist as #N." with `details: { waitlistPosition }` (offer the waitlist, then resend with `joinWaitlist: true`).<br>Also 403 suspended; 429 `general` / `bookingCreate` |
| GET | `/bookings/mine` | any signed-in user (their own bookings) | query `status?` (one status, a comma list such as `approved,checked_in`, or a repeated key), `page?`, `limit?` | list + meta of Booking objects with `resource: { _id, title, slug, location }`, plus `waitlistPosition` on waitlisted items. Latest start first. `meta: { page, limit, total }` | 400 (`status` "Must be one or more of: …", `page`, `limit`) |
| GET | `/bookings/manage` | a manager (their own units) or an admin (all) | query `status?` (one status), `resourceId?`, `from?`, `to?` (bounds on `start`, as `[from, to)`), `page?`, `limit?` | **Without `status=pending`:** list + meta of Booking objects with `resource: { _id, title, slug, quantity }` and `borrower: { _id, name, memberType, department: { _id, code, name } }` (never an email), earliest start first.<br>**With `status=pending`:** list + meta of conflict groups `{ resource: { _id, title, slug, quantity }, start, end, bookings: [Booking as above] }`:<br>a group chains the pending and waitlisted requests for overlapping times on one resource, and is kept only if it holds a pending one;<br>`bookings` come oldest request first, and waitlisted entries carry `waitlistPosition`;<br>groups are ordered by their oldest pending request;<br>`meta: { page, limit, total, capped }`: `total` counts groups, built from at most the 500 oldest matching pending and waitlisted requests; `capped` is `true` when more than 500 matched, so newer requests aren't in any group yet (say so, and suggest narrowing by `resourceId` or `from` / `to`) | 403 "Only unit managers can see this queue." (checked first); 400 (`status` "Must be one of: …", `resourceId`, `from`, `to`, `page`, `limit`) |
| GET | `/bookings/:id` | the borrower, managers of the booking's unit, admins | — | Booking with `resource: { _id, title, slug, location, bookingMode, checklist }`, `borrower: { _id, name, memberType, department: { _id, code, name } }` (never an email) and `orgUnit: { _id, name, code }`, plus:<br>`allowedActions: []`: the buttons this viewer can use now, by state-machine name: `approve, reject, waitlist, cancel, checkIn, checkOut, confirmOk, confirmIssue` (the last two both go to confirm-return). It ignores body requirements, slot capacity and suspension;<br>`isOverdue`: checked in and more than 15 minutes past `end`;<br>`waitlistPosition`: a number, or null | 404 "Booking not found."; 403 "You can't view this booking." |
| GET | `/bookings/:id/timeline` | same as `GET /bookings/:id` | — | list (no meta), oldest first, of three kinds:<br>**event:** `{ kind: "event", at, action (e.g. "booking.approved"), actor: { role: member\|manager\|admin\|system, name\|null }, reason\|null, text }`;<br>**condition_report:** `{ kind: "condition_report", at, phase: check_in\|check_out\|return_confirmation, overall, items: [{ label, ok, note? }], photos: [{ url, publicId }], notes\|null, by (a name)\|null, text }`;<br>**incident:** `{ kind: "incident", id, type, severity, status, event: "opened"\|"resolved", at, outcome? (resolved only), text }` | 404; 403 |
| POST | `/bookings/:id/approve` | managers of the unit, admins. A manager can't decide on their own booking; an admin can | body `{ note? (≤500) }` (`reason` is also accepted, and wins over `note`) | Booking: `status: "approved"`, `decision: { action: "approve", by, at, reason? (the note) }` | In order:<br>404;<br>503 (the lock, taken before anything is checked);<br>409 `INVALID_TRANSITION` "Can't approve a booking that is <status>.";<br>403 "You're not allowed to approve this booking." / "You can't decide on your own booking. Another manager of this unit or an admin must.", or suspended;<br>400 `note` / `reason` "Can be at most 500 characters." / "Must be text." (nothing changes);<br>**409 `SLOT_TAKEN`** "Another booking already holds this slot. Reject this request or move it to the waitlist.";<br>409 `INVALID_TRANSITION` "This booking was changed by someone else just now. Refresh and try again." |
| POST | `/bookings/:id/reject` | same as approve | body `{ reason (required, ≤500) }` | Booking: `status: "rejected"`, `decision: { action: "reject", by, at, reason }`. The slot is offered to the waitlist | 404; 409 `INVALID_TRANSITION` (status, or changed meanwhile); 403; 400 `reason` "Required" (no text), then `reason` / `note` "Can be at most 500 characters." / "Must be text." (nothing changes) |
| POST | `/bookings/:id/waitlist` | same as approve | body `{ reason (required, ≤500) }` | Booking: `status: "waitlisted"`, `decision.action: "waitlist"`. The slot goes to the next request in line, never back to this one | same as reject |
| POST | `/bookings/:id/cancel` | the borrower (reason optional); managers of the unit or admins (reason required). Works from `pending`, `approved` or `waitlisted` | body `{ reason? (≤500) }` | Booking: `status: "cancelled"`, `cancellation: { by, at, reason? }`. A freed slot is offered to the waitlist | 404; 409 `INVALID_TRANSITION` "Can't cancel a booking that is …", or changed meanwhile; 403 "You're not allowed to cancel this booking.", or suspended; 400 `reason` "Required" (not the borrower) / "Can be at most 500 characters." / "Must be text." |
| POST | `/bookings/:id/check-in` | the borrower or a manager of the unit (an admin who is neither can't). Opens 15 minutes before `start` and closes at `end` | body:<br>`items: [{ label, ok: boolean, note? (≤200) }]`, each label of `resource.checklist` exactly once;<br>`overall: good\|minor_issue\|damaged`;<br>`notes?` (≤1000);<br>`photos?` (≤3, see [Using photos](#verification-and-uploads)) | Booking: `status: "checked_in"`, `checkIn: { at, by, report }` | In order:<br>**400** `photos.<i>` "Must be a photo uploaded through /uploads/images." or `photos` "Must be a list." (checked first, before the booking is looked up);<br>404;<br>409 `INVALID_TRANSITION` "Can't check in a booking that is …";<br>403 "You're not allowed to check in this booking.", or suspended;<br>409 "Check-in opens 15 minutes before the start time (5 Nov, 14:30)." / "This booking has already ended.";<br>**400** `items` "Must be a list.", `items.<i>` "Must be an object with a label.", `items` "Missing: …" / "Not on this resource's checklist: …" / "Listed twice: …" (an empty body gets one "Missing" per checklist item), and model messages for `overall`, `notes`, `photos`, `items.<i>.ok`, `items.<i>.note`;<br>409 "This step is already recorded for this booking.";<br>409 changed meanwhile |
| POST | `/bookings/:id/check-out` | the borrower or a manager of the unit. Works from `checked_in`, with no time window | same body as check-in | Booking: `status: "checked_out"`, `checkOut: { at, by, report }` | same as check-in, without the time-window errors |
| POST | `/bookings/:id/confirm-return` | managers of the unit, admins. Not on their own booking unless an admin | body:<br>`outcome: "ok"\|"issue"` (required);<br>`items?` (when non-empty, the full checklist; an empty list counts as not sent);<br>`photos?` (≤3);<br>`note?` (≤1000; `notes` is read too);<br>`incident?: { type: damage\|delay\|misuse\|safety\|conflict\|other, severity: low\|medium\|high, description (20–2000) }`, required when `outcome` is `"issue"` | **200** (not 201) `{ booking, incident }`:<br>`booking` is `completed` for ok, or `flagged` for issue, with `returnConfirmation: { at, by, outcome, report? }`;<br>a return report is saved only when `items` or `photos` are sent. Its `overall` is `good` for ok, `damaged` for a high-severity issue, and `minor_issue` otherwise;<br>`incident` is null, or the new incident as stored: `{ _id, booking, resource, orgUnit, reportedBy, source: "manager", type, severity, description, photos, status: "open", comments: [], createdAt, updatedAt, __v }`, with bare ids (use `GET /incidents/:id` for the full view).<br>A flagged booking completes when its last incident is resolved (`POST /incidents/:id/resolve`) | In order:<br>**400** `photos.<i>` (checked first);<br>400 `outcome` 'Expected "ok" or "issue"' (before the booking is looked up);<br>404;<br>409 `INVALID_TRANSITION` (not `checked_out`);<br>403 (not staff, own booking, suspended);<br>400 `incident` "Required";<br>400 `items` "Must be a list." / `items.<i>` "Must be an object with a label." / the checklist messages;<br>400 `note` / `notes` "Can be at most 1000 characters." / "Must be text.";<br>400 `type` / `severity` / `description` / `photos` (model messages);<br>409 "This step is already recorded for this booking.";<br>409 changed meanwhile.<br>Nothing is saved when any 400 is returned |
| POST | `/bookings/:id/pass` | the borrower | — | `{ token, code, expiresAt, issuedAt, phase: "pickup"\|"return", verifiedAt\|null }`:<br>`token`: the QR's text, `cc1.<bookingId>.<exp>.<tag>`, signed by the server (a key derived for this use only) and valid for 2 minutes. Ask again every minute;<br>`code`: 6 characters to read out instead, valid as long as the token and **once**;<br>`issuedAt`: the server's clock, to count down from;<br>`phase`: pickup for an approved booking, return for one in use or awaiting return confirmation;<br>`verifiedAt`: when the unit last scanned a pass for this phase | 404; 403 "Only the borrower can show this booking's pass."; 409 "A pass is shown for an approved booking, or for an item you have out." / "This booking has already ended." |
| GET | `/bookings/:id/pass` | the borrower | — | `{ phase\|null, verifiedAt\|null }`: the cheap read an open pass polls (every 15 s) until it is verified | 404; 403 |
| POST | `/bookings/scan` | managers of the booking's unit, admins; never the borrower | body `{ token }` (the QR's text) or `{ code }` (the 6 characters, any case, spaces and dashes ignored) | `{ booking: { _id, status, start, end, resource: { _id, title, location }, borrower: { _id, name, memberType, department: { _id, code, name } }, orgUnit: { _id, name, code } }, phase, next: "check_in"\|"check_out"\|"confirm_return"\|null, isOverdue, verifiedAt, recorded }`:<br>`next`: the step this scanner may open now (from the state machine), or null;<br>`recorded`: false for a repeat scan of the same pass (one `booking.pass_verified` audit entry per pass, which the timeline shows as "verified the borrower's pass at pickup/return").<br>It verifies the booking, not the person: check their college ID | In order:<br>400 "Scan the pass, or type its code." (`token` and `code` both "Required."), or `code` "Send either the scanned pass or its code, not both.";<br>400 `token` "That isn't a valid CampusCommons booking pass." (malformed or forged);<br>**400 `PASS_EXPIRED`**;<br>400 `code` "That code isn't valid, or it has expired…" (unknown, used, or another unit's: the same answer);<br>503 "Codes can't be checked right now. Scan the QR instead." (Redis down);<br>404;<br>403 "You can't verify your own pass…" / "Only the managers of this resource's unit can verify its pass.";<br>409 "This booking has nothing to hand over or return now." / "Too early: pickup opens at … IST, 15 minutes before the start." / "This booking has already ended." |
| POST | `/bookings/:id/ai-compare` | managers of the unit, admins (a demo admin only on demo members' bookings), not suspended. On `checked_out`, `completed` or `flagged` bookings | — | `{ comparison: { summary, comparable, newDamageLikely, differences: [{ description, severity: none\|minor\|major, checklistItem\|null }] }, generatedAt, photos: { before, after }, quota, cached }`:<br>Gemini compares the check-in photos with the check-out photos (or the return confirmation's, when the borrower took none). **A suggestion:** confirm-return doesn't change;<br>`comparable`: whether the photos show the same item clearly enough; without it, `newDamageLikely` is false;<br>at most 6 differences; `checklistItem` only when it names a checklist label exactly; text holding contact details is withheld;<br>cached for 24 hours by the photos and labels, for any of the unit's staff | In order:<br>404 (also a demo admin on a real member's booking);<br>403 "Only this unit's managers can compare the handover photos.", or suspended;<br>409 "The photos can be compared once the item has been checked out." / "A comparison needs photos at both handovers; there are none at pickup / return / pickup or return." / "The return photos are the same files as the pickup photos, so there is nothing to compare…";<br>503 `AI_UNAVAILABLE` (not set up, paused, or "The handover photos couldn't be loaded for the comparison…", which spends nothing);<br>503 `SERVICE_UNAVAILABLE` "Photos can't be loaded: Cloudinary isn't set up on this server.";<br>429 `AI_QUOTA_EXCEEDED` |

**What the comparison sends Gemini:** the photos (fetched by the server from our own Cloudinary account, by their stored public ids, at most 768 px, at most 12 MB together) and the checklist labels. Never the reports' notes, names or anything about the borrower. Check-out also refuses a photo already used at check-in: 400 `photos.<i>` "This photo was used at check-in. Take a new one of the item as it is now."

## Incidents (`/incidents`)

`page` and `limit` follow the paging rules in [Values](#values). Every POST is refused for a suspended user.

**IncidentDetail** is returned by `POST /incidents`, `GET /incidents/:id` and `POST /incidents/:id/comments`. `POST /incidents/:id/resolve` returns the same object plus `bookingClosed`.

```
{ _id, status: "open"|"in_review"|"resolved", source: "user"|"manager"|"system",
  type: "damage"|"delay"|"misuse"|"safety"|"conflict"|"other", severity: "low"|"medium"|"high",
  description, photos: [{ url, publicId }],
  booking?: { _id, status, start, end, borrower: { _id, name, memberType, department: { _id, code, name } } }, // absent when not tied to a booking
  resource: { _id, title, slug }, orgUnit: { _id, name, code },
  reportedBy: { _id, name } | null,                 // null when the system raised it (overdue return)
  comments: [{ _id, by: { _id, name }, text, at }],
  resolution: null | { outcome: "no_action"|"warning"|"repair_required"|"strike", rationale, decidedBy: { _id, name }, at },
  aiSummary?: null | { text, generatedAt },         // the key exists only for the unit's managers and admins
  createdAt, updatedAt,
  canComment: boolean, canResolve: boolean }        // which buttons to show
```

Borrowers never come with email or ID-card data.

**IncidentListItem** is IncidentDetail without `photos`, `comments`, `aiSummary`, `canComment` and `canResolve`, and with `commentCount: number` added.

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| POST | `/incidents` | With a booking: its borrower (up to 7 days after the booking ends), or the unit's managers and admins (no time limit). For everyone, the booking must be `approved`, `checked_in`, `checked_out`, `completed` or `flagged`. Without a booking: only the unit's managers and admins | body `{ bookingId?, resourceId (required without bookingId; must match the booking's), type, severity, description (20–2000), photos? (≤3, see [Using photos](#verification-and-uploads)) }`. Any other key is refused | **201** IncidentDetail. `source` is `user` for the borrower and `manager` otherwise. The booking's status doesn't change; the incident is added to its `incidents` | In order:<br>400 `photos.<i>` "Must be a photo uploaded through /uploads/images." / `photos` "Must be a list." (checked first);<br>400 a non-object body "Send the incident's fields as an object.";<br>400 fields: an unknown key "This field can't be set."; `bookingId` / `resourceId` "Must be a valid id."; `resourceId` "Required when there's no booking."; `type` / `severity` "Required." / "Must be one of: …"; `description` "Required." / "Must be at least 20 characters." / "Can be at most 2000 characters." / "Must be text."; `photos` "At most 3 photos.";<br>404 "Booking not found.";<br>400 `resourceId` "Isn't the booking's resource.";<br>404 "Resource not found.";<br>403 "Only the borrower or this unit's managers can report an incident on this booking." / "Only this unit's managers can report an incident that isn't tied to a booking.", or suspended;<br>409 `INVALID_TRANSITION` "Incidents can't be reported on a booking that is <status>." / "Incidents can be reported up to 7 days after a booking ends. Contact the unit's managers instead." |
| GET | `/incidents` | any signed-in user, scoped: what they reported plus everything on their own bookings. A manager also gets their units' incidents; an admin gets all | query `status?` (one, a comma list, or a repeated key of `open`, `in_review`, `resolved`), `type?`, `severity?`, `resourceId?`, `page`, `limit` | list + meta of IncidentListItem, newest first. `meta: { page, limit, total }` | 400 (`status` "Must be one or more of: …", `type`, `severity`, `resourceId`, `page`, `limit`) |
| GET | `/incidents/:id` | parties (the booking's borrower, the reporter), the unit's managers, admins | — | IncidentDetail | 404 "Incident not found."; 403 "You can't view this incident." |
| POST | `/incidents/:id/comments` | same as `GET /incidents/:id` | body `{ text (1–1000, trimmed) }` | **201** IncidentDetail with the new comment. The first comment by a unit manager or admin moves `open` to `in_review` | In order:<br>404;<br>403 (not involved, or suspended);<br>400 a non-object body "Send the comment as an object.";<br>400 `text` "Required." / "Can be at most 1000 characters." / "Must be text.";<br>409 `INVALID_TRANSITION` "This incident is resolved, so its thread is closed." / "This incident was resolved just now, so its thread is closed." / "This thread has reached 200 comments." |
| POST | `/incidents/:id/resolve` | the unit's managers for low or medium severity; admins for any severity. Nobody but an admin may resolve an incident on their own booking | body `{ outcome: no_action\|warning\|repair_required\|strike, rationale (1–1000) }`. `strike` needs a booking and adds 1 to its borrower's `strikes` | 200 IncidentDetail + `bookingClosed: boolean` (true when this closed a flagged booking, which is now `completed`) | In order:<br>404;<br>403 "Only this unit's managers or an admin can resolve incidents." / "A high-severity incident is resolved by an admin." / "You can't resolve an incident on your own booking. Another manager of this unit or an admin must.", or suspended;<br>400 a non-object body "Send the resolution as an object.";<br>400 `outcome` "Required." / "Must be one of: …" / "A strike counts against a borrower, and this incident isn't tied to a booking.";<br>400 `rationale` "Required." / "Can be at most 1000 characters." / "Must be text.";<br>409 `INVALID_TRANSITION` "This incident is already resolved." / "Someone else resolved this incident just now." |

## Notifications (`/notifications`)

**Notification:** `{ _id, type, title, body, link, readAt: ISO | null, createdAt, updatedAt }`.

- `body` is at most 500 characters. A long reason is cut with "…".
- Notifications are deleted after 60 days.
- `link` is always an in-app path. The client needs routes for:
  - `/bookings/:id`, `/bookings/:id/check-in`, `/bookings/:id/check-out`
  - `/badges`, `/verification`, `/incidents/:id`
  - `/manage/requests`, `/manage/handovers`, `/manage/returns/:bookingId`, `/manage/badges`, `/manage/incidents/:id`
  - `/admin/incidents`
- `type` is one of:
  - `booking.requested`, `booking.approved`, `booking.rejected`, `booking.waitlisted`, `booking.promoted`, `booking.cancelled`
  - `booking.checked_in`, `booking.checked_out`, `booking.completed`, `booking.no_show`, `booking.expired`
  - `booking.reminder_start`, `booking.reminder_end`, `booking.overdue`
  - `badge.requested`, `badge.granted`, `badge.rejected`
  - `verification.approved`, `verification.rejected`
  - `incident.created`, `incident.commented`, `incident.resolved`

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| GET | `/notifications` | any signed-in user (their own only) | query `unread?` (only `true` or `false`), `page`, `limit` | list + meta of Notification, newest first. `meta: { page, limit, total, unread }`. `meta.unread` is the bell count whatever the filter | 400 (`unread` "Must be true or false.", `page`, `limit`); 404 user |
| GET | `/notifications/unread-count` | any signed-in user | none (poll every 30 s) | `{ count }`, no `meta` | 401 only, in practice |
| PATCH | `/notifications/read-all` | any signed-in user (their own) | none | `{ updated }` (how many were unread) | 403 suspended; 404 user |
| PATCH | `/notifications/:id/read` | the notification's owner | none | Notification. Marking it read again keeps the first `readAt` | 404 "Notification not found." for someone else's, an unknown or a malformed id (never 403); 403 suspended |

## Audit (`/audit`)

**AuditEntry:** `{ _id, at, action ("entity.verb"), actor: { id | null, role: "member"|"manager"|"admin"|"system", name | null }, entity: { type, id }, orgUnit?: { _id, name, code }, reason?, changes?: { field: [before, after] }, meta?, requestId? }`.

- Optional fields are left out when the entry has none.
- The hash-chain fields are never sent.

`entity.type` values: `user`, `org_unit`, `resource`, `badge`, `user_badge`, `booking`, `incident`.

`action` values:

- `user.registered`
- `verification.submitted`, `verification.id_viewed`, `verification.approved`, `verification.rejected`
- `org_unit.created`, `org_unit.updated`, `org_unit.managers_changed`
- `resource.created`, `resource.updated`, `resource.status_changed`
- `badge.created`, `badge.requested`, `badge.granted`, `badge.rejected`, `badge.evidence_viewed`
- `booking.requested`, `booking.approved`, `booking.rejected`, `booking.waitlisted`, `booking.cancelled`, `booking.promoted`, `booking.expired`
- `booking.checked_in`, `booking.no_show`, `booking.checked_out`, `booking.completed`, `booking.flagged`, `booking.overdue`
- `incident.created`, `incident.commented`, `incident.resolved`

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| GET | `/audit` | Admin: everything. Manager: entries of the units they manage; entries with no unit, such as user and verification events, are admin-only. Member: 403 | query `entityType?` (e.g. `booking`), `entityId?`, `actorId?`, `action?` (exact `entity.verb`), `orgUnit?`, `from?`, `to?` (ISO instants bounding `at` as `[from, to)`; `to` after `from`), `page`, `limit` | list + meta of AuditEntry, newest first. `meta: { page, limit, total }` | 400 (checked first):<br>`entityType` 'Must be an entity type such as "booking".';<br>`action` 'Must be an action such as "booking.approved".';<br>`entityId`, `actorId`, `orgUnit` "Must be a valid id.";<br>`from` / `to` "Must be a valid date.";<br>`to` "Must be after from.";<br>`page`, `limit`.<br>403 "Only managers and admins can read the audit log. Your bookings' history is on each booking's timeline." / "You can only read your own units' audit entries." (an `orgUnit` you don't manage) |

## Admin (`/admin`)

The ID-card verification queue and the user list. There are no routes that change roles or suspensions yet; a unit's managers are set with `PUT /org-units/:id/managers`.

**Queue item:** `{ user: { _id, name, email, emailHints: { year, level, branch, serial } | null, memberType|null, department: { _id, code, name } | null }, status: unsubmitted|pending|approved|rejected, submittedAt|null, reviewedAt|null, reason|null, hasIdCard: boolean, ocrCheck: { checks: { institute, rollNumber?, name?, year }, score, total, at } | null }`.

- Admins see the email and its hints, to check them against the card.
- `ocrCheck` is what the member's browser reported from its on-device check (FC-12): a hint, never proof. Cleared when the admin decides.

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| GET | `/admin/verifications` | admin | query `status` (pending\|approved\|rejected, default `pending`), `page`, `limit` | list + meta of queue items. `pending`: oldest `submittedAt` first. Other statuses: newest `reviewedAt` first | 404 user; 403 "Only an admin can review ID cards."; 400 (`status` "Must be one of: pending, approved, rejected.", paging) |
| GET | `/admin/verifications/:userId/id-card` | admin | — | `{ url, expiresAt }`: a signed download link that stops working after 5 minutes. Sent with `Cache-Control: no-store`, and every call is audited (`verification.id_viewed`). Ask again rather than storing it | 403; 404 "User not found." / "ID card not found." (no card on file: never uploaded, or deleted after the decision); 429 `fileLink`; 503 "Uploads aren't configured." / "The file can't be opened right now. Try again in a minute." |
| GET | `/admin/verifications/:userId/id-card/file` | admin | — | **Not the envelope:** the card's image itself, for the admin's own on-device check. `Content-Type` is what the bytes are (`image/jpeg`, `image/png` or `image/webp`; a PDF card is stored as JPG), with `Cache-Control: no-store`, `Content-Disposition: inline` and `X-Content-Type-Options: nosniff`. Audited like the link (`verification.id_viewed`, `meta.purpose: "device_check"`). HEAD answers 405 | Errors are the JSON envelope: 403; 404 "User not found." / "ID card not found."; 409 `INVALID_TRANSITION` "This file can't be checked on the device. Open it and check it yourself." (not an image); 429 `fileLink`; 503 "The ID card can't be loaded right now. Try again in a minute." |
| PATCH | `/admin/verifications/:userId` | admin, not suspended, not on their own verification | body:<br>`decision: approve\|reject` (required);<br>`submittedAt` (required: the queue item's `submittedAt` exactly as received, or null if it was null);<br>`reason` (5–500; required to reject);<br>`memberType?`, `department?` (corrections, applied when approving; otherwise the member's own values stand).<br>Any other key is refused | Queue item after the decision: `status` approved or rejected, `reviewedAt` now, `hasIdCard: false`. The card image is deleted. The member is notified, and emailed unless they turned email off | In order:<br>404;<br>403 "Only an admin can review ID cards." / "You can't decide on your own verification. Another admin must.", or suspended;<br>400 a non-object body "Send the decision as an object.";<br>400 fields: an unknown key "This field can't be set."; `decision` "Required." / "Must be one of: approve, reject."; `submittedAt` "Required." / "Must be a valid date."; `reason` "Say why, so the member knows what to fix." / "Must be at least 5 characters." / "Can be at most 500 characters." / "Must be text."; `memberType` "Must be one of: …"; `department` "Must be a valid id.";<br>**409 `INVALID_TRANSITION`** "This member hasn't submitted an ID card." / "This verification has already been decided." / "This member has sent a new ID card since you opened theirs. Reload and review it.";<br>400 (approve) `memberType` / `department` "Required to approve.", `department` "No such unit." / "This unit is inactive.";<br>503 "The ID card image couldn't be deleted, so the decision wasn't saved. Try again in a minute." (nothing changes);<br>409 "This verification changed while you were deciding. Reload and try again." |

**User row** (`GET /admin/users`): `{ _id, name, email, roles: ["member"|"manager"|"admin"], memberType|null, department: { _id, code, name } | null, verification: { status: unsubmitted|pending|approved|rejected }, managedOrgUnits: [orgUnitId], suspendedUntil|null }`. Nothing about the ID card.

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| GET | `/admin/users` | admin | query:<br>`q?` (≤100): part of the name or email, ignoring case, matched as plain text;<br>`role?`: member\|manager\|admin (users who have that role);<br>`verification?`: unsubmitted\|pending\|approved\|rejected;<br>`page`, `limit` | list + meta of user rows, newest account first. `meta: { page, limit, total }`. For the org-unit manager picker: send the chosen `_id`s as `managerIds` | 404 user; 403 "Only an admin can list users."; 400 (`q` "Must be text." / "Can be at most 100 characters."; `role` / `verification` "Must be one of: …"; paging) |

While `DEMO_MODE` is on, a demo admin's queue and user list hold only demo accounts, and a real member's card or decision answers 404.

## AI (`/ai`)

The AI features live with their resources (`POST /resources/ai-search`, `POST /bookings/:id/ai-compare`); this is what they share. Google Gemini, on its free tier.

**The quota.** Every AI request (not a cached answer) counts against, in this order: 10 seconds between one account's requests (`BURST`); 5 a day per account (`USER_DAILY`); for the demo accounts, 5 a day per account and visitor and 30 a day for all of them together (`POOL_DAILY`); 8 a minute (`GLOBAL_MINUTE`) and 50 a day (`GLOBAL_DAILY`) for everyone. Days are IST days. The numbers are `AI_*` settings. A request that fails before Google is asked is given back in full; one Google worked on (a timeout, a blocked or broken answer) stays spent. A Gemini 429 gives it back and pauses AI for everyone for 10 minutes.

| Method | Path | Who | Input | Returns (`data`) | Errors to handle |
|---|---|---|---|---|---|
| GET | `/ai/quota` | any signed-in user | — | `{ used, limit, remaining, resetsAt, configured }`: the "AI requests left today" meter. `remaining` is also capped by what the demo pool has left. `configured` is false when AI isn't set up | 404 user; 503 `AI_UNAVAILABLE` while Redis is down |

## Health

| Method | Path | Who | Input | Returns | Errors to handle |
|---|---|---|---|---|---|
| GET | `/health` (no `/api/v1` prefix) | anyone; no auth, no rate limit, not logged | — | **Not the envelope:** `{ status: "ok"\|"down", mongo: "up"\|"down", redis: "up"\|"degraded", uptime (seconds), requestId }`. 200 while MongoDB is up (Redis being "degraded" is still 200); 503 when MongoDB is down | — |

`/health` is outside `/api`, so neither the Vite dev proxy nor the production `/api` rewrite forwards it. Call the API host directly.
