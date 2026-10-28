# CampusCommons: Frontend Plan

> React 18 · Vite · Tailwind CSS v4 · React Router · TanStack Query · Zustand · React Hook Form + Zod
>
> System design (routes, auth, rate limits) is in [`architecture.md`](./architecture.md), and API behaviour is in [`backend.md`](./backend.md). This doc covers **what the UI builds**, **in what order**, and **how it is structured**.

---

## Rating legend

| Scale | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| **Wow**: how much it impresses a judge | Expected plumbing | Nice to have | Noticeable | Memorable | Standout |
| **Difficulty**: effort for one developer | < 1 h | 1–3 h | 3–6 h | 6–10 h | > 10 h |

**Priority:**
- **P0** = MVP, must ship.
- **P1** = build right after the MVP freeze.
- **P2** = if time permits.
- **P3** = future work.

---

## 1. UX principles

1. **Every "no" comes with a reason and a fix.** Ineligible, waitlisted, rejected or rate-limited: the user always sees *why* and *what to do next*, e.g. "Missing badge: 3D Printing Basics → Request it".
2. **Status is never shown by colour alone.** Every booking state has a colour, an icon and a text label (see §10.2).
3. **Check-in and check-out are mobile-first.** They happen standing next to the machine: big tap targets, camera capture, at most 3 steps.
4. **Navigation depends on role.** Members see Explore, Bookings, Badges. Managers also get **Manage**; admins also get **Admin**. One account can hold several roles.
5. **The server is the source of truth.** The UI hides buttons the user can't use (based on `/auth/me` roles and scopes), but every rule is enforced again on the server.
6. **Show times in IST.** The API speaks ISO/UTC; everything on screen is formatted as `Asia/Kolkata`.

---

## 2. MVP (P0): the basic product

### 2.1 MVP definition
> **A judge can log in as any demo role in one click and complete the whole journey in the browser:**
> 1. A manager lists a resource.
> 2. A student discovers it and sees an eligibility checklist, gets the missing badge, and requests a slot.
> 3. A competing request is waitlisted.
> 4. The manager approves.
> 5. The student checks in and checks out with photos.
> 6. The manager confirms the return and flags an issue, which an admin resolves.
> 7. Everyone sees the same timeline.
>
> All on a phone or a laptop, with clear reasons at every step.

**Not in the MVP** (see §3):
- AI search
- QR codes
- real-time sockets
- WhatsApp settings
- analytics charts
- calendar drag-select
- priority explainer
- dark mode
- i18n

### 2.2 MVP frontend features

