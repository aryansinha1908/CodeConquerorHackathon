# CampusCommons: Frontend Plan

> React 19 · Vite 8 · Tailwind CSS v4 · React Router 7 · TanStack Query 5 · Zustand · React Hook Form + Zod · framer-motion
>
> System design (routes, auth, rate limits) is in [`architecture.md`](./architecture.md), and API behaviour is in [`backend.md`](./backend.md). This doc covers **what the UI builds**, **in what order**, and **how it is structured**.

---

## Implementation status (29 Oct 2026)

- **The MVP is built, except the member's `/badges` page** (half of F-14). It is the teammate's page and shows a placeholder today. Every other route in §6.2–6.3 exists, and so does every §6.1 route except `/how-it-works`. §6.4 has the verification queue, the audit log and escalations.
- **Not built:** `/how-it-works` (FC-01), `/admin/users`, `/admin/org-units`, Explore's date filter, the quota overview on `/profile`, and every cool-to-have feature in §3.
- **The judge script (§11) runs in the UI except step 3**, where a student requests a badge. Use the manager's **Grant directly** or the API request in [`demo.md` §5](./demo.md#5-requesting-a-badge-without-the-badges-page). Check-in opens 15 min before the start, so run the same-day variant in [`demo.md` §3](./demo.md#3-the-judge-script-the-main-demo).
- **Quality:** `cd client && npm test` passes 319 tests, `npm run lint` is clean, and `npm run build` succeeds with no chunk over 500 kB (the largest, React, is 311 kB). Strengths: input checks as strict as [`api.md`](./api.md) or stricter, focus moved after every action, invalidation as §8.2 says, lazy pages with vendor chunks, and Headless UI kept off the login page. Weak spots are marked **Known issue** where they apply.
- **Hosting risk:** some networks block `*.vercel.app` entirely. On campus Wi-Fi on 29 Oct, the site and other `vercel.app` sites timed out while `vercel.com` loaded. Test the judging network before the demo, and keep a hotspot or the local setup ready.

**Legend:** ✅ built · 🟡 partial · ❌ not built.

What's built, and when: [`progress.md`](./progress.md). How to try each feature by hand: [`demo.md`](./demo.md).

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
4. **Navigation depends on role.** Members see Explore, Bookings, Badges. Managers also get **Manage**; admins also get **Admin**. One account can hold several roles. *(As built: the header has Explore, Bookings, Badges, and Manage for managers and admins, from `lg` up, with a hamburger menu below. The Admin console opens from the account menu, `components/UserMenu.jsx`, not from a header link.)*
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

**Status:** 🟡 Every step runs in the browser except "gets the missing badge" in step 2: the member's `/badges` page is a placeholder. See §11, step 3, for the workarounds.

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

