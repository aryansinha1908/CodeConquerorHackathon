# CampusCommons

CampusCommons lets departments and central facilities at **NIT Jamshedpur** share underused spaces, equipment and computing resources with verified students and faculty. Only `@nitjsr.ac.in` addresses can join, a human checks every student or faculty ID card, and every resource carries its own eligibility rules (training badges, member type, department), approval mode and fair-usage limits. Every booking then moves through an auditable lifecycle, from request to return confirmation.

Built in 48 hours for a hackathon. It is an independent prototype, not affiliated with the institute: no official logo or branding is used, and every seeded person, roll number and item of inventory is fictional.

## Stack

| Part | What |
|---|---|
| Client (`client/`) | React 19, Vite 8, React Router 7, TanStack Query 5, Zustand, React Hook Form + Zod, Tailwind CSS 4, Headless UI, framer-motion, lucide-react, sonner |
| Server (`server/`) | Node 20+ (ESM), Express 5, Mongoose 9 on MongoDB, ioredis 5 on Redis, JWT access tokens with rotating refresh cookies and email OTP, Cloudinary uploads, Nodemailer, a `node-cron` sweeper, pino logs, helmet, express-rate-limit |
| Hosting | Vercel (client, rewriting `/api/*` to the API), Render (API), MongoDB Atlas, Upstash Redis, Cloudinary, Brevo or Gmail SMTP |

```
client/        React SPA (see docs/frontend.md)
server/        Express API, the seed and the golden-path script (see docs/backend.md)
docs/          design, API reference, deployment checklist, progress log
render.yaml    Render Blueprint for the API
```

## Run it locally

You need **Node 20.19+ or 22.12+**, a **MongoDB** (a plain local `mongod` is enough; no replica set) and a **Redis**. With Docker:

```
docker run -d --name campuscommons-mongo -p 27017:27017 mongo:8
docker run -d --name campuscommons-redis -p 6379:6379 redis:7
```

**1. Configure the server.** `server/.env.example` lists every variable with comments.

```
cd server
cp .env.example .env
```

Then edit `server/.env`:

| Variable | Local value |
|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/campuscommons` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `OTP_PEPPER` | Three different values, each from `node -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))'`. Never reuse a value from an old commit |
| `SEED_PASSWORD` | The demo users' password: 8–72 characters with a letter and a digit |
| `DEMO_MODE` | `true`, for the role buttons on the login page |

Leave `SMTP_HOST` empty and the OTP codes are printed in the server's log instead of emailed. Leave the `CLOUDINARY_*` keys empty and uploads answer 503 while everything else works; fill them in to try ID cards and condition photos.

**2. Install and seed.**

```
cd server && npm install && npm run seed
cd ../client && npm install
```

**3. Run both**, each in its own terminal:

```
cd server && npm run dev      # API on http://localhost:5000 (restarts on change)
cd client && npm run dev      # SPA on http://localhost:5173
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to `http://localhost:5000` (`client/vite.config.js`), so the browser sees a single origin, exactly as it does behind the Vercel rewrite in production: the refresh cookie is first-party and no CORS is involved. <http://localhost:5000/health> reports MongoDB and Redis.

## Scripts

**Server** (`cd server`):

| Command | What it does |
|---|---|
| `npm run dev` | The API with `node --watch` |
| `npm start` | The API, as Render runs it |
| `npm test` | Every test (`node --test`). The integration suites skip themselves without `TEST_MONGODB_URI` |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27017 node --test` | The integration suites too, against a real MongoDB. Each test file creates its own `campuscommons_test_<random>` database and drops it; Redis is `ioredis-mock`. Use a local or throwaway server, never production |
| `npm run seed` | The demo data: 18 NIT JSR org units, the badge catalogue, 13 resources, 6 demo users and 16 demo bookings in every status. Idempotent, and it resets the judge script. The bookings need Redis |
| `npm run grant-admin -- <email> [--revoke]` | Makes an existing, email-verified real account an admin, or takes the role away; audited as `user.roles_changed`. Demo staff only ever see demo accounts, so reviewing a real member's ID card needs a real admin. Uses the database in `MONGODB_URI`; the person picks the role up on their next page load |
| `npm run golden-path -- [url] [--no-photos]` | Walks judge-script steps 1–12 over HTTP as the demo users and cleans up after itself. Needs `DEMO_MODE=true` and a fresh seed. Without a URL it uses `GOLDEN_PATH_URL`, then `http://localhost:$PORT`. **Run `npm run seed` afterwards:** the run leaves the demo student holding 3D Printing Basics |