| ID | Feature | Lifecycle step | Wow | Diff | Notes |
|---|---|---|:-:|:-:|---|
| F-01 | Auth screens: register, OTP, login | — | 3 | 2 | Live **"Detected: UG · CSE · 2024"** chip from the email pattern; inline domain error; OTP resend countdown that respects `Retry-After` |
| F-02 | ID-card upload + verification status | — | 2 | 1 | Drag-drop or camera; pre-filled member type and department; "browse-only until verified" banner |
| F-03 | **Demo role switcher** | demo | 2 | 1 | "Try as Student / Student 2 / Faculty / Manager / Admin" buttons on the login page, shown only when the API reports `DEMO_MODE` |
| F-04 | App shell: role-based nav, route guards, toasts, error boundary | all | 1 | 2 | `RequireAuth`, `RequireRole`, `RequireVerified`; error toasts show `requestId` |
| F-05 | Explore: search + filters + resource cards | 2 | 2 | 2 | Filters for unit, category, date, "only show what I can book"; card shows unit, risk level, approval mode, badges needed |
| F-06 | Resource detail + **eligibility checklist** + weekly availability grid | 2 | 3 | 3 | ✅/❌ per rule with fix links; usage rules; busy blocks (no names); quota meter |
| F-07 | Booking panel with **live pre-check** | 3, 4 | 3 | 2 | Debounced `POST /bookings/check` as the slot changes; "Join waitlist as #2" when the slot is taken |
| F-08 | My bookings + booking detail with **timeline** | 10 | 3 | 2 | Tabs: Upcoming / Requests / Past; detail shows only the actions valid for the current state |
| F-09 | Check-in / check-out wizard | 7, 8 | 3 | 2 | Checklist toggles, camera capture with client-side compression, overall condition, notes |
| F-10 | Manager: resource listing form | 1 | 2 | 3 | Sectioned form: basics → availability → eligibility → limits → checklist; Zod-validated |
| F-11 | Manager: review queue **grouped by conflicting slot** | 5, 6 | 3 | 3 | Competing requests side by side with their eligibility snapshots; approve / reject / waitlist with a mandatory reason |
| F-12 | Manager: handovers + **return confirmation** | 7–9 | 3 | 2 | Today's check-ins and returns; check-in vs check-out photos side by side; "All good" or "Report issue" |
| F-13 | Incidents: report, list, thread, resolve | 9 | 2 | 2 | Pre-filled from the booking; the resolve dialog needs an outcome and a rationale |
| F-14 | Badges: my badges, request; manager queue and grant | 2, 4 | 2 | 2 | A fix link in the eligibility checklist deep-links here |
| F-15 | Admin: verification queue, users and roles, audit log | 10 | 2 | 2 | ID image opens through a short-lived signed URL; audit table with filters |
| F-16 | Notification bell + centre | 6–9 | 2 | 1 | Polls `unread-count` every 30 s; click-through to the related page |
| F-17 | Fair-usage quota meters | 6 | 3 | 1 | "4 of 6 h used this week" on resource detail and profile |
| F-18 | Responsive + accessible baseline | all | 2 | 2 | Works at 360 px wide; keyboard and screen-reader basics (§10.3) |

**Effort:** about 38 person-hours, which fits two frontend developers in hours 4–28 of the timeline.

---

## 3. Cool-to-have features (after MVP freeze)

| ID | Feature | Wow | Diff | Priority | Notes (backend dependency) |
|---|---|:-:|:-:|:-:|---|
| FC-01 | **"How allocation works" transparency page** | 3 | 1 | P1 | Public page explaining caps, FIFO waitlist, no-show rules and human review. Cheap fairness points |
| FC-02 | **Audit integrity badge** | 4 | 1 | P1 | "✔ Audit chain verified: 1,284 entries" on the admin audit page (C-02) |
| FC-03 | **Guided judge tour** | 3 | 1 | P1 | `react-joyride` walkthrough of the golden path for each demo role |
| FC-04 | **Smart alternatives panel** | 4 | 1 | P1 | On `SLOT_TAKEN`: "Next free: today 4–6 pm · Similar: GPU Workstation #2" (C-03) |
| FC-05 | **QR pass + QR scanner** | 4 | 2 | P1 | Borrower shows the QR (`qrcode.react`); manager scans it (`html5-qrcode`) to check in or out (C-04) |
| FC-06 | **AI "Describe what you need" search** | 5 | 2 | P1 | Query → ranked results with "why this matches"; **"AI searches left today: 3/5"** meter; when the quota is out or AI is down, falls back to normal search with a friendly note (C-05) |
| FC-07 | **"Why am I #3?" priority explainer** | 4 | 2 | P1 | Score breakdown bars for waitlisted users; managers see the ranking as a recommendation (C-06) |
| FC-08 | Extension request UI | 2 | 1 | P1 | From booking detail; shows a conflict result (C-07) |
| FC-09 | Reliability card on profile | 3 | 1 | P1 | On-time returns, no-shows, strikes, with the reason for each (C-09) |
| FC-10 | Real-time toasts and live status | 3 | 2 | P2 | `socket.io-client`; invalidates the matching queries on events (C-10) |
| FC-11 | WhatsApp opt-in settings | 2 | 1 | P2 | Phone in E.164 format, explicit consent checkbox, test-message button (C-12) |
| FC-12 | **In-browser ID-card OCR check** | 4 | 3 | P2 | `tesseract.js` reads the roll number **on the device** and compares it with the email-derived one: "✔ Roll number matches your email". The image is never sent to an AI |
| FC-13 | AI before/after diff view | 5 | 3 | P2 | Highlights suggested differences on the return-confirmation screen, clearly labelled "AI suggestion" (C-15) |
| FC-14 | Analytics dashboard | 4 | 3 | P2 | `Recharts`: utilisation by resource, **underused resources list**, hour × weekday demand heatmap, Gini gauge (C-16) |
| FC-15 | Calendar view with drag-select | 3 | 3 | P2 | `react-big-calendar` week view for picking a slot |
| FC-16 | Training micro-quiz | 4 | 2 | P2 | 5 questions → instant badge for self-serve badges (C-13) |
| FC-17 | Campus map of resource locations | 3 | 2 | P3 | `react-leaflet` with building pins |
| FC-18 | Dark mode | 2 | 1 | P3 | Tailwind `dark:` variant plus a toggle |
| FC-19 | PWA (installable, offline shell) | 2 | 2 | P3 | `vite-plugin-pwa` |
| FC-20 | Hindi / English toggle | 2 | 2 | P3 | `react-i18next` |
| FC-21 | Download booking record (PDF) | 2 | 1 | P3 | Calls C-21 |