| ID | Feature | Lifecycle step | Wow | Diff | Notes | Status |
|---|---|---|:-:|:-:|---|---|
| F-01 | Auth screens: register, OTP, login | — | 3 | 2 | Live **"Detected: UG · CSE · 2024"** chip from the email pattern; inline domain error; OTP resend countdown that respects `Retry-After` | ✅ `features/auth/`. The chip, strength bar, paste-friendly 6-box OTP and every countdown are built. The client checks only the email's format: the domain error is the server's `VALIDATION_ERROR`, shown under the field after submit |
| F-02 | ID-card upload + verification status | — | 2 | 1 | Drag-drop or camera; pre-filled member type and department; "browse-only until verified" banner | ✅ `features/verification/VerificationPage.jsx`: drag-drop, type and 5 MB checks, member type and department pre-filled from the email hints. The banner is in `AppLayout.jsx`. No `capture` attribute, but a phone's file picker still offers the camera |
| F-03 | **Demo role switcher** | demo | 2 | 1 | "Try as Student / Student 2 / Faculty / Manager / Admin" buttons on the login page, shown only when the API reports `DEMO_MODE` | ✅ `features/auth/DemoRoleSwitcher.jsx`, all five roles. **Known issue:** the buttons depend on one `getDemoConfig()` call with `.catch(() => {})` and no retry (`LoginPage.jsx:66–68`). If that call fails, for example while Render wakes from a cold start, the buttons never appear and nothing says why. A reload brings them back |
| F-04 | App shell: role-based nav, route guards, toasts, error boundary | all | 1 | 2 | `RequireAuth`, `RequireRole`, `RequireVerified`; error toasts show `requestId` | ✅ The nav, account menu, `RequireAuth`, `RequireRole` and toasts with `ref: <requestId>` are built. `RequireVerified` is built but on no route: booking checks verification itself (`ACCOUNT_VERIFIED`). **Known issues:** one error boundary covers the whole signed-in shell (`app/router.jsx:81`), so a page crash also hides the header. A 429 at boot reads "CAN'T REACH THE SERVER" (§8.3) |
| F-05 | Explore: search + filters + resource cards | 2 | 2 | 2 | Filters for unit, category, date, "only show what I can book"; card shows unit, risk level, approval mode, badges needed | 🟡 Search, unit, category pills, "only what I can book" and paging are built, and filters live in the URL. **No date filter.** Each card shows the unit, risk, approval mode, badges and location, and the whole card is a link |
| F-06 | Resource detail + **eligibility checklist** + weekly availability grid | 2 | 3 | 3 | ✅/❌ per rule with fix links; usage rules; busy blocks (no names); quota meter | ✅ `pages/ResourceDetailPage.jsx`: checklist with fix links, rules in a sticky column, 7-day grid (busy, closed, closure), quota meter, plus edit and report links for the unit's managers. **Known issue:** stale checklist after booking (§8.2) |
| F-07 | Booking panel with **live pre-check** | 3, 4 | 3 | 2 | Debounced `POST /bookings/check` as the slot changes; "Join waitlist as #2" when the slot is taken | ✅ `BookingPanel.jsx`: 400 ms debounce, the slot picked on the grid or from day and time lists, "join the waitlist as #n" on a taken slot, `INELIGIBLE` shown as a checklist |
| F-08 | My bookings + booking detail with **timeline** | 10 | 3 | 2 | Tabs: Upcoming / Requests / Past; detail shows only the actions valid for the current state | ✅ `features/bookings/`. Tabs are in the URL. The detail page shows the decision reason, the actions from `allowedActions`, condition reports and the timeline |
| F-09 | Check-in / check-out wizard | 7, 8 | 3 | 2 | Checklist toggles, camera capture with client-side compression, overall condition, notes | ✅ `HandoverPage.jsx`, three steps. Check-out shows the check-in photos. Photos are optional and need Cloudinary |
| F-10 | Manager: resource listing form | 1 | 2 | 3 | Sectioned form: basics → availability → eligibility → limits → checklist; Zod-validated | ✅ `features/manage/resources/`, with a Preview section and an error summary. It uses a Zod schema (`listingForm.js`) without React Hook Form. New listings start with Mon–Fri 09:00–17:00 (`listingForm.js:218`) |
| F-11 | Manager: review queue **grouped by conflicting slot** | 5, 6 | 3 | 3 | Competing requests side by side with their eligibility snapshots; approve / reject / waitlist with a mandatory reason | ✅ `RequestsPage.jsx` + `ConflictGroupCard.jsx`, polled every 30 s, with `ReasonDialog` quick picks |
| F-12 | Manager: handovers + **return confirmation** | 7–9 | 3 | 2 | Today's check-ins and returns; check-in vs check-out photos side by side; "All good" or "Report issue" | ✅ `HandoversPage.jsx` (three lists, overdue highlighted) and `ReturnConfirmPage.jsx` (reports side by side, the manager's own checklist, the timeline) |
| F-13 | Incidents: report, list, thread, resolve | 9 | 2 | 2 | Pre-filled from the booking; the resolve dialog needs an outcome and a rationale | ✅ `features/incidents/`: `?bookingId=` or `?resourceId=` pre-fill, filterable lists (manage and admin), thread, `ResolveDialog` |
| F-14 | Badges: my badges, request; manager queue and grant | 2, 4 | 2 | 2 | A fix link in the eligibility checklist deep-links here | 🟡 Manager side ✅ (`BadgeRequestsPage.jsx`: queue, evidence through a signed link, grant by email). **Member side ❌:** `/badges` is a placeholder (`pages/Placeholders.jsx`, the teammate's), so the fix link lands on it. `/profile` lists the user's badges |
| F-15 | Admin: verification queue, users and roles, audit log | 10 | 2 | 2 | ID image opens through a short-lived signed URL; audit table with filters | 🟡 Verification queue ✅ and audit log ✅. **Users and roles ❌** (`/admin/users`): `GET /admin/users` exists, but only the audit page's actor search uses it |
| F-16 | Notification bell + centre | 6–9 | 2 | 1 | Polls `unread-count` every 30 s; click-through to the related page | ✅ `NotificationBell.jsx` (latest 5, polls while the tab is visible) and `NotificationsPage.jsx` (unread filter, optimistic mark read, mark all read) |
| F-17 | Fair-usage quota meters | 6 | 3 | 1 | "4 of 6 h used this week" on resource detail and profile | 🟡 Resource detail ✅ (`QuotaMeter.jsx`). Profile ❌: no quota overview |
| F-18 | Responsive + accessible baseline | all | 2 | 2 | Works at 360 px wide; keyboard and screen-reader basics (§10.3) | ✅ Layouts are single-column on phones, with a hamburger menu below `lg`. §10.3 lists what is in place. Not measured at 360 px or with a screen reader in this review |

**Effort:** about 38 person-hours, which fits two frontend developers in hours 4–28 of the timeline.

---

## 3. Cool-to-have features (after MVP freeze)

| ID | Feature | Wow | Diff | Priority | Notes (backend dependency) | Status |
|---|---|:-:|:-:|:-:|---|---|
| FC-01 | **"How allocation works" transparency page** | 3 | 1 | P1 | Public page explaining caps, FIFO waitlist, no-show rules and human review. Cheap fairness points | ❌ No `/how-it-works` route. The path falls through to `/explore`, or to `/login` when signed out |
| FC-02 | **Audit integrity badge** | 4 | 1 | P1 | "✔ Audit chain verified: 1,284 entries" on the admin audit page (C-02) | ❌ The audit API leaves `prevHash` / `hash` out |
| FC-03 | **Guided judge tour** | 3 | 1 | P1 | `react-joyride` walkthrough of the golden path for each demo role | ❌ `docs/demo.md` §3 is the written version |
| FC-04 | **Smart alternatives panel** | 4 | 1 | P1 | On `SLOT_TAKEN`: "Next free: today 4–6 pm · Similar: GPU Workstation #2" (C-03) | ❌ `SLOT_TAKEN` offers the waitlist only |
| FC-05 | **QR pass + QR scanner** | 4 | 2 | P1 | Borrower shows the QR (`qrcode.react`); manager scans it (`html5-qrcode`) to check in or out (C-04) | ❌ |
| FC-06 | **AI "Describe what you need" search** | 5 | 2 | P1 | Query → ranked results with "why this matches"; **"AI searches left today: 3/5"** meter; when the quota is out or AI is down, falls back to normal search with a friendly note (C-05) | ❌ No AI features in the client. The incident page shows an AI summary card only if the server ever sends one |
| FC-07 | **"Why am I #3?" priority explainer** | 4 | 2 | P1 | Score breakdown bars for waitlisted users; managers see the ranking as a recommendation (C-06) | ❌ The waitlist position is shown, without a breakdown |
| FC-08 | Extension request UI | 2 | 1 | P1 | From booking detail; shows a conflict result (C-07) | ❌ |
| FC-09 | Reliability card on profile | 3 | 1 | P1 | On-time returns, no-shows, strikes, with the reason for each (C-09) | ❌ `/profile` shows only the strike count and any suspension |
| FC-10 | Real-time toasts and live status | 3 | 2 | P2 | `socket.io-client`; invalidates the matching queries on events (C-10) | ❌ The app polls instead (§8.2) |
| FC-11 | WhatsApp opt-in settings | 2 | 1 | P2 | Phone in E.164 format, explicit consent checkbox, test-message button (C-12) | ❌ |
| FC-12 | **In-browser ID-card OCR check** | 4 | 3 | P2 | `tesseract.js` reads the roll number **on the device** and compares it with the email-derived one: "✔ Roll number matches your email". The image is never sent to an AI | ❌ |
| FC-13 | AI before/after diff view | 5 | 3 | P2 | Highlights suggested differences on the return-confirmation screen, clearly labelled "AI suggestion" (C-15) | ❌ Reports are shown side by side, without a diff |
| FC-14 | Analytics dashboard | 4 | 3 | P2 | `Recharts`: utilisation by resource, **underused resources list**, hour × weekday demand heatmap, Gini gauge (C-16) | ❌ `/manage` shows count cards only |
| FC-15 | Calendar view with drag-select | 3 | 3 | P2 | `react-big-calendar` week view for picking a slot | ❌ The 7-day `AvailabilityGrid` takes a click for the start and another for the end |
| FC-16 | Training micro-quiz | 4 | 2 | P2 | 5 questions → instant badge for self-serve badges (C-13) | ❌ |
| FC-17 | Campus map of resource locations | 3 | 2 | P3 | `react-leaflet` with building pins | ❌ |
| FC-18 | Dark mode | 2 | 1 | P3 | Tailwind `dark:` variant plus a toggle | ❌ |
| FC-19 | PWA (installable, offline shell) | 2 | 2 | P3 | `vite-plugin-pwa` | ❌ |
| FC-20 | Hindi / English toggle | 2 | 2 | P3 | `react-i18next` | ❌ |
| FC-21 | Download booking record (PDF) | 2 | 1 | P3 | Calls C-21 | ❌ |

**Suggested P1 order:** FC-01 → FC-03 → FC-04 → FC-02 → FC-05 → FC-06 → FC-07 → FC-08 → FC-09. Each one can only ship after the backend feature it depends on.

---

## 4. Tech and libraries

| Concern | Choice | Why |
|---|---|---|
| UI library | **React 19** (`react`, `react-dom` 19) | Rendered under `StrictMode` (`main.jsx`) |
| Build | **Vite** (8, builds with Rolldown) | Fast dev server; `/api` proxy to `localhost:5000`; vendor chunks in `vite.config.js` |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite`) | Design tokens in `@theme`; no CSS files to manage |
| Accessible primitives | **Headless UI** | Dialog, Menu, Listbox, Tabs, Switch with focus management built in. *As built, only Dialog (`components/ui/Dialog.jsx`) and Menu (the bell and the account menu) are used. Tabs are hand-built (`role="tablist"`), and selects are native `<select>`* |
| Icons | **lucide-react** | |
| Routing | **React Router** (data-router API) | Nested layouts per role |
| Server state | **TanStack Query** | Caching, polling, invalidation, retries |
| Client state | **Zustand** | Auth (access token in memory) and small UI state only |
| Forms | **React Hook Form + Zod** (`@hookform/resolvers`) | The same rules as the server (§9), checked **on the client only**. The server doesn't use Zod: its services check every input themselves (`server/src/services/params.js`). *As built: React Hook Form + `zodResolver` on login and register only. The listing form runs a Zod schema over its own state (`features/manage/resources/listingForm.js`). The other forms use plain checks (`lib/reason.js`, `bookings/components/handoverForm.js`, …)* |
| HTTP | **axios** | Interceptors for the bearer token, refresh and error normalisation. The base URL is fixed at `/api/v1` (`lib/http.js`), so **the client has no environment variables**. Vite's proxy forwards `/api` in development, and the rewrite in `client/vercel.json` does it on Vercel |
| Dates | **date-fns + date-fns-tz** | IST formatting. *As built, both are installed but nothing imports them. The IST helpers in `lib/time.js` use the fixed +05:30 offset and `Intl.DateTimeFormat`* |
| Toasts | **sonner** | |
| Motion | **framer-motion** | Page and list entrances, menu and dialog openings, sliding active indicators. Opacity and transform only; `<MotionConfig reducedMotion="user">` drops the movement for reduce-motion users. Presets in `lib/motion.js`, `StaggerList` / `StaggerItem` / `FadeUp` in `components/Motion.jsx` |
| Images | **browser-image-compression** | Photos ≤ 1 MB / 1600 px before upload (saves Cloudinary quota and mobile data) |

---

## 5. Folder structure

```
client/
├── index.html
├── vite.config.js            # react(), tailwindcss(), server.proxy['/api'], vendor chunks (Rolldown codeSplitting)
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

**As built** (🟡 the layout differs from the plan above):
- `pages/` holds only `ExplorePage`, `ResourceDetailPage` and `Placeholders` (the `/badges` placeholder). Every other page lives in its feature folder (e.g. `features/bookings/MyBookingsPage.jsx`) and is lazy-loaded through `components/LazyPages.jsx`.
- `features/` has `auth`, `verification`, `resources` (with the eligibility checklist), `bookings` (with the condition-report steps), `incidents`, `notifications`, `manage` (dashboard, listing form, badge queue), `admin` (verification queue, audit log), `profile` and `uploads`. There are no `eligibility/`, `condition/`, `badges/` or `audit/` folders, and no per-feature `schemas.js`.
- `app/layouts/` has `AppLayout`, `ManageLayout` and `AdminLayout`. The auth pages use `features/auth/AuthLayout.jsx` instead of a `PublicLayout`.
- `components/ui/` has Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorBoundary, ErrorState, Input, Pagination, ReasonDialog, Select, Skeleton and StatusBadge. There is no Tabs or DataTable. `components/` also holds `PhotoUploader`, `BookingTimeline`, `NotificationBell`, `UserMenu`, `AccountFace`, `Motion` and `LazyPages`.
- `lib/schemas/` holds only `auth.js`. `lib/` also has `motion.js`, `errors.js`, `bookingStatus.js`, `reason.js`, `paging.js`, `staleChunk.js` and `utils.js`.
- `client/vercel.json` also sets the CSP and the security headers.

---

## 6. Route map and page specs

### 6.1 Public

| Route | Page | Key UI | API | Status |
|---|---|---|---|---|
| `/login` | Login | Email and password; **demo role buttons** (DEMO_MODE); lockout countdown on 429 | `POST /auth/login`, `POST /auth/demo-login` | ✅ The buttons need `GET /auth/demo-config`, which is fetched once with no retry (F-03) |
| `/register` | Register | Name, email (live `@nitjsr.ac.in` check + "Detected" chip), password strength | `POST /auth/register` | ✅ The "Detected" chip is live. The domain check is the server's, shown after submit |
| `/verify-otp` | OTP | 6-box input with paste support; resend with countdown | `POST /auth/verify-otp`, `POST /auth/resend-otp` | ✅ Submits itself on the 6th digit |
| `/how-it-works` | Transparency (FC-01) | Fair-use rules, waitlist, human review, privacy | static | ❌ No route |

### 6.2 Member (logged in)

| Route | Page | Key UI | API | Status |
|---|---|---|---|---|
| `/verification` | ID verification | Upload card; status card (pending / approved / rejected + reason + re-upload) | `POST /verification/id-card`, `GET /verification/status` | ✅ |
| `/explore` | Explore | Search bar, filter sidebar (sheet on mobile), resource grid, pagination | `GET /resources`, `GET /org-units` | 🟡 There is no date filter (F-05). The filters sit in one box above the grid on every screen size, not in a sidebar or sheet. The box keeps its size when a filter is set |
| `/resources/:id` | Resource detail | Header (unit, location, risk), rules, **EligibilityChecklist**, **AvailabilityGrid**, **QuotaMeter**, **BookingPanel** | `GET /resources/:id`, `/availability`, `/eligibility`, `POST /bookings/check`, `POST /bookings` | ✅ The rules column is sticky from `lg`, with no height cap. **Known issue:** after booking, the checklist and quota can stay stale until the window regains focus (§8.2) |
| `/bookings` | My bookings | Tabs: Upcoming (`approved`, `checked_in`) · Requests (`pending`, `waitlisted` with position) · Past | `GET /bookings/mine` | ✅ |
| `/bookings/:id` | Booking detail | StatusBadge, decision reason, state-aware action bar (cancel / check in / check out / report issue), condition reports, **BookingTimeline** | `GET /bookings/:id`, `/timeline`, `POST /bookings/:id/cancel` | ✅ Before the check-in window opens (15 min before the start), it says when it opens |
| `/bookings/:id/check-in` | Check-in wizard | ① checklist ② photos ③ confirm | `POST /uploads/images`, `POST /bookings/:id/check-in` | ✅ |
| `/bookings/:id/check-out` | Check-out wizard | Same as check-in; shows check-in photos for reference | `POST /bookings/:id/check-out` | ✅ |
| `/badges` | Badges | My badges (active, requested, expired), catalogue by unit, request dialog with optional evidence | `GET /badges`, `/badges/mine`, `POST /badges/:id/requests` | ❌ Placeholder (`pages/Placeholders.jsx`, imported in `components/LazyPages.jsx`), left for the teammate's page. The header's Badges link and the checklist's fix links lead to it. The API is ready |
| `/incidents/new` | Report incident | Type, severity, description, photos; `?bookingId=` pre-fill | `POST /incidents` | ✅ Also takes `?resourceId=` |
| `/incidents/:id` | Incident detail | Thread, status, resolution card | `GET /incidents/:id`, `POST /incidents/:id/comments` | ✅ Resolving is on this page too (`ResolveDialog`) |
| `/notifications` | Notifications | List, mark read, mark all read | `GET /notifications`, `PATCH …/read`, `PATCH …/read-all` | ✅ Has an unread filter |
| `/profile` | Profile (built) | Details (email, member type, department, roles, managed units), ID verification status with its reason and a link to `/verification`, my badges, strikes and suspension when present, console links by role (Manage; Admin: verifications, audit, incidents), Log out. Opened from the account menu (the name at the right of the header: Profile · ID verification · Admin console · Log out). Not built yet: quota overview, email notification toggle | `GET /auth/me` (re-read on opening), `GET /badges/mine`, `GET /org-units` | 🟡 No quota overview, no email toggle. **Known issue:** it tells a manager or admin without an approved card "Managers and admins can book without an ID card" (`features/profile/ProfilePage.jsx:53`, from `account.js:26–27`). The server's `ACCOUNT_VERIFIED` rule applies to everyone, so their booking is refused |

### 6.3 Manager (`/manage/*`, requires `manager`)

*As built, `RequireRole` lets in `manager` **or** `admin` (`app/router.jsx`), and any unknown `/manage/*` path redirects to `/manage`.*

| Route | Page | Key UI | API | Status |
|---|---|---|---|---|
| `/manage` | Dashboard | Count cards: pending requests, today's handovers, returns to confirm, open incidents | several `GET`s with `limit=1` for totals | ✅ It has a fifth card, badge requests, and every count is polled every 30 s. **Known issue:** with the bell, an open dashboard makes 6 requests every 30 s, or 60 per 5 min per tab. About five tabs on the shared demo Manager use up the server's per-user limit (300 per 5 min) before anyone clicks anything |
| `/manage/resources` | My unit's resources | Table with status toggles (active / maintenance) | `GET /resources?orgUnit=`, `PATCH /resources/:id/status` | ✅ The toggles are active, maintenance and archived, with a reason. Bookings are never cancelled, and the page reports how many each change affects |
| `/manage/resources/new` · `/:id/edit` | Listing form | Sections: Basics · Availability (weekly hours editor + blackouts) · Eligibility (member types, departments, badges, approval mode) · Limits · Condition checklist · Preview | `POST` / `PATCH /resources` | ✅ New listings start with Mon–Fri 09:00–17:00, every member type and manual approval |
| `/manage/requests` | Review queue | **Conflict groups**: one card per contested slot listing all requests with requester (name, member type, department), purpose, eligibility snapshot; actions with **ReasonDialog** | `GET /bookings/manage`, `POST …/approve \| reject \| waitlist` | ✅ Polled every 30 s |
| `/manage/handovers` | Today | Three lists: starting soon, in use (overdue highlighted), awaiting return confirmation | `GET /bookings/manage?status=…` | ✅ |
| `/manage/returns/:bookingId` | Confirm return | Check-in vs check-out photos and checklists side by side; manager's own checklist; "All good" or "Report issue" (opens the incident fields) | `POST /bookings/:id/confirm-return` | ✅ Also shows the booking's timeline |
| `/manage/incidents` · `/:id` | Incidents | Filterable list; detail with resolve dialog (outcome + rationale) | `GET /incidents`, `POST /incidents/:id/resolve` | ✅ |
| `/manage/badges` | Badge requests | Queue with evidence preview; grant directly to a user | `GET /badge-requests`, `PATCH /badge-requests/:id`, `POST /badges/:id/grant` | ✅ Evidence opens through a short-lived signed link. **Grant directly** takes the member's email |

### 6.4 Admin (`/admin/*`, requires `admin`)

*As built, there is no admin dashboard: `/admin`, and any unbuilt `/admin/*` path, redirects to `/admin/verifications`. Admins reach the console from the account menu.*

| Route | Page | Key UI | API | Status |
|---|---|---|---|---|
| `/admin/verifications` | Verification queue | List with email hints; "View ID" opens a signed URL in a dialog (watermark text: "Viewing is logged"); approve / reject with reason; confirm member type and department | `GET /admin/verifications`, `GET …/:userId/id-card`, `PATCH …/:userId` | ✅ |
| `/admin/users` | Users | Search, role editor (incl. managed units), suspend dialog with reason and until-date | `GET /admin/users`, `PATCH …/roles`, `PATCH …/suspend` | ❌ Redirects to the verification queue. `GET /admin/users` exists; the audit page's actor search uses it |
| `/admin/org-units` | OrgUnits | CRUD plus manager assignment | `/org-units` routes | ❌ Redirects to the verification queue |
| `/admin/incidents` | Escalations | High-severity incidents across all units | `GET /incidents?severity=high` | ✅ Opens on high severity, with a "Show every severity" button. The detail page is `/admin/incidents/:id` |
| `/admin/audit` | Audit log | **DataTable** filtered by entity, actor, action, date; row expands to show the before/after diff | `GET /audit` | ✅ A plain table (there is no DataTable component), with filters for entity type and id, actor (searched by name), action, unit and IST dates, all in the URL. For admins, the booking and incident pages link here |

---

## 7. Shared components

| Component | Used in | Behaviour | Status |
|---|---|---|---|
| `EligibilityChecklist` | Resource detail, booking panel, review queue | Renders `[{rule, passed, message, fixHint}]`; failed rules get a fix link (e.g. → `/badges?request=3d-printing-basics`) | ✅ `features/resources/components/`, used on the resource page and in the booking panel. The review queue uses its own `EligibilitySnapshot`. The badge fix link lands on the `/badges` placeholder |
| `AvailabilityGrid` | Resource detail, booking panel | 7-day × time-slot grid: open, busy, blackout, closed; keyboard navigable; click to select a range | ✅ `role="grid"` with a roving tab stop, arrow keys, Home / End and Page Up / Down. Click the start, then the end. Busy cells show how many units are in use, never who holds them |
| `BookingPanel` | Resource detail | Date and time pickers aligned to `slotMinutes`, purpose field, live pre-check result, submit / join-waitlist | ✅ Day and time `<select>` lists on the slot grid instead of date pickers, kept in step with the grid. Purpose 10–300 characters with a counter |
| `StatusBadge` | Everywhere | Colour + icon + label per state (§10.2) | ✅ `components/ui/StatusBadge.jsx`, styles in `lib/bookingStatus.js` |
| `BookingTimeline` | Booking detail, incident detail | Vertical timeline of audit events and condition reports with actor, time (IST) and reason | ✅ `components/BookingTimeline.jsx`, on booking detail and return confirmation. The incident page shows its comment thread and resolution card instead |
| `ConditionReportForm` | Check-in, check-out, return confirmation | Checklist toggles with notes, `PhotoUploader`, overall-condition radio | ✅ Under other names: the wizard steps in `features/bookings/components/HandoverSteps.jsx` (rules in `handoverForm.js`) and `features/manage/components/ReturnForm.jsx` |
| `PhotoUploader` | Condition, incidents, ID card | `<input type="file" accept="image/*" capture="environment">`, compression, thumbnails, max 3 | ✅ `components/PhotoUploader.jsx`, used for handovers, returns, incidents and listing photos. The ID-card form has its own drop zone (it also takes PDFs) |
| `ReasonDialog` | Reject, waitlist, cancel, resolve, suspend | Required textarea (10–500 chars) with a character counter, plus quick-pick templates ("Clashes with lab session", "Missing safety training") | ✅ Used to decide on bookings, cancel, reject badges and change a resource's status, most with quick picks. The verification decision (`features/admin/components/DecisionDialog.jsx`) and resolving (`ResolveDialog`) have dialogs of their own. There is no suspend dialog (no `/admin/users`) |
| `QuotaMeter` | Resource detail, profile | Progress bar plus text: "4 of 6 h this week · 1 of 1 active booking" | 🟡 Resource detail only. **Known issue:** it can stay stale after a booking (§8.2) |
| `NotificationBell` | App header | Unread badge, dropdown of the latest 5 | ✅ Lazy-loaded (`components/LazyPages.jsx`), with a look-alike placeholder while it loads. "See all" contrast fixed |
| `UserMenu` | App header | The signed-in user's initials and name; a menu with Profile, ID verification (with its status), Admin console (admins) and Log out. The header's links are Explore, Bookings, Badges and Manage (managers); below `lg` they and the account items move into the hamburger menu | ✅ `components/UserMenu.jsx`, lazy like the bell. Logout is in `features/auth/useLogout.js` |
| `RequireAuth` / `RequireRole` / `RequireVerified` | Router | Redirect to login, show a 403 page, or show a "verify to book" prompt | 🟡 `RequireAuth` ✅ and `RequireRole` ✅. `RequireVerified` is built but on no route: the shell's banner and the checklist's `ACCOUNT_VERIFIED` rule do that job |
| `DataTable`, `EmptyState`, `Skeleton`, `ErrorState` | Lists | Every list has loading, empty and error states, and the error state shows the `requestId` | 🟡 `EmptyState`, `Skeleton` and `ErrorState` (with `ref: <requestId>`) ✅, plus `Pagination`. No `DataTable`: the audit log is a plain table |

---

## 8. State, data fetching and auth flow

### 8.1 Auth flow
1. **App boot.** Call `POST /auth/refresh` (the httpOnly cookie travels automatically, same-origin through the Vercel rewrite).
   - On success: store `accessToken` in Zustand **memory only**, then call `GET /auth/me`.
   - On failure: the user is treated as logged out.
2. **Every request:** the axios request interceptor adds `Authorization: Bearer <token>`.
3. **On 401 `UNAUTHENTICATED`:** the response interceptor refreshes **once**, using a single-flight promise so 5 parallel 401s trigger 1 refresh, then retries the original request. If the refresh fails, it clears the store and sends the user to `/login?next=…`.
4. **Logout:** `POST /auth/logout`, clear the store, then `queryClient.clear()`.

**Status:** ✅ as written (`features/auth/RequireAuth.jsx`, `lib/http.js`, `features/auth/useLogout.js`). The refresh answer carries the user, so `GET /auth/me` runs only when it doesn't. A Web Lock also serialises refreshes across tabs. **Known issue:** every tab shares the refresh cookie. If a second tab signs in as someone else, the first tab's next refresh quietly switches it to that user (`refreshSession`, `lib/http.js:50–55`, stores whoever the cookie belongs to). In a demo, use a private window or a second browser for a second user, as `demo.md` §1 says.

### 8.2 Query keys and invalidation

The keys as the app builds them: each feature's `api.js` exports its key factory (`resourceKeys`, `bookingKeys`, `incidentKeys`, `notificationKeys`, `badgeRequestKeys` / `badgeKeys`, `manageResourceKeys`, `adminKeys`, `auditKeys`, `verificationKeys`, `orgUnitKeys`; the dashboard's `incidentCountKey` is in `features/manage/dashboard/counts.js`), and pages build their keys through these. Object parts are the request's normalised query parameters, so two pages asking for the same thing share one cache entry. The signed-in user is not a query: it lives in the Zustand store (`POST /auth/refresh` and `GET /auth/me` at boot, `GET /auth/me` again after a verification change).