**Client** (`cd client`):

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with the `/api` proxy |
| `npm run build` | Production build into `client/dist` |
| `npm run preview` | Serves the build locally (same proxy) |
| `npm test` | `node --test test/*.test.mjs` |
| `npm run lint` | oxlint |

## Demo logins

With `DEMO_MODE=true`, the login page shows one button per role: **Student**, **Student 2**, **Faculty**, **Manager** and **Admin**. Each signs in as a seeded user with no password (`POST /auth/demo-login`).

The same accounts also sign in through the normal form, with `SEED_PASSWORD`:

| Email | Who |
|---|---|
| `student@demo.campuscommons.test` | Ananya Rao, UG, CSE. Verified; holds Electronics Lab Safety but **not** 3D Printing Basics (the judge script requests it) |
| `student2@demo.campuscommons.test` | Kabir Singh, UG, Mechanical. Holds 3D Printing Basics |
| `faculty@demo.campuscommons.test` | Dr. Kavya Nair, faculty, ECE |
| `manager@demo.campuscommons.test` | Meera Iyer, manager of the Design and Innovation Centre and the Central Workshop |
| `admin@demo.campuscommons.test` | Campus Admin |
| `newstudent@demo.campuscommons.test` | Rohan Mehta, UG, Electrical. ID card pending in the admin's queue; no role button |

Addresses on `*.test` are never emailed. While `DEMO_MODE` is on, anyone can sign in as the demo admin, so an instance with it on is for demos only (see [`docs/deploy.md`](docs/deploy.md) §12).

## The judge script

The full table is in [`docs/frontend.md` §11](docs/frontend.md#11-judge-golden-path-demo-script). In brief:

1. **Manager** lists "FDM 3D Printer #2" (DIC), which requires the *3D Printing Basics* badge.
2. **Student** finds it; the eligibility checklist shows the missing badge with a fix link.
3. Student requests the badge.
4. **Manager** approves it; the student is notified and the checklist turns green.
5. Student books tomorrow 10:00–12:00: **Awaiting review**.
6. **Student 2** books an overlapping slot and joins as **Waitlisted #1**.
7. Manager sees both requests in one conflict group and approves the student; Student 2 stays waitlisted, with the reason shown.
8. Student checks in with a checklist and a photo: **In use**.
9. Student checks out, noting "Bed slightly scratched": **Returned, awaiting confirmation**.
10. Manager compares the photos and reports an issue (damage, low): **Issue reported**, with an incident.
11. **Admin** resolves the incident with a warning and a rationale: **Completed**.
12. The booking timeline and the admin's audit log show every step, with actor, time and reason.

The seed also leaves a no-show, an overdue booking still in use, a rejected request with its reason and a pending ID verification, for judges who explore further. `npm run golden-path` runs all twelve steps against any server.

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | The design: domain model, booking state machine, auth, Redis, rate limits, security, deployment |
| [`docs/backend.md`](docs/backend.md) | Server features, folder layout, validation, seed data |
| [`docs/frontend.md`](docs/frontend.md) | Pages, components, data fetching, accessibility, the judge script |
| [`docs/api.md`](docs/api.md) | The API reference, as built |
| [`docs/demo.md`](docs/demo.md) | How to demo and test every built feature by hand: setup, demo accounts, seeded data, the judge script, a tour by area, what isn't built |
| [`docs/deploy.md`](docs/deploy.md) | The deployment checklist: Atlas, Upstash, Cloudinary, SMTP, Render, Vercel, seeding, smoke test, secrets, rollback |
| [`docs/progress.md`](docs/progress.md) | The running log: what's built, what was decided, what's left |

## Deploying

The API deploys to Render from [`render.yaml`](render.yaml), and the client to Vercel from [`client/vercel.json`](client/vercel.json), which rewrites `/api/*` to the Render service. [`docs/deploy.md`](docs/deploy.md) walks through every step. Two things not to skip: **new secrets** (the JWT secrets in this repository's early commits are public), and keeping the judged `DEMO_MODE` instance **demo-only**.

## Team note

The member's **`/badges` page belongs to a teammate**: please don't change it. The manager's badge queue at `/manage/badges` lives in its own files.

## Security

The repository is public. Never commit `.env` files (they are git-ignored); `server/.env.example` holds placeholders only. Rate limits key on users, emails and roles, with coarse per-IP ceilings on the sign-in routes; managers never see borrowers' emails or ID cards; ID cards live in private Cloudinary storage and open only through 5-minute signed links.