**Suggested P1 order:** FC-01 → FC-03 → FC-04 → FC-02 → FC-05 → FC-06 → FC-07 → FC-08 → FC-09. Each one can only ship after the backend feature it depends on.

---

## 4. Tech and libraries

| Concern | Choice | Why |
|---|---|---|
| Build | **Vite** | Fast dev server; `/api` proxy to `localhost:5000` |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite`) | Design tokens in `@theme`; no CSS files to manage |
| Accessible primitives | **Headless UI** | Dialog, Menu, Listbox, Tabs, Switch with focus management built in |
| Icons | **lucide-react** | |
| Routing | **React Router** (data-router API) | Nested layouts per role |
| Server state | **TanStack Query** | Caching, polling, invalidation, retries |
| Client state | **Zustand** | Auth (access token in memory) and small UI state only |
| Forms | **React Hook Form + Zod** (`@hookform/resolvers`) | Same rules as the server (§9) |
| HTTP | **axios** | Interceptors for the bearer token, refresh and error normalisation |
| Dates | **date-fns + date-fns-tz** | IST formatting |
| Toasts | **sonner** | |
| Images | **browser-image-compression** | Photos ≤ 1 MB / 1600 px before upload (saves Cloudinary quota and mobile data) |

---

## 5. Folder structure

```
client/
├── index.html
├── vite.config.js            # react(), tailwindcss(), server.proxy['/api']
├── vercel.json               # rewrite /api/* → Render, SPA fallback
└── src/
    ├── main.jsx  App.jsx
    ├── app/
    │   ├── router.jsx         # all routes + guards
    │   ├── queryClient.js
    │   └── layouts/           # PublicLayout, AppLayout (role nav), ManageLayout, AdminLayout
    ├── pages/                 # one file per route (thin: compose feature components)
    ├── features/
    │   ├── auth/  verification/  resources/  eligibility/  bookings/
    │   ├── condition/  incidents/  badges/  notifications/  admin/  audit/
    │   │   └── each: api.js (query/mutation hooks) · components/ · schemas.js
    ├── components/ui/         # Button, Input, Select, Dialog, Tabs, Badge, Card, Skeleton, EmptyState, DataTable
    ├── lib/
    │   ├── http.js            # axios instance + interceptors
    │   ├── time.js            # IST helpers
    │   ├── emailPattern.js    # same regex as server, for the "Detected:" hint
    │   └── schemas/           # shared Zod primitives (campusEmail, password, safeText, …)
    ├── stores/auth.js         # Zustand: accessToken, user, setSession, clear
    └── styles/index.css       # @import "tailwindcss"; @theme tokens
