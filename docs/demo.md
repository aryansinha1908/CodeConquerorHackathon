# ShareX: demo and testing guide

How to try every feature that is built, by hand, in the browser. Each section says who to sign in as, where to click and what you should see. Times are in IST everywhere.

The quick version is [§3, the judge script](#3-the-judge-script-the-main-demo): twelve steps that cross every role. [§4](#4-feature-tour-by-area) covers everything else, area by area, and [§6](#6-not-built-yet) lists what isn't built, so you don't go looking for it.

---

## 1. Before you start

**Once:**

1. `server/.env` has:
   - `MONGODB_URI` ending in `/campuscommons`;
   - `REDIS_URL=redis://127.0.0.1:6379` (the local Redis);
   - three different secrets;
   - `DEMO_MODE=true`;
   - a `SEED_PASSWORD`.

   See `README.md` "Run it locally".

2. Seed the demo data: `cd server && npm run seed`. **Without it, the demo buttons answer "The demo accounts haven't been created yet."**

**Each session**, in two terminals:

```
cd server && npm run dev      # API on http://localhost:5000
cd client && npm run dev      # app on http://localhost:5173
```

Then:

- <http://localhost:5000/health> should say `"mongo":"up","redis":"up"`.
- Open <http://localhost:5173>: the ShareX landing page, open without signing in. **Log in** at the top right leads to the demo buttons.
- To switch users, click your name at the right of the header → **Log out**, then press another demo button.
- To have two people signed in at once, use a second browser or a private window.

**What your current `.env` leaves out, and what that changes:**

| Not set        | Effect on the demo                                                                                                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`    | Nothing is emailed. Sign-up codes (OTPs) are printed in the **server terminal** instead. In-app notifications work as normal                                                                                                                                                                                         |
| `CLOUDINARY_*` | Every upload answers "Uploads aren't configured" (503): condition photos, ID cards and badge evidence. Photos are optional at check-in, check-out and return, so the booking flow still works without them. To demo ID-card upload, viewing an ID card and badge evidence, fill these keys in and restart the server |
| `GEMINI_API_KEY` | AI search and the AI photo comparison say "AI isn't set up on this server yet"; keyword search and everything else work. Get a free key at Google AI Studio and restart the server. The on-device ID-card check doesn't need it: it runs in the browser |

**AI limits:** each account gets 5 AI requests a day (a demo account: 5 per visitor, and all demo accounts 30 together), with 10 seconds between requests. Asking the same thing again is free (answers are cached for 24 hours). The "AI requests left today" meter shows what's left.

**Resetting:** `npm run seed` again at any time. It is idempotent: it recreates the 16 demo bookings relative to the current time and resets the demo student's badges, so the judge script works again. It deletes nothing else.

---

## 2. Demo accounts

On the login page, each **demo button** signs in with no password. The same accounts also work through the normal form, with `SEED_PASSWORD`.

| Button        | Email                                | Who                                                                                            | Useful for                                                                         |
| ------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Student**   | `student@demo.campuscommons.test`    | Ananya Rao, UG, CSE. Holds _Electronics Lab Safety_, **not** _3D Printing Basics_              | The member side; the missing-badge checklist                                       |
| **Student 2** | `student2@demo.campuscommons.test`   | Kabir Singh, UG, Mechanical. Holds _3D Printing Basics_                                        | The waitlist; a second borrower                                                    |
| **Faculty**   | `faculty@demo.campuscommons.test`    | Dr. Kavya Nair, faculty, ECE                                                                   | Resources open only to PG, research scholars and faculty                           |
| **Manager**   | `manager@demo.campuscommons.test`    | Meera Iyer, manager of the **Design and Innovation Centre (DIC)** and the **Central Workshop** | Listings, request queue, handovers, badges, incidents of those two units           |
| **Admin**     | `admin@demo.campuscommons.test`      | Campus Admin                                                                                   | ID verification, audit log, every incident; also decides for units with no manager |
| (no button)   | `newstudent@demo.campuscommons.test` | Rohan Mehta, UG, Electrical. ID card pending                                                   | Shows up in the admin's verification queue                                         |

**Who decides which bookings:** the seed gives only the DIC and the Central Workshop a manager. Bookings on every other unit's resources (Library, Computer Centre, SAC, CIIC, the departments) are decided by the **Admin**, who also has the full `/manage` console.

### The seeded resources

| Resource                                 | Unit             | Who can book    | Badge needed               | Approval |
| ---------------------------------------- | ---------------- | --------------- | -------------------------- | -------- |
| FDM 3D Printer                           | DIC              | everyone        | 3D Printing Basics         | manual   |
| CO₂ Laser Cutter                         | DIC              | everyone        | Laser Cutter Operation     | manual   |
| Centre Lathe                             | Central Workshop | everyone        | Workshop Safety Induction  | manual   |
| Arc Welding Bay                          | Central Workshop | everyone        | Workshop Safety Induction  | manual   |
| GPU Workstation                          | Computer Centre  | everyone        | GPU Usage Policy           | instant  |
| Digital Storage Oscilloscope             | ECE              | everyone        | Electronics Lab Safety     | instant  |
| IoT Starter Kit (a loan of up to 3 days) | CSE              | everyone        | —                          | instant  |
| Total Station                            | Civil            | PG, RS, faculty | Survey Instrument Training | manual   |
| Optical Microscope                       | MME              | PG, RS, faculty | —                          | manual   |
| Discussion Room A                        | Central Library  | everyone        | —                          | instant  |
| DSLR Camera Kit                          | SAC              | everyone        | —                          | manual   |
| Camera Drone                             | SAC              | everyone        | Drone Flight Safety        | manual   |
| Meeting Room                             | CIIC             | everyone        | —                          | manual   |

Most open Mon–Sat, 09:00–17:00. Each resource page shows its exact hours and limits.

### The seeded bookings (16, in every status)

The seed makes these through the real services, so each has its timeline, audit entries and notifications:

| Status                              | Booking                                                                | Where to see it                                         |
| ----------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Completed                           | Student 2's printer; Student's oscilloscope; Manager's discussion room | My bookings → Past                                      |
| **Issue reported** (flagged)        | Student 2's printer, with an open incident                             | Manager → Incidents; resolving it completes the booking |
| **No-show**                         | Student's discussion room                                              | Student → My bookings → Past                            |
| Expired                             | Faculty's microscope request (nobody decided before the start)         | Faculty → My bookings → Past                            |
| **Returned, awaiting confirmation** | Student 2's printer                                                    | Manager → Handovers → Confirm return                    |
| **In use, overdue**                 | Faculty's DSLR kit, with a delay incident from the sweeper             | Admin → Handovers (highlighted); Admin → Incidents      |
| In use                              | Student 2's IoT kit                                                    | Student 2 → My bookings → Upcoming                      |
| Cancelled                           | Student's oscilloscope                                                 | Student → My bookings → Past                            |
| **Rejected, with its reason**       | Student 2's printer                                                    | Student 2 → My bookings → Past                          |
| Pending                             | Student's DSLR kit; Faculty's meeting room                             | Admin → Requests                                        |
| **Waitlisted**                      | Student's meeting room, behind Faculty's request                       | Admin → Requests (one **conflict group**)               |
| Approved                            | Student's discussion room; Faculty's microscope                        | My bookings → Upcoming                                  |

---

## 3. The judge script (the main demo)

The twelve steps from `frontend.md` §11. They cross every role and most of the app.

**First, check it automatically:** `cd server && npm run golden-path`. It runs all twelve steps over HTTP and should print 12 ✓. **Then run `npm run seed` again**: the run leaves the demo student holding 3D Printing Basics, which would spoil step 2.

**Timing, read this first.** Check-in opens **15 minutes before** a booking starts. The script says "tomorrow 10:00–12:00", but then you can't do steps 8–11 until tomorrow. To run all twelve steps in one sitting:

- In step 1, give the listing opening hours that cover **today, now**, and set _Book at least this far ahead_ to **0**.
- In step 5, book a slot that **starts within the next 15 minutes**.

| #   | Sign in as          | Do this                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | You should see                                                                                                         |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | **Manager**         | **Manage → Resources → New resource.**<br>- **Basics:** title "FDM 3D Printer #2", unit DIC, category equipment.<br>- **Availability:** the form starts with Mon–Fri 09:00–17:00. Keep it if now is within it; otherwise add today's day (Saturday or Sunday too) with hours covering now. Slot length 15 min.<br>- **Eligibility:** every member type; badge _3D Printing Basics_; approval **Manager approval**.<br>- **Limits:** longest booking 240 min, 6 hours a week, 1 active booking, ahead **0** minutes.<br>- **Checklist:** a few items (e.g. "Nozzle clean", "Build plate undamaged").<br>Check the **Preview** section, then save | The listing in Manage → Resources as Active. The audit log (step 12) gets `resource.created`                           |
| 2   | **Student**         | **Explore**, search "3D printer", open **FDM 3D Printer #2**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The **eligibility checklist** shows ❌ _Missing badge: 3D Printing Basics_ with a fix link. The other rules are ✓      |
| 3   | Student             | Follow the checklist's fix link (or **Badges** in the header) to `/badges` → _3D Printing Basics_ → **Request Badge**, with a note (evidence optional; it needs Cloudinary). Or request it through the API ([§5](#5-requesting-a-badge-through-the-api)), or skip to step 4b                                                                                                                                                                                                                                                                                                                         | The request waits in the manager's queue                                                                               |
| 4   | **Manager**         | **Manage → Badges**: the request is in the queue → **Approve**.<br>**4b** (if you skipped step 3): **Grant directly** → _3D Printing Basics_ → `student@demo.campuscommons.test`                                                                                                                                                                                                                                                                                                                                                                                                              | Student gets a notification (bell). Reload the printer page as Student: the checklist is all ✓                         |
| 5   | **Student**         | On the printer page's **booking panel**, pick today and a start time **within the next 15 minutes**, an end up to 4 h later, and a **purpose** → book                                                                                                                                                                                                                                                                                                                                                                                                                                         | The live pre-check is all ✓ before you submit. Status **Awaiting review** (pending)                                    |
| 6   | **Student 2**       | Open the same printer and choose the **same or an overlapping** slot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | "Every rule passes, but an earlier request holds this slot. You can join the waitlist as #1." Join → **Waitlisted #1** |
| 7   | **Manager**         | **Manage → Requests**: both requests sit in **one conflict group**, each with name, member type, department, purpose and eligibility snapshot → **Approve** the Student, with a reason if you like                                                                                                                                                                                                                                                                                                                                                                                            | Student: **Approved** (notification). Student 2 stays **Waitlisted**, and their booking shows why                      |
| 8   | **Student**         | **My bookings → the booking → Check in**: answer the checklist, add photos (optional; needs Cloudinary), confirm                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status **In use**. The timeline has a check-in entry                                                                   |
| 9   | Student             | **Check out**: checklist, note "Bed slightly scratched", confirm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status **Returned, awaiting confirmation**                                                                             |
| 10  | **Manager**         | **Manage → Handovers → Confirm return** on this booking: check-in and check-out reports side by side → fill your own checklist → **Report issue** (type damage, severity low)                                                                                                                                                                                                                                                                                                                                                                                                                 | Booking **Issue reported** (flagged), and an incident is opened                                                        |
| 11  | **Admin**           | **Admin → Incidents**, then **Show every severity** (the list opens on high severity only, and step 10's incident is low) → the incident → **Resolve**, outcome **Warning**, with a rationale. (The Manager can also resolve it, under **Manage → Incidents**, since it's low severity)                                                                                                                                                                                                                                                                                                                                                                                                                                            | Incident resolved. The booking becomes **Completed**, and both parties are notified                                    |
| 12  | Student, then Admin | Student: the booking's **timeline**. Admin: **Admin → Audit**, Entity type _Booking_, Entity id = the id in the booking's URL (`/bookings/<id>`)                                                                                                                                                                                                                                                                                                                                                                                                                                              | Every step, each with actor, time and reason                                                                           |

**What happens to Student 2's waitlist entry:** while the Student's booking holds the slot, it stays waitlisted. If the Student cancels instead (step 7 onward), Student 2 is promoted automatically, oldest request first, and notified. Waitlisted requests nobody promotes expire when their slot starts.

---

## 4. Feature tour, by area

### 4.1 Sign-up, email code and login

| Try                           | How                                                                 | Expect                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Domain-restricted sign-up** | `/register`: name, an email, a password                             | Only `@nitjsr.ac.in` addresses are accepted, checked live as you type. A "Detected" chip reads hints from the address (e.g. roll-number pattern). A strength bar on the password                                                                                                                                                                       |
| **Email code (OTP)**          | Register with a made-up `…@nitjsr.ac.in` address                    | Goes to `/verify-otp`. With no SMTP, **the 6-digit code is in the server terminal**. Paste works across the six boxes. The code lasts 10 minutes, allows 5 tries, and resend has a countdown                                                                                                                                                           |
| **ID verification (member)**  | After verifying the email, the new account lands on `/verification` | Upload a student or faculty ID card (needs Cloudinary). The status card shows pending / approved / rejected with the reason. Until approved, the eligibility checklist fails _Account verified_                                                                                                                                                        |
| **On-device ID-card check**   | On `/verification`, pick a **photo** of an ID card (not a PDF)      | Under the preview: "Checking the card on this device", then **Device check 3/4** with ✓/✗ for the institute's name, the roll number from your email, your name and the year, and what to fix for each ✗. It runs in the browser (the first time downloads about 7 MB); the photo isn't sent anywhere for it. Only the yes/no answers go with the upload. It never blocks the upload. **Try it:** photograph or screenshot a mock card with "National Institute of Technology Jamshedpur", your account's name and roll number |
| **Login lockout**             | Log in as a demo email with a wrong password 5 times                | A 429 with a **live countdown** (15 minutes, per email). Only failures count. A right password on an unverified account doesn't count                                                                                                                                                                                                                  |
| **Demo login**                | The role buttons                                                    | One click per role. They only appear while `DEMO_MODE=true`                                                                                                                                                                                                                                                                                            |
| **Session**                   | Stay idle past 15 minutes, then click around                        | The 15-minute access token renews silently from the rotating refresh cookie. Log out ends the session                                                                                                                                                                                                                                                  |
| **Account menu and profile**  | Click your name at the right of the header                          | A menu: **Profile**, **ID verification** (with its status), **Admin console** (admins only), **Log out**. **Profile** (`/profile`) shows your details, verification status (and the reason if rejected), your badges, strikes or a suspension if any, and links to the consoles your roles open. Below 1024 px wide, the same items sit in the ☰ menu |

### 4.2 Finding resources (any member)

| Try                       | How                                                                                                    | Expect                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Search and filters**    | **Explore**: search box, **Unit** (grouped by type), **Category** chips, **Only show what I can book** | Results and pagination follow the URL, so a filtered view can be shared or reloaded                                                                                                                                                     |
| **AI search**             | **Explore → Ask in your own words**, e.g. "something to print a phone case" or "a quiet room to discuss a project" (needs `GEMINI_API_KEY`) | Up to six resources Gemini picked, best first, each with **Gemini's reason** and **You can book this** / **Needs something first**. The category, unit and "only what I can book" filters narrow the picks. The meter shows the AI requests left. Asking again is free ("Answered before"). When the AI can't answer (limit reached, or not set up), the page says why and shows the keyword search for the same words. A link with `?ask=…` waits for **Ask Gemini** |
| **Eligibility checklist** | Open any resource                                                                                      | Up to 12 explained rules: account verified, not suspended, resource active, member type, department, badges, open hours, duration, booking window, weekly hours, active bookings, availability. Each failure says why and how to fix it |
| **Wrong member type**     | Student → **Optical Microscope** or **Total Station**                                                  | ❌ member type (PG, RS and faculty only). Faculty passes it                                                                                                                                                                             |
| **Missing badge**         | Student → **CO₂ Laser Cutter**                                                                         | ❌ _Laser Cutter Operation_, with a fix link                                                                                                                                                                                            |
| **Availability grid**     | Any resource page                                                                                      | Open hours and busy segments for the coming days. **No borrower names**: other people's bookings show only as busy                                                                                                                      |
| **Quota meter**           | Any resource page                                                                                      | Your hours this IST week against the resource's weekly cap, and your active bookings against its cap                                                                                                                                    |

### 4.3 Booking (members)

| Try                      | How                                                                                                   | Expect                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live pre-check**       | Change the day and times on the booking panel                                                         | The rules re-run on each change, before you submit                                                                                                    |
| **Instant approval**     | Student books **Discussion Room A** or the **Digital Storage Oscilloscope** (Student holds its badge) | **Approved** straight away, with no manager step                                                                                                      |
| **Needs approval**       | Any "manual" resource                                                                                 | **Awaiting review** until a manager decides                                                                                                           |
| **A loan**               | Student books the **IoT Starter Kit**                                                                 | Pickup day and time plus return day and time, up to 3 days                                                                                            |
| **Rule failures**        | Book too long, outside hours, past the advance window, or beyond the weekly hours                     | The failing rule is named. Book is refused                                                                                                            |
| **Active-booking cap**   | Book a second slot on a resource with a cap of 1 while the first is pending or approved               | ❌ active bookings                                                                                                                                    |
| **No double booking**    | Two users submit the same slot at the same time                                                       | One gets it. The other is offered the waitlist (a Redis lock plus a capacity check; with Redis down, booking answers 503 rather than risk it)         |
| **My bookings**          | **My bookings**                                                                                       | Tabs: Upcoming (approved, in use) · Requests (pending, waitlisted with position) · Past                                                               |
| **Booking detail**       | Open any booking                                                                                      | Status, decision reason, an action bar for what you can do now (cancel / check in / check out / report issue), condition reports and the **timeline** |
| **Cancel**               | Cancel a pending or approved booking                                                                  | **Cancelled**. If someone was waitlisted on that slot, they're promoted and notified                                                                  |
| **Check-in / check-out** | A booking that starts within 15 minutes                                                               | Three-step wizard: checklist → photos (optional) → overall condition and notes. Check-out shows your check-in for reference. A photo already used at check-in is refused at check-out |
| **QR booking pass**      | An **approved** booking (pickup) or one **in use** (return) → **Show my pass**                         | A QR code and a 6-character code that refresh every minute (each lasts 2 minutes). Once the unit scans it, the card says **Verified at …** by itself |

### 4.4 Managing a unit (Manager; Admin for units with no manager)

| Try                  | How                                          | Expect                                                                                                                                                                                 |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**        | **Manage**                                   | Count cards: pending requests, today's handovers, returns to confirm, open incidents. Each links to its page                                                                           |
| **Conflict groups**  | Admin → **Manage → Requests**                | The seeded Meeting Room: Faculty's pending request and the Student's waitlisted one, in one card for the contested slot                                                                |
| **Decide**           | Approve, Reject or Waitlist a request        | Reject and Waitlist ask for a reason, which the member sees. Approving into a taken slot explains why it can't. **No self-review:** a manager can't decide their own booking           |
| **Handovers**        | **Manage → Handovers**                       | Three lists: starting soon, in use (**overdue highlighted**: Admin sees the seeded DSLR kit), and awaiting return confirmation (Manager sees Student 2's seeded printer)               |
| **Scan a pass**      | **Manage → Scan pass**: **Start the camera** and point it at the borrower's QR, or type the 6 characters (Student shows the pass of an approved DIC booking within 15 minutes of its start) | **Pickup pass verified**: the borrower, their member type and department, the slot, and a button for the next step (**Open the check-in**, or **Confirm the return**). Check their college ID: the pass proves the booking, not the person. Each code works once; a pass for another unit's booking is refused |
| **Confirm a return** | Confirm return on Student 2's seeded printer | Check-in and check-out side by side, then your own checklist. **All good** → Completed. **Report issue** → Issue reported, plus an incident                                            |
| **AI photo comparison** | On the return page, **Compare with AI** (needs photos at pickup and return, Cloudinary and `GEMINI_API_KEY`; the seeded bookings have no photos, so do steps 8–10 of the judge script with photos) | **AI suggestion: photo comparison**: a verdict (**Possible new damage**, **No new damage spotted**, or **Couldn't compare**), a summary and up to six differences with severity and checklist item. A suggestion only: your own check and decision are unchanged. Comparing again is free |
| **Listings**         | **Manage → Resources**                       | Your units' resources with status toggles. Set one to **Maintenance**: it disappears from Explore for members and fails _resource active_                                              |
| **Listing form**     | **New resource**, or Edit on any row         | Sections Basics · Availability (weekly hours, closures) · Eligibility · Limits · Condition checklist · Preview. Errors are listed at the top and jump to the field                     |
| **Badge queue**      | **Manage → Badges**                          | Requests oldest first. **Approve**, or **Reject** with a reason. **View evidence** opens a 5-minute signed link (needs Cloudinary). **Grant directly** gives a member a badge by email |

### 4.5 Incidents

| Try                   | How                                                                                                                      | Expect                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Report one**        | As a borrower: booking → **Report issue**, or `/incidents/new`. As a manager: from a resource page, even with no booking | Type, severity, description, photos (optional). The unit's managers are notified; admins too when severity is high                                                                                                                                              |
| **Discuss**           | Open an incident and comment                                                                                             | The thread updates. A manager's or admin's first comment moves it **open → in review**                                                                                                                                                                          |
| **Resolve**           | Manager → **Manage → Incidents** → the seeded flagged printer's incident → **Resolve**                                   | Outcome (No action, Warning, Repair required, Strike) and a rationale, both required. Resolving the **last** open incident of a flagged booking completes it. A **strike** adds one to the borrower's strike count. Managers resolve low and medium; admins any |
| **Sweeper incidents** | Admin → **Admin → Incidents**                                                                                            | The seeded overdue DSLR kit's **delay** incident, which the sweeper opened by itself                                                                                                                                                                            |

### 4.6 Notifications

| Try          | How                                                                                 | Expect                                                                                |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **The bell** | Any signed-in page                                                                  | The unread count, refreshed every 30 seconds while the tab is visible                 |
| **The list** | **Notifications**                                                                   | Each one links to its booking, badge or incident. Mark one read, or **Mark all read** |
| **Sources**  | Any decision, badge request or grant, incident change, waitlist promotion, reminder | The right people are told, never the person who acted                                 |

### 4.7 Admin

The **Admin console** opens from the account menu: your name at the right of the header → **Admin console**, or **Profile → Consoles**.

| Try                    | How                       | Expect                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verification queue** | **Admin → Verifications** | The demo admin sees only demo accounts (Rohan Mehta); a real member's request needs a real admin (`npm run grant-admin -- <email>`, README "Scripts"). Rohan Mehta, pending, with the email hints. **View ID** opens the card through a 5-minute signed link, "Viewing is logged" (needs Cloudinary). **Approve** (confirm member type and department) or **Reject** with a reason, which the member sees on `/verification` |
| **Device check of a card** | A pending request whose member uploaded a photo | The queue row shows the member's **Device check 3/4** and which checks passed, labelled "a hint, not proof". In **View ID**, **Check on this device** runs the same check in your browser on the card itself (audited like a view) |
| **Audit log**          | **Admin → Audit**         | Every change: actor, time, action, reason, before → after. Filter by entity type, entity id, action, unit, actor and IST dates. Rows deep-link to their booking, incident or resource. Managers can read their own units' entries; members can't (they have their booking timelines)                                                                                                                                         |
| **All incidents**      | **Admin → Incidents**     | Every unit's incidents, high severity included                                                                                                                                                                                                                                                                                                                                                                               |

### 4.8 Running in the background

The **sweeper** runs every 5 minutes:

| What           | When                                                                                  | How to see it                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Start reminder | 60 minutes before a booking starts                                                    | A notification                                                                                                 |
| End reminder   | 15 minutes before it ends                                                             | A notification                                                                                                 |
| **No-show**    | 15 minutes after the start, with no check-in                                          | Book Discussion Room A (instant) to start in a few minutes, don't check in, wait about 20 minutes: **No-show** |
| **Overdue**    | 15 minutes after the end, not checked out                                             | Overdue flag, a delay incident, and notices to the borrower and managers                                       |
| **Expiry**     | At the start of a pending request nobody decided, or a waitlisted one nobody promoted | **Expired**, which frees the member's active-booking cap                                                       |

### 4.9 Help: How it works and the guided tour

| Try               | How                                                                 | Expect                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **How it works**  | `/how-it-works`, linked from the login page, the footer and the account menu; no sign-in needed | Every rule in plain words: verification, the 12 eligibility checks, approval and fair use, the waitlist, check-in and no-shows, handovers, incidents, the QR pass, what the AI sees and never sees |
| **Guided tour**   | The **?** button beside the bell, on Explore, a resource, a booking, Manage pages and the verification queue | A few highlighted steps for that page. Offered once per role on first sign-in. Esc or ✕ ends it; it also ends when you leave the page                                                           |

### 4.10 Resilience and limits (for the technical judges)

| Try             | How                                                                   | Expect                                                                                                                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Health**      | <http://localhost:5000/health>                                        | MongoDB and Redis status                                                                                                                                                                                                                                                                              |
| **Redis down**  | `sudo docker stop redis`, try the app, then `sudo docker start redis` (use your container's name: `campuscommons-redis` if you followed the README) | The API keeps running and `/health` shows Redis down. Pages already open keep working (the cache falls back to MongoDB), but bookings answer 503 rather than risk a double booking, and signing in or renewing a session fails, since sessions live in Redis. Reconnects by itself once Redis is back |
| **Rate limits** | e.g. 11 booking requests in an hour as one user                       | 429 with how long to wait. Limits key on the user, email or role, with coarse per-IP ceilings only on sign-in routes                                                                                                                                                                                  |
| **Tests**       | `cd server && npm test`, `cd client && npm test`                      | All pass                                                                                                                                                                                                                                                                                              |

---

## 5. Requesting a badge through the API

The `/badges` page does this in the browser. To do it from a terminal instead (for a scripted demo), as the demo Student, while the server runs:

```
API=http://localhost:5000/api/v1
TOKEN=$(curl -s -X POST $API/auth/demo-login -H 'Content-Type: application/json' -d '{"role":"student"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
BADGE=$(curl -s $API/badges -H "Authorization: Bearer $TOKEN" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.find(b => b.code === "3d-printing-basics")._id')
curl -s -X POST $API/badges/$BADGE/requests -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"note":"Finished the DIC printer induction."}'
```

The last command answers `201` with `"state":"requested"`. The request then appears under **Manage → Badges** for the Manager (judge step 4). Asking again while it is open answers 409 "You've already requested this badge."

---

## 6. Not built yet

So you don't look for these in a demo:

- **`/admin/users` and `/admin/org-units` pages.** Their APIs partly exist (`GET /admin/users`, the org-unit routes); `/admin/*` opens the verification queue. `/profile` has no quota overview or email-notification toggle yet.
- **Email for booking events.** Notifications are in-app only; only sign-up codes are emailed, and only with SMTP set.
- **Revoking a badge**, and acting on strikes (they're counted, nothing suspends automatically).
- **The AI incident summary**, and the other cool-to-have features in `frontend.md` §3 and `backend.md` not marked ✅. AI search, the AI photo comparison, the QR pass, the on-device ID-card check, How it works and the guided tour are built (§4).