"On focus" means `staleTime: 0`: refetched whenever a page mounts it and when the window regains focus. The api.js hooks retry a read once on a network error or a 5xx and never on a 4xx (`retryReads`, lib/errors.js); the four queries written in the verification pages use the client default (one retry). Lists keep the previous page on screen while the next one loads, but never another filter's or tab's rows.

| Query key | Source | Refetch |
|---|---|---|
| `['resources', params]` | `GET /resources` (Explore) | stale after 60 s (matches the server cache) |
| `['resources', 'manage', params]` | `GET /resources` (`/manage/resources`) | on focus |
| `['resources', 'reportable', params]` | `GET /resources?status=active,maintenance` (the report page's resource picker) | stale after 60 s |
| `['resources', 'incident-filter', params]` | `GET /resources?status=active,maintenance,archived&limit=50` (the incident list's resource filter) | stale after 5 min |
| `['resource', id]` | `GET /resources/:id` | stale after 5 min |
| `['resource', id, 'availability', { from, to }]` | `GET /resources/:id/availability` (the 7-day grid) | stale after 15 s |
| `['resource', id, 'eligibility', null]` | `GET /resources/:id/eligibility` (checklist and quota) | on focus |
| `['resource', id, 'eligibility', { start, end }]` | `POST /bookings/check` (the booking panel's live pre-check; saves nothing) | on focus |
| `['org-units', 'active']` | `GET /org-units` (Explore's filter, the ID-card form, the admin queue) | stale after 5 min |
| `['bookings', 'mine', { status, page, limit }]` | `GET /bookings/mine` | on focus |
| `['bookings', 'manage', filters]` | `GET /bookings/manage` (review queue, handovers, dashboard counts) | **every 30 s** while open |
| `['booking', id]`, `['booking', id, 'timeline']` | `GET /bookings/:id`, `GET /bookings/:id/timeline` | on focus |
| `['notifications', 'unread-count']` | `GET /notifications/unread-count`; also set from each list answer's `meta.unread` | **every 30 s** while the tab is visible, and on focus |
| `['notifications', 'list', { unread, page, limit }]` | `GET /notifications` (the bell: the latest 5, fetched each time it opens; the page: 20 a page) | on focus |
| `['badge-requests', { status, page, limit }]` | `GET /badge-requests` (`/manage/badges`; the dashboard's count) | on focus; the dashboard count every 30 s |
| `['badges', 'catalogue']` | `GET /badges` (the listing form's badge picker) | stale after 5 min |
| `['badges', 'catalogue', { orgUnit }]` | `GET /badges?orgUnit=` (the grant dialog: one per managed unit, `orgUnit: null` for an admin) | stale after 60 s |
| `['badges', …]`, e.g. `['badges', 'mine']` | the member's `/badges` page (a teammate's; keys other than `'catalogue'` are its own). `/profile` reads `GET /badges/mine` under `['badges', 'mine']` too and caches the whole envelope `{ success, data, requestId }`; its reader (`myBadgeRows`) also accepts a bare array, in case the `/badges` page caches that | its own; badge decisions and grants invalidate `['badges', 'mine']`; `/profile`: stale after 60 s |
| `['auth', 'me']` | `GET /auth/me` on opening `/profile`; the answer is stored in the auth store | on every visit |
| `['incidents', params]` | `GET /incidents` (`/manage/incidents`, `/admin/incidents`) | on focus |
| `['incidents', 'count', { status: 'open,in_review', page: 1, limit: 1 }]` | `GET /incidents` (the dashboard's open-incident count) | **every 30 s** |
| `['incident', id]` | `GET /incidents/:id` | on focus |
| `['verification', 'status']` | `GET /verification/status` | on focus |
| `['admin', 'verifications', status, page]` | `GET /admin/verifications` | on focus |
| `['audit', params]` | `GET /audit` (off while the filter form has an error) | on focus |
| `['admin', 'users', { q, limit: 5 }]` | `GET /admin/users?q=` (the audit log's actor search, from 2 characters) | stale after 30 s |

**Known issue (the one place the code breaks this table):** with no slot chosen, `useBookingCheck` (`features/resources/components/BookingPanel.jsx:356`) builds the same key as the checklist, `['resource', id, 'eligibility', null]` (`resourceKeys.eligibility`, `features/resources/api.js:153`). The two hooks have different request functions but share one cache entry. So after a booking, the checklist and the quota can stay stale until the window regains focus or the page is reopened. The fix is a key of its own for the pre-check, under the same prefix.

Never cached: the ID-card link (`GET /admin/verifications/:userId/id-card`) and the badge-evidence link (`GET /badge-requests/:id/evidence`) are mutations, because each opening is one audited request and the signed URL expires.

Invalidation is by prefix, so `['resources']` also refreshes the manager's list and both incident pickers, `['incidents']` the dashboard's incident count, and `['bookings']` every booking list and count.

| Mutation | Invalidates | Also |
|---|---|---|
| Create booking, approve / reject / waitlist, cancel, check-in, check-out | `['bookings']`, `['booking', id]`, `['resource', resourceId, 'availability']`, `['resource', resourceId, 'eligibility']` | the same after `INVALID_TRANSITION`, `NOT_FOUND`, `SLOT_TAKEN` or `INELIGIBLE`, as the screen is out of date |
| Confirm return | the same, plus `['incidents']` when it opened an incident | |
| Resource create | `['resources']` | the answer goes straight into `['resource', id]` |
| Resource edit / status change | `['resources']`, `['resource', id]` (so its availability and eligibility too) | edit writes the answer into `['resource', id]`; the same keys after `INVALID_TRANSITION` / `NOT_FOUND` |
| Report incident, comment | `['incidents']`; for an incident on a booking, `['booking', bookingId]` | the answer goes into `['incident', id]` |
| Resolve incident | `['incidents']`; for an incident on a booking, `['booking', bookingId]` and `['bookings']` (a resolve may complete the booking) | the answer goes into `['incident', id]`; `INVALID_TRANSITION` / `NOT_FOUND` / `FORBIDDEN` refetch `['incident', id]` |
| Badge decision, direct grant | `['badge-requests']`, `['badges', 'mine']` | a request decided elsewhere refetches `['badge-requests']`; granting a badge that is gone refetches `['badges']` |
| Verification decision (admin) | `['admin', 'verifications']` | also after `INVALID_TRANSITION` / `NOT_FOUND`, or a 404 on "View ID" |
| ID-card upload | none | the answer goes into `['verification', 'status']` and `GET /auth/me` into the store; a 409 refetches `['verification', 'status']` |
| Mark read, mark all read | `['notifications']` once settled | mark read is optimistic (below) |
| The unread count goes up (the bell notices) | `['notifications', 'list']` | |
| Logout | `queryClient.clear()` | |

**No optimistic updates on lifecycle actions.** Approvals, check-ins and the like wait for the server's answer so the UI never shows a state the server rejected; each mutation's `onSuccess` returns its invalidation, so the button stays busy until the refetched data is on screen. Optimistic updates are used only for "mark notification read": the lists and the count change at once and roll back if the request fails.

### 8.3 Error handling
- `http.js` normalises every error to `{ status, code, message, details, requestId }`.
- `VALIDATION_ERROR` is mapped onto form fields via `setError(detail.path, …)`.
- `INELIGIBLE` is rendered as an `EligibilityChecklist`, not a toast.
- `SLOT_TAKEN` brings up "Join waitlist?" (and the alternatives panel once C-03 is done).
- `RATE_LIMITED` and `AI_QUOTA_EXCEEDED` read `Retry-After` / `resetsAt` and show a countdown.
- Anything else shows a toast "Something went wrong (ref a1b2c3)".

**Status:** ✅ for the first four. `RATE_LIMITED` countdowns are on login, register, OTP and the booking panel. `AI_QUOTA_EXCEEDED` has nothing to show yet, as there are no AI features. Most pages show a failed read as an inline `ErrorState` with its `ref`, not a toast. **Known issue:** at boot, `RequireAuth` shows any failure other than a 401, a 429 included, as "CAN'T REACH THE SERVER" with a Retry button (`features/auth/RequireAuth.jsx:88`). A rate-limited user is told the server is down.

---

## 9. Client-side validation

Zod schemas in `lib/schemas/` mirror the server rules in [`backend.md` §7](./backend.md#7-validation-catalogue) and are wired through `zodResolver`. **The client gives instant feedback, and the server stays authoritative.**

*As built, only login and register go through `zodResolver` (`lib/schemas/auth.js`). The listing form runs a Zod schema over its own state, and the other forms check by hand (§4). The client's checks match [`api.md`](./api.md) or are stricter.*

| Form | Client rules | Status |
|---|---|---|
| Register | Email must end in `@nitjsr.ac.in` (inline: "Use your college email"); `emailPattern` shows the "Detected: UG · CSE · 2024" chip or "Faculty/staff email: you'll upload a faculty ID card"; password 8–72 characters, a letter and a digit, with a strength bar | 🟡 The chip, password rules and strength bar are built. The client checks only the email's format, because the allowed domains are server config (`ALLOWED_EMAIL_DOMAINS`). A wrong domain comes back as the server's `VALIDATION_ERROR`, shown under the field |
| OTP | Exactly 6 digits; auto-submits on the 6th | ✅ |
| ID upload | jpg/png/webp/pdf, ≤ 5 MB (checked before upload), preview | ✅ Images are compressed first, so the 5 MB check runs after compression |
| Booking panel | `end > start`; aligned to `slotMinutes`; past times disabled; closed hours greyed out in the grid; purpose 10–300 characters with a counter | ✅ |
| Listing form | Title 3–120; at least one member type; open < close for each weekday; blackout start < end; `minDuration ≤ maxDuration`; 1–10 checklist items; quantity 1–50 | ✅ `features/manage/resources/listingForm.js` |
| Reason dialog | 10–500 characters, required | ✅ `lib/reason.js` |
| Condition report | Every checklist item answered; a note is required on any item marked "not OK"; 0–3 photos | ✅ `features/bookings/components/handoverForm.js` |
| Incident | Type and severity required; description 20–2000 | ✅ |

---

## 10. Design system and accessibility

### 10.1 Tokens (Tailwind v4 `@theme`)
- **Brand:** a neutral teal/slate palette. The NIT JSR official colours and logo are deliberately not used; this is an independent prototype. *As built, the palette is not teal/slate. `styles/index.css` `@theme` holds a "Hacktoberfest" palette: forest green `#183d2d`, cream `#f5f0e8`, red `#c0392b` and amber `#e67e22`, with 2 px near-black (`#1a1a1a`) borders and hard offset shadows. The NIT JSR colours and logo are still not used.*
- **Font:** Inter (or the system stack). Base size 16 px, line height 1.5. *As built: Inter for body text and JetBrains Mono for most UI text, both loaded from Google Fonts in `index.html`.*
- **Layout:** radius `rounded-xl` for cards and `rounded-lg` for inputs; 4-px spacing scale; max content width `max-w-6xl`. ✅

### 10.2 Booking status styles

✅ As built in `lib/bookingStatus.js` and shown by `StatusBadge`. `expired` uses a lighter slate than `cancelled`.

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
- `prefers-reduced-motion` is respected: framer-motion's `reducedMotion="user"` skips every transform, and the CSS spinners use `motion-safe:`. *As built, three spinners use a plain `animate-spin`: `components/ui/Button.jsx:65`, `features/auth/RequireAuth.jsx:68` and `features/auth/VerifyOtpPage.jsx:308`. A global `prefers-reduced-motion` rule in `styles/index.css` cuts every CSS animation to a single 0.01 ms run, so they stop anyway.*
- Tap targets are at least 44 × 44 px on the check-in and check-out screens.
- Images have alt text; condition photos use "Check-in photo 1 of 3, FDM 3D Printer".

**Status:** ✅ The code has each item: the skip link and landmarks in `AppLayout.jsx`, focus trapped in Headless UI dialogs, the grid's keyboard model, `aria-live` announcements, focus moved after every action, contrast fixes on the console tabs, 44 px handover targets and photo alt text. The spinner gap is noted above. No automated check (axe) or screen-reader pass is recorded.

---

## 11. Judge golden path (demo script)

**Status:** 🟡 11 of 12 steps can be done in the UI today, three of them with caveats (5, 7, 11). Step 3 can't. Over HTTP, `cd server && npm run golden-path` passes all 12. Run `npm run seed` again afterwards, because the run leaves the Student holding *3D Printing Basics*. Before a judged run:
- **Timing:** check-in opens 15 min before the start, so "tomorrow 10:00–12:00" (step 5) blocks steps 8–11 until tomorrow. For one sitting, use the same-day variant in [`demo.md` §3](./demo.md#3-the-judge-script-the-main-demo): in step 1, give opening hours that cover now and set *Book at least this far ahead* to 0; in step 5, pick a start within the next 15 min.
- **Network:** some networks block `*.vercel.app` (see the status section at the top). Open the site from the judging network first.
- **Cold start:** if the Render API has been idle, open the site a minute early. Otherwise the demo buttons may not appear (F-03).

| # | Login as | Do | Expect to see | In the UI today? |
|---|---|---|---|---|
| 1 | **Manager** | Manage → Resources → New: "FDM 3D Printer #2" (DIC), requires *3D Printing Basics*, manual approval, max 4 h, 6 h/week | Resource listed; audit entry `resource.created` | ✅ Manage → Unit Resources → New resource. The form starts with Mon–Fri 09:00–17:00, so on a Saturday, or outside those hours, add today's hours for the same-day run |
| 2 | **Student** | Explore → search "3D printer" → open it | Eligibility checklist: ❌ *Missing badge: 3D Printing Basics → Request it* | ✅ |
| 3 | Student | Click the fix link → request the badge | Badge shows "Requested" | ❌ The fix link opens the `/badges` placeholder. Instead, request the badge over the API ([`demo.md` §5](./demo.md#5-requesting-a-badge-without-the-badges-page)), or skip to step 4 and use **Grant directly** |
| 4 | **Manager** | Manage → Badges → approve | Student gets a notification; the checklist turns ✅ | ✅ Approve, or **Grant directly** → *3D Printing Basics* → `student@demo.campuscommons.test`. The Student's checklist turns ✅ when the page is reloaded or refocused |
| 5 | Student | Book tomorrow 10:00–12:00 with a purpose | Live pre-check all ✅ → status **Awaiting review** | 🟡 Works, but see **Timing** above. **Known issue:** afterwards, the checklist and quota on the page can stay stale until refocus (§8.2) |
| 6 | **Student 2** | Book an overlapping slot | "Slot held by an earlier request" → joins as **Waitlisted #1** | ✅ "Every rule passes, but an earlier request holds this slot. You can join the waitlist as #1." |
| 7 | **Manager** | Manage → Requests: both requests shown in one conflict group → approve the student | Student: **Approved** (notification + email); Student 2 stays waitlisted with the reason shown | 🟡 The conflict group and approval work, and the in-app notification arrives. **No email:** booking events aren't emailed yet (B-18) |
| 8 | Student | Booking → **Check in** → checklist + photo | Status **In use**; timeline updated | ✅ Opens 15 min before the start. Photos need Cloudinary and are optional |
| 9 | Student | **Check out** → checklist + photo, notes "Bed slightly scratched" | Status **Returned, awaiting confirmation** | ✅ |
| 10 | **Manager** | Manage → Handovers → Confirm return → photos side by side → **Report issue** (damage, low) | Booking **Issue reported**; incident created | ✅ |
| 11 | **Admin** (or Manager) | Incident → resolve: *Warning*, with rationale | Booking **Completed**; both parties notified | 🟡 Resolving works. The Admin opens the console from the account menu, but **Escalations opens on high severity**, so the low-severity incident from step 10 appears only after **Show every severity**. Alternatively, the Manager resolves it from Manage → Incidents |
| 12 | Student and Admin | Booking timeline; Admin → Audit filtered by this booking | The full history, each step with actor, time and reason | ✅ For the Admin, the booking page links to the audit log already filtered to the booking |

**Seeded extras** let judges explore beyond the script (✅ all four are made by `npm run seed`; see `demo.md` §2):
- a `no_show` booking
- an overdue in-use booking created by the seed
- a rejected request with its reason
- a pending ID verification in the admin queue

The testing instructions in the submission list all demo logins.

---

## 12. Third-party packages (to disclose in the submission)

| Purpose | Packages |
|---|---|
| Core (MVP) | `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `zustand`, `axios`, `react-hook-form`, `@hookform/resolvers`, `zod`, `tailwindcss`, `@tailwindcss/vite`, `@headlessui/react`, `lucide-react`, `sonner`, `date-fns`, `date-fns-tz`, `browser-image-compression`, `framer-motion`. *All are in `client/package.json`. `date-fns` and `date-fns-tz` are not imported yet (§4)* |
| Dev | `vite`, `@vitejs/plugin-react`, `eslint`, `prettier`, `@tanstack/react-query-devtools`. *As built (`client/package.json`): `vite`, `@vitejs/plugin-react`, `oxlint` (instead of ESLint), `@types/react` and `@types/react-dom`. There is no Prettier or React Query Devtools. Tests use Node's own `node --test`* |
| Cool-to-have | `qrcode.react`, `html5-qrcode`, `react-joyride`, `socket.io-client`, `tesseract.js`, `recharts`, `react-big-calendar`, `react-leaflet`, `leaflet`, `vite-plugin-pwa`, `react-i18next`. *None are installed yet* |