```

---

## 6. Route map and page specs

### 6.1 Public

| Route | Page | Key UI | API |
|---|---|---|---|
| `/login` | Login | Email and password; **demo role buttons** (DEMO_MODE); lockout countdown on 429 | `POST /auth/login`, `POST /auth/demo-login` |
| `/register` | Register | Name, email (live `@nitjsr.ac.in` check + "Detected" chip), password strength | `POST /auth/register` |
| `/verify-otp` | OTP | 6-box input with paste support; resend with countdown | `POST /auth/verify-otp`, `POST /auth/resend-otp` |
| `/how-it-works` | Transparency (FC-01) | Fair-use rules, waitlist, human review, privacy | static |

### 6.2 Member (logged in)

| Route | Page | Key UI | API |
|---|---|---|---|
| `/verification` | ID verification | Upload card; status card (pending / approved / rejected + reason + re-upload) | `POST /verification/id-card`, `GET /verification/status` |
| `/explore` | Explore | Search bar, filter sidebar (sheet on mobile), resource grid, pagination | `GET /resources`, `GET /org-units` |
| `/resources/:id` | Resource detail | Header (unit, location, risk), rules, **EligibilityChecklist**, **AvailabilityGrid**, **QuotaMeter**, **BookingPanel** | `GET /resources/:id`, `/availability`, `/eligibility`, `POST /bookings/check`, `POST /bookings` |
| `/bookings` | My bookings | Tabs: Upcoming (`approved`, `checked_in`) · Requests (`pending`, `waitlisted` with position) · Past | `GET /bookings/mine` |
| `/bookings/:id` | Booking detail | StatusBadge, decision reason, state-aware action bar (cancel / check in / check out / report issue), condition reports, **BookingTimeline** | `GET /bookings/:id`, `/timeline`, `POST /bookings/:id/cancel` |
| `/bookings/:id/check-in` | Check-in wizard | ① checklist ② photos ③ confirm | `POST /uploads/images`, `POST /bookings/:id/check-in` |
| `/bookings/:id/check-out` | Check-out wizard | Same as check-in; shows check-in photos for reference | `POST /bookings/:id/check-out` |
| `/badges` | Badges | My badges (active, requested, expired), catalogue by unit, request dialog with optional evidence | `GET /badges`, `/badges/mine`, `POST /badges/:id/requests` |
| `/incidents/new` | Report incident | Type, severity, description, photos; `?bookingId=` pre-fill | `POST /incidents` |
| `/incidents/:id` | Incident detail | Thread, status, resolution card | `GET /incidents/:id`, `POST /incidents/:id/comments` |
| `/notifications` | Notifications | List, mark read, mark all read | `GET /notifications`, `PATCH …/read`, `PATCH …/read-all` |
| `/profile` | Profile | Details, verification status, quota overview, email notification toggle | `GET /auth/me` |

### 6.3 Manager (`/manage/*`, requires `manager`)

| Route | Page | Key UI | API |
|---|---|---|---|
| `/manage` | Dashboard | Count cards: pending requests, today's handovers, returns to confirm, open incidents | several `GET`s with `limit=1` for totals |
| `/manage/resources` | My unit's resources | Table with status toggles (active / maintenance) | `GET /resources?orgUnit=`, `PATCH /resources/:id/status` |
| `/manage/resources/new` · `/:id/edit` | Listing form | Sections: Basics · Availability (weekly hours editor + blackouts) · Eligibility (member types, departments, badges, approval mode) · Limits · Condition checklist · Preview | `POST` / `PATCH /resources` |
| `/manage/requests` | Review queue | **Conflict groups**: one card per contested slot listing all requests with requester (name, member type, department), purpose, eligibility snapshot; actions with **ReasonDialog** | `GET /bookings/manage`, `POST …/approve \| reject \| waitlist` |
| `/manage/handovers` | Today | Three lists: starting soon, in use (overdue highlighted), awaiting return confirmation | `GET /bookings/manage?status=…` |
| `/manage/returns/:bookingId` | Confirm return | Check-in vs check-out photos and checklists side by side; manager's own checklist; "All good" or "Report issue" (opens the incident fields) | `POST /bookings/:id/confirm-return` |
| `/manage/incidents` · `/:id` | Incidents | Filterable list; detail with resolve dialog (outcome + rationale) | `GET /incidents`, `POST /incidents/:id/resolve` |
| `/manage/badges` | Badge requests | Queue with evidence preview; grant directly to a user | `GET /badge-requests`, `PATCH /badge-requests/:id`, `POST /badges/:id/grant` |

### 6.4 Admin (`/admin/*`, requires `admin`)

| Route | Page | Key UI | API |
|---|---|---|---|
| `/admin/verifications` | Verification queue | List with email hints; "View ID" opens a signed URL in a dialog (watermark text: "Viewing is logged"); approve / reject with reason; confirm member type and department | `GET /admin/verifications`, `GET …/:userId/id-card`, `PATCH …/:userId` |
| `/admin/users` | Users | Search, role editor (incl. managed units), suspend dialog with reason and until-date | `GET /admin/users`, `PATCH …/roles`, `PATCH …/suspend` |
| `/admin/org-units` | OrgUnits | CRUD plus manager assignment | `/org-units` routes |
| `/admin/incidents` | Escalations | High-severity incidents across all units | `GET /incidents?severity=high` |
| `/admin/audit` | Audit log | **DataTable** filtered by entity, actor, action, date; row expands to show the before/after diff | `GET /audit` |

---

## 7. Shared components

| Component | Used in | Behaviour |
|---|---|---|
| `EligibilityChecklist` | Resource detail, booking panel, review queue | Renders `[{rule, passed, message, fixHint}]`; failed rules get a fix link (e.g. → `/badges?request=3d-printing-basics`) |
| `AvailabilityGrid` | Resource detail, booking panel | 7-day × time-slot grid: open, busy, blackout, closed; keyboard navigable; click to select a range |
| `BookingPanel` | Resource detail | Date and time pickers aligned to `slotMinutes`, purpose field, live pre-check result, submit / join-waitlist |
| `StatusBadge` | Everywhere | Colour + icon + label per state (§10.2) |
| `BookingTimeline` | Booking detail, incident detail | Vertical timeline of audit events and condition reports with actor, time (IST) and reason |
| `ConditionReportForm` | Check-in, check-out, return confirmation | Checklist toggles with notes, `PhotoUploader`, overall-condition radio |
| `PhotoUploader` | Condition, incidents, ID card | `<input type="file" accept="image/*" capture="environment">`, compression, thumbnails, max 3 |
| `ReasonDialog` | Reject, waitlist, cancel, resolve, suspend | Required textarea (10–500 chars) with a character counter, plus quick-pick templates ("Clashes with lab session", "Missing safety training") |
| `QuotaMeter` | Resource detail, profile | Progress bar plus text: "4 of 6 h this week · 1 of 1 active booking" |
| `NotificationBell` | App header | Unread badge, dropdown of the latest 5 |
| `RequireAuth` / `RequireRole` / `RequireVerified` | Router | Redirect to login, show a 403 page, or show a "verify to book" prompt |
| `DataTable`, `EmptyState`, `Skeleton`, `ErrorState` | Lists | Every list has loading, empty and error states, and the error state shows the `requestId` |

---

## 8. State, data fetching and auth flow

### 8.1 Auth flow
1. **App boot.** Call `POST /auth/refresh` (the httpOnly cookie travels automatically, same-origin through the Vercel rewrite).
   - On success: store `accessToken` in Zustand **memory only**, then call `GET /auth/me`.
   - On failure: the user is treated as logged out.
2. **Every request:** the axios request interceptor adds `Authorization: Bearer <token>`.
3. **On 401 `UNAUTHENTICATED`:** the response interceptor refreshes **once**, using a single-flight promise so 5 parallel 401s trigger 1 refresh, then retries the original request. If the refresh fails, it clears the store and sends the user to `/login?next=…`.
4. **Logout:** `POST /auth/logout`, clear the store, then `queryClient.clear()`.

### 8.2 Query keys and invalidation

| Query key | Source | Refetch |
|---|---|---|
| `['me']` | `GET /auth/me` | on focus |
| `['resources', filters]` | `GET /resources` | stale 60 s (matches the server cache) |
| `['resource', id]` | `GET /resources/:id` | stale 5 min |
| `['resource', id, 'availability', range]` | `GET /resources/:id/availability` | stale 15 s |
| `['resource', id, 'eligibility', slot]` | `GET /resources/:id/eligibility` | stale 0 |
| `['bookings', 'mine', status]` | `GET /bookings/mine` | on focus |
| `['bookings', 'manage', filters]` | `GET /bookings/manage` | every 30 s while open |
| `['booking', id]`, `['booking', id, 'timeline']` | detail and timeline | on focus |
| `['notifications', 'unread-count']` | polling | **every 30 s** |
| `['badges']`, `['badges', 'mine']`, `['badge-requests']` | badges | on focus |
| `['incidents', filters]`, `['incident', id]` | incidents | on focus |
| `['admin', 'verifications', status]`, `['audit', filters]` | admin | on focus |

| Mutation | Invalidates |
|---|---|
| Create booking / cancel | `['bookings','mine']`, `['resource', id, 'availability']`, `['resource', id, 'eligibility']` |
| Approve / reject / waitlist | `['bookings','manage']`, `['booking', id]` |
| Check-in / check-out / confirm return | `['booking', id]`, `['booking', id, 'timeline']`, `['bookings', …]` |
| Resource create / edit / status | `['resources']`, `['resource', id]` |
| Badge decision | `['badge-requests']`, `['badges','mine']` |

**No optimistic updates on lifecycle actions.** Approvals, check-ins and the like wait for the server's answer so the UI never shows a state the server rejected. Optimistic updates are used only for "mark notification read".

### 8.3 Error handling
- `http.js` normalises every error to `{ status, code, message, details, requestId }`.
- `VALIDATION_ERROR` is mapped onto form fields via `setError(detail.path, …)`.
- `INELIGIBLE` is rendered as an `EligibilityChecklist`, not a toast.
- `SLOT_TAKEN` brings up "Join waitlist?" (and the alternatives panel once C-03 is done).
- `RATE_LIMITED` and `AI_QUOTA_EXCEEDED` read `Retry-After` / `resetsAt` and show a countdown.
- Anything else shows a toast "Something went wrong (ref a1b2c3)".

---

## 9. Client-side validation

Zod schemas in `lib/schemas/` mirror the server rules in [`backend.md` §7](./backend.md#7-validation-catalogue) and are wired through `zodResolver`. **The client gives instant feedback, and the server stays authoritative.**

| Form | Client rules |
|---|---|
| Register | Email must end in `@nitjsr.ac.in` (inline: "Use your college email"); `emailPattern` shows the "Detected: UG · CSE · 2024" chip or "Faculty/staff email: you'll upload a faculty ID card"; password 8–72 characters, a letter and a digit, with a strength bar |
| OTP | Exactly 6 digits; auto-submits on the 6th |
| ID upload | jpg/png/webp/pdf, ≤ 5 MB (checked before upload), preview |
| Booking panel | `end > start`; aligned to `slotMinutes`; past times disabled; closed hours greyed out in the grid; purpose 10–300 characters with a counter |
| Listing form | Title 3–120; at least one member type; open < close for each weekday; blackout start < end; `minDuration ≤ maxDuration`; 1–10 checklist items; quantity 1–50 |
| Reason dialog | 10–500 characters, required |
| Condition report | Every checklist item answered; a note is required on any item marked "not OK"; 0–3 photos |
| Incident | Type and severity required; description 20–2000 |

---

## 10. Design system and accessibility

### 10.1 Tokens (Tailwind v4 `@theme`)
- **Brand:** a neutral teal/slate palette. The NIT JSR official colours and logo are deliberately not used; this is an independent prototype.
- **Font:** Inter (or the system stack). Base size 16 px, line height 1.5.
- **Layout:** radius `rounded-xl` for cards and `rounded-lg` for inputs; 4-px spacing scale; max content width `max-w-6xl`.

### 10.2 Booking status styles

| Status | Colour | Icon (lucide) | Label |
|---|---|---|---|
| `pending` | amber | `Clock` | Awaiting review |
| `approved` | green | `CheckCircle2` | Approved |
| `waitlisted` | violet | `ListOrdered` | Waitlisted (#n) |
| `rejected` | red | `XCircle` | Rejected |
| `cancelled` | slate | `Ban` | Cancelled |
| `expired` | slate | `TimerOff` | Expired |
| `checked_in` | blue | `LogIn` | In use |
| `checked_in` + overdue | red outline | `AlarmClock` | Overdue |
| `checked_out` | teal | `LogOut` | Returned, awaiting confirmation |
| `completed` | emerald | `BadgeCheck` | Completed |
| `flagged` | orange | `AlertTriangle` | Issue reported |
| `no_show` | rose | `UserX` | No-show |

### 10.3 Accessibility checklist (WCAG 2.1 AA)
- Semantic landmarks (`header`, `nav`, `main`), one `h1` per page, and a skip-to-content link.
- Every input has a `<label>`. Errors are linked with `aria-describedby` and announced.
- Dialogs trap focus and close on Esc (Headless UI). Focus returns to the trigger.
- `AvailabilityGrid` is a `role="grid"` with arrow-key navigation and `aria-selected`.
- Status changes after mutations are announced through an `aria-live="polite"` region.
- Contrast is at least 4.5:1 for text, and focus rings are always visible.
- `prefers-reduced-motion` is respected.
- Tap targets are at least 44 × 44 px on the check-in and check-out screens.
- Images have alt text; condition photos use "Check-in photo 1 of 3, FDM 3D Printer".

---

## 11. Judge golden path (demo script)

| # | Login as | Do | Expect to see |
|---|---|---|---|
| 1 | **Manager** | Manage → Resources → New: "FDM 3D Printer #2" (DIC), requires *3D Printing Basics*, manual approval, max 4 h, 6 h/week | Resource listed; audit entry `resource.created` |
| 2 | **Student** | Explore → search "3D printer" → open it | Eligibility checklist: ❌ *Missing badge: 3D Printing Basics → Request it* |
| 3 | Student | Click the fix link → request the badge | Badge shows "Requested" |
| 4 | **Manager** | Manage → Badges → approve | Student gets a notification; the checklist turns ✅ |
| 5 | Student | Book tomorrow 10:00–12:00 with a purpose | Live pre-check all ✅ → status **Awaiting review** |
| 6 | **Student 2** | Book an overlapping slot | "Slot held by an earlier request" → joins as **Waitlisted #1** |
| 7 | **Manager** | Manage → Requests: both requests shown in one conflict group → approve the student | Student: **Approved** (notification + email); Student 2 stays waitlisted with the reason shown |
| 8 | Student | Booking → **Check in** → checklist + photo | Status **In use**; timeline updated |
| 9 | Student | **Check out** → checklist + photo, notes "Bed slightly scratched" | Status **Returned, awaiting confirmation** |
| 10 | **Manager** | Manage → Handovers → Confirm return → photos side by side → **Report issue** (damage, low) | Booking **Issue reported**; incident created |
| 11 | **Admin** (or Manager) | Incident → resolve: *Warning*, with rationale | Booking **Completed**; both parties notified |
| 12 | Student and Admin | Booking timeline; Admin → Audit filtered by this booking | The full history, each step with actor, time and reason |

**Seeded extras** let judges explore beyond the script:
- a `no_show` booking
- an overdue in-use booking created by the seed
- a rejected request with its reason
- a pending ID verification in the admin queue

The testing instructions in the submission list all demo logins.

---

## 12. Third-party packages (to disclose in the submission)

| Purpose | Packages |
|---|---|
| Core (MVP) | `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `zustand`, `axios`, `react-hook-form`, `@hookform/resolvers`, `zod`, `tailwindcss`, `@tailwindcss/vite`, `@headlessui/react`, `lucide-react`, `sonner`, `date-fns`, `date-fns-tz`, `browser-image-compression` |
| Dev | `vite`, `@vitejs/plugin-react`, `eslint`, `prettier`, `@tanstack/react-query-devtools` |
| Cool-to-have | `qrcode.react`, `html5-qrcode`, `react-joyride`, `socket.io-client`, `tesseract.js`, `recharts`, `react-big-calendar`, `react-leaflet`, `leaflet`, `vite-plugin-pwa`, `react-i18next` |
