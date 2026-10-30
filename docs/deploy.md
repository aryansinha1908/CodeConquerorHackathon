# Deploying CampusCommons

A checklist for putting the app on the internet: the API on **Render**, the SPA on **Vercel**, data in **MongoDB Atlas**, Redis on **Upstash**, files on **Cloudinary**, email through **Brevo** or a **Gmail app password**, and the AI features on **Google Gemini**. Work through it top to bottom; each step says what to copy into the next.

```
browser ──► Vercel (client/, static build)
              └─ /api/*  rewrite ──► Render web service (server/, Node 22)
                                       ├─► MongoDB Atlas   (MONGODB_URI)
                                       ├─► Upstash Redis   (REDIS_URL)
                                       ├─► Cloudinary      (CLOUDINARY_*)
                                       ├─► SMTP            (SMTP_*, MAIL_FROM)
                                       └─► Google Gemini   (GEMINI_API_KEY)
```

The browser only ever talks to the Vercel origin. Vercel forwards `/api/*` to Render, so the refresh cookie (`HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`) is first-party and production needs no CORS ([`architecture.md`](./architecture.md) §2, §18).

The config lives in the repo:

| File                                            | What it is                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`render.yaml`](../render.yaml)                 | Render Blueprint for the API: build, start, health check, every environment variable |
| [`client/vercel.json`](../client/vercel.json)   | Vercel config: the `/api` rewrite, the SPA fallback, asset caching, security headers |
| [`server/.env.example`](../server/.env.example) | Every server variable, with comments                                                 |

---

## 0. Before you start

**Decide these first.** The rest of the checklist assumes the defaults in bold.

| Decision                           | Options                                                          | Why it matters                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_MODE` on the judged instance | **`true`, and the instance is demo-only** / `false`              | See [§12](#12-the-demo_mode-decision). Anyone can sign in as the demo admin while it's on                                                                                              |
| Region                             | **Render Singapore + Atlas and Upstash on AWS `ap-southeast-1`** | Every API request makes several database round trips; keep them in one region                                                                                                          |
| Email provider                     | **Brevo** / Gmail app password                                   | Render's free instances block the usual SMTP ports. Brevo also listens on 2525, Gmail doesn't ([§4](#4-smtp-email))                                                                    |
| Render plan                        | **Free** + a keep-alive ping / Starter for the judging window    | Free instances sleep after about 15 idle minutes and run no cron while asleep                                                                                                          |
| Branch                             | **`main`**                                                       | `render.yaml` and Vercel's production branch must name the same one                                                                                                                    |
| `TRUST_PROXY_HOPS`                 | **`2`**, checked after the first deploy                          | Too low, and one visitor can lock every other visitor out of sign-in, sign-up and the demo roles ([§6](#6-vercel-the-client), "Client addresses"; the check is in [§9](#9-smoke-test)) |

**You need:** accounts on Render, Vercel, MongoDB Atlas, Upstash, Cloudinary and Brevo (or a Google account with 2-Step Verification), a Google account for AI Studio, push access to the GitHub repo, and Node 22 (or 20.19+) locally for the seed and the smoke test.

**Secrets hygiene.** This repository is public, and its early commits contain a `server/.env` with JWT secrets and a `cookies.txt` with a refresh token. Treat every value that was ever committed as public: never paste anything from an old commit, or from a local `.env` that predates this checklist, into Render. [§11](#11-rotate-the-secrets) covers it.

Keep the values you collect in a password manager, or in `server/.env.production.local`, which is git-ignored (check with `cd server && git check-ignore .env.production.local`; it must print the name). [§8](#8-seed-the-atlas-database) uses that file.

**They go into Render, not into `server/.env`.** `server/.env` stays your local development setup.
- **Redis:** keep the local one there (`REDIS_URL=redis://127.0.0.1:6379`).
  - Many campus and office networks block outgoing port 6379, which is Upstash's, so a laptop on one can't reach it. The server then logs `connect ETIMEDOUT` and `Redis unavailable at startup`, and bookings answer 503.
  - `cd server && npm run check:redis` tells you whether your network gets through. Render's does.
- **Database:** give local development its own database name in `MONGODB_URI`, for example `/campuscommons-dev` instead of `/campuscommons`.
  - Each API clears the caches only in its own Redis. A change made through your local API would leave the deployed one serving stale lists until their TTL runs out.
  - Accounts you register while testing locally would also be real accounts on the demo instance ([§12](#12-the-demo_mode-decision)).

---

## 1. MongoDB Atlas

- [ ] **Cluster.** New project (e.g. "CampusCommons") → **Create** → **M0 (Free)** → AWS → **ap-southeast-1 (Singapore)**, or the nearest region M0 offers (Mumbai, `ap-south-1`). Name it e.g. `campuscommons`.
- [ ] **Database user.** Security → **Database Access** → Add New Database User:
  - Authentication: password. Username e.g. `campuscommons-api`.
  - **Autogenerate Secure Password**: letters and digits only, so nothing in the URI needs escaping. A password you choose must have `@ : / ? # [ ] %` percent-encoded in the URI.
  - Privileges: **Specific Privileges** → `readWrite` on database `campuscommons`. That covers the API and the seed, index builds included.
  - Make a new user for the deployment rather than reusing one from development.
- [ ] **Network access.** Security → **Network Access** → IP Access List. Pick one:
  - **Render's outbound ranges (recommended).** In Render, open the service → **Connect** → **Outbound**, and add each range listed for its region. The service exists only after [§5](#5-render-the-api), so come back here then.
  - **`0.0.0.0/0` (simpler).** Then the database password is the only lock. Acceptable for a demo-only database of fictional data; never for real students' data.
  - Either way, also **Add Current IP Address** for the laptop that runs the seed ([§8](#8-seed-the-atlas-database)), and remove it afterwards.
- [ ] **Connection string.** Database → **Connect** → Drivers → copy the `mongodb+srv://` string, put the password in, and **add the database name before the `?`**:

  ```
  mongodb+srv://campuscommons-api:<password>@<cluster>.<id>.mongodb.net/campuscommons?retryWrites=true&w=majority&appName=<cluster>
  ```

  Without `/campuscommons`, everything lands in a database called `test`. The API logs the database name when it connects; check it in [§5](#5-render-the-api).

> M0 clusters have no backups. Take a `mongodump` before anything risky ([§13](#13-rolling-back)).

**→ `MONGODB_URI`**

---

## 2. Upstash Redis

- [ ] [console.upstash.com](https://console.upstash.com) → **Redis** → Create Database. Name `campuscommons`, primary region **AWS ap-southeast-1 (Singapore)**, the same as Render.
- [ ] Leave **eviction off**. Refresh-token sessions and OTP codes live in Redis; evicting them signs people out and voids codes.
- [ ] On the database page, copy the **TCP** connection string (the ioredis or redis-cli one), not the REST URL or REST token:

  ```
  rediss://default:<password>@<name>-<id>.upstash.io:6379
  ```

  `rediss://` (two s) means TLS, which Upstash requires. The API speaks the Redis protocol through ioredis; an `https://…upstash.io` REST URL does not work.

- [ ] Note the free tier's command quota on Upstash's pricing page. The sweeper, the rate limits and the caches all spend commands; usage is on the database page. If Redis goes away, the API keeps serving reads (no cache, rate limits let requests through), but bookings and sign-ins answer 503 until it's back.

**→ `REDIS_URL`**

---

## 3. Cloudinary

- [ ] Sign in → **Settings** → **API Keys** → **Generate New API Key**. A key used only by this deployment can be revoked without touching anything else.
  - **The key must be allowed to upload.** A key with restricted permissions passes Cloudinary's read-only checks but refuses every upload with `403 Request forbidden due to missing permissions (actions=["create"])`. The API then answers 503 "Uploads aren't available right now.", and Render's log says `Cloudinary refused the upload (HTTP 403)`. Give the key full (or upload and delete) permissions, or use the account's default key.
- [ ] Copy the **cloud name** (top of the API Keys page or the dashboard), the **API key** and the **API secret**.
- [ ] Nothing else to configure. Condition photos are public (`upload` type). ID cards and badge evidence are `authenticated`, and open only through 5-minute signed links from Cloudinary's Download API on `api.cloudinary.com`, which the Vercel CSP allows. If a PDF of badge evidence won't open, check **Settings → Security → "Allow delivery of PDF and ZIP files"**.

Without all three values the API still runs, but every upload answers 503 "Uploads aren't configured."

**→ `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`**

---

## 3b. Google Gemini (the AI features)

AI search on Explore and the AI photo comparison on the return check use Gemini. The on-device ID-card check doesn't: it runs in the browser.

- [ ] [Google AI Studio](https://aistudio.google.com/apikey) → **Create API key** in a new project. The free tier is enough for judging. On it, Google may keep what it receives and people may review it, which the app tells users (architecture.md §15.3); it never sends names, emails, roll numbers or ID cards.
- [ ] Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`). Check the name against the models your key lists in AI Studio; a wrong name makes every AI request answer 503, and Render's log says `Gemini call failed` with `googleStatus: "NOT_FOUND"`.
- [ ] The limits come from `render.yaml`: 5 AI requests per account a day (`AI_USER_DAILY_LIMIT`), all demo accounts together 30 (`AI_DEMO_DAILY_LIMIT`), 8 a minute and 50 a day for everyone (`AI_GLOBAL_RPM`, `AI_GLOBAL_DAILY_LIMIT`), 10 seconds between one account's requests. Keep the global ones below what AI Studio shows for your key: a Gemini 429 pauses AI for everyone for 10 minutes. Answers are cached for 24 hours, so repeated questions are free.

Without a key the API still runs: the AI parts say "AI isn't set up on this server yet", and keyword search and the manual return check carry on. The server logs a warning at start.

**→ `GEMINI_API_KEY` (and `GEMINI_MODEL` if you set one)**

---

## 4. SMTP (email)

Email carries the OTP codes for registration and the ID-verification decisions. Addresses on `*.test` (all the demo accounts) are never emailed. Without `SMTP_HOST`, production sends nothing and logs `SMTP_HOST is not set, so an email was not sent`, so nobody can finish registering.

> **Render's free instances block outbound SMTP on ports 25, 465 and 587** (Render's free-tier rules since late 2025; check their docs if in doubt). On the free plan, use Brevo on port **2525**. Gmail only offers 465 and 587, so Gmail needs a paid Render instance.

### Option A: Brevo (works on Render's free plan)

- [ ] Create a Brevo account. **Senders, Domains & Dedicated IPs → Senders** → add the address the app sends from, and verify it.
- [ ] **SMTP & API → SMTP** → **Generate a new SMTP key**. The page also shows the SMTP **login**, which may differ from your account email.
- [ ] Values:

  | Variable    | Value                                         |
  | ----------- | --------------------------------------------- |
  | `SMTP_HOST` | `smtp-relay.brevo.com`                        |
  | `SMTP_PORT` | `2525` on Render's free plan, `587` elsewhere |
  | `SMTP_USER` | the SMTP login from that page                 |
  | `SMTP_PASS` | the SMTP key (not the API key)                |
  | `MAIL_FROM` | `CampusCommons <the verified sender>`         |

  The free plan sends about 300 emails a day.

### Option B: Gmail app password (paid Render instance only)

- [ ] Use a team Google account, not a personal one: its address is on every email. Turn on **2-Step Verification**, then create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Copy the 16 characters without spaces.
- [ ] Values: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=<the Gmail address>`, `SMTP_PASS=<the app password>`, `MAIL_FROM=CampusCommons <the same Gmail address>` (Gmail rewrites any other From). About 500 emails a day.

Port 465 means TLS from the start; every other port upgrades with STARTTLS (`server/src/config/mailer.js`). The API also caps how many codes it emails a day (`server/src/middleware/rateLimit.js`), below the free plans' quotas.

**→ `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`**

---

## 5. Render (the API)

- [ ] Push the branch `render.yaml` deploys (`branch: main`). To deploy before merging, change `branch` in `render.yaml` first.
- [ ] Render → **New** → **Blueprint** → connect GitHub → pick this repository. Render reads `render.yaml` and proposes one web service, `campuscommons-api` (Node 22, Singapore, free plan, root `server/`, `npm ci`, `npm start`, health check `/health`).
- [ ] Fill in the values it asks for (the `sync: false` keys):

  | Key                                                                    | Value                                                                                                                                                                                      |
  | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `CLIENT_URL`                                                           | The Vercel origin you're about to create, e.g. `https://campuscommons.vercel.app`. Fix it in [§7](#7-client_url-and-the-rewrite-each-side-names-the-other) if the name turns out different |
  | `MONGODB_URI`                                                          | [§1](#1-mongodb-atlas)                                                                                                                                                                     |
  | `REDIS_URL`                                                            | [§2](#2-upstash-redis)                                                                                                                                                                     |
  | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`        | [§4](#4-smtp-email)                                                                                                                                                                        |
  | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | [§3](#3-cloudinary)                                                                                                                                                                        |
  | `GEMINI_API_KEY`, `GEMINI_MODEL` (optional)                            | [§3b](#3b-google-gemini-the-ai-features)                                                                                                                                                   |
  | `SEED_PASSWORD`                                                        | Optional: the server never reads it. Recording it here keeps the judges' password with the deployment                                                                                      |

  `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` and `OTP_PEPPER` are generated by Render (`generateValue`): new random values that never existed anywhere else. `NODE_ENV=production`, `DEMO_MODE=true`, `ALLOWED_EMAIL_DOMAINS=nitjsr.ac.in`, `CRON_ENABLED=true` and the rest come from the file. Change those in `render.yaml`, not the dashboard: a Blueprint sync puts them back to what the file says.

- [ ] **Apply.** Watch the first deploy's logs. In production the server refuses to start when `MONGODB_URI`, `REDIS_URL`, `CLIENT_URL` or a secret is missing, or a secret is shorter than 32 characters; the log then names each variable and ends with `Refusing to start in production…`. Missing Cloudinary or SMTP settings are only warnings. A good start logs, in order:
  - `MongoDB connected` with `db: "campuscommons"` (if it says `test`, the URI has no database name);
  - `Redis connected`;
  - `Sweeper started`;
  - `HTTP server listening` on port 10000.

  If it stops at MongoDB with a server-selection timeout after 10 seconds, Atlas is refusing Render: add Render's outbound ranges ([§1](#1-mongodb-atlas), network access), then **Manual Deploy → Deploy latest commit**.

- [ ] **Health check.** Note the service URL Render shows (`https://campuscommons-api.onrender.com`, or with a suffix if the name was taken), then:

  ```
  curl -s https://<service>.onrender.com/health
  # {"status":"ok","mongo":"up","redis":"up","uptime":…,"requestId":"…"}
  ```

  `"redis":"degraded"` means `REDIS_URL` is wrong (often the REST URL, or `redis://` instead of `rediss://`). A 503 with `"mongo":"down"` means MongoDB isn't connected. Render also polls `/health` to decide whether a deploy succeeded and whether a running instance needs a restart.

- [ ] Under **Settings**, check that auto-deploy is on and the branch is right.

**→ the Render URL, for [§6](#6-vercel-the-client)**

---

## 6. Vercel (the client)

- [ ] **Point the rewrite at Render.** In [`client/vercel.json`](../client/vercel.json), replace `https://REPLACE-WITH-YOUR-RENDER-SERVICE.invalid` with the Render URL from [§5](#5-render-the-api), keeping the `/api/:path*` after it:

  ```json
  {
    "source": "/api/:path*",
    "destination": "https://campuscommons-api.onrender.com/api/:path*"
  }
  ```

  Commit and push. The placeholder uses the reserved `.invalid` domain on purpose: a rewrite nobody replaced fails at once, instead of sending passwords and cookies to whoever registered a look-alike Render name. (`/api/:path*` is Vercel's named form of `architecture.md`'s `/api/(.*)` → `/api/$1`; query strings pass through.)

- [ ] Vercel → **Add New → Project** → import the repository:
  - **Root Directory: `client`**. Vercel then reads `client/vercel.json`.
  - Framework preset **Vite**. `vercel.json` pins the install (`npm ci`), build (`npm run build`) and output (`dist`), so the dashboard's values don't matter.
  - **No environment variables.** The client always calls `/api/v1` on its own origin.
  - Deploy.
- [ ] In the project settings, set **Node.js Version** to 22.x and the **production branch** to the same branch as Render.
- [ ] **Check the rewrite and the headers:**

  ```
  curl -s https://<project>.vercel.app/api/v1/auth/demo-config
  # {"success":true,"data":{"demoMode":true,"roles":["student","student2","faculty","manager","admin"]},…}

  curl -sI https://<project>.vercel.app/explore | grep -i -E '^(HTTP|content-security-policy|x-content-type-options|referrer-policy)'
  # HTTP/2 200, plus the three headers (the SPA fallback serves index.html for every app route)
  ```

  An HTML page, a 404 or a DNS error from the first command means the rewrite still points at the placeholder or at the wrong host. `/health` isn't under `/api`, so check health on the Render URL, never through Vercel.

What `vercel.json` sets, and why:

| Setting                                                        | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/:path*` rewrite                                          | Proxies to Render; cookies and `Set-Cookie` pass through, so the refresh cookie is set on the Vercel origin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SPA fallback                                                   | Every other path except `/api/` and `/assets/` serves `index.html`, so a deep link like `/bookings/…` loads the app. A missing `/assets/…` file is a plain 404 rather than HTML served as JavaScript                                                                                                                                                                                                                                                                                                                                                                                           |
| `Cache-Control` on `/assets/*`                                 | `public, max-age=31536000, immutable`: Vite puts a content hash in every file name there. `index.html` keeps Vercel's default (revalidate every time), so a deploy shows up on the next load                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Content-Security-Policy`                                      | `script-src 'self' 'wasm-unsafe-eval'` (the production `index.html` has no inline script; `'wasm-unsafe-eval'` lets the on-device ID-card check compile Tesseract's WebAssembly, and allows nothing else: no `eval`); `img-src` allows `data:`, `blob:` (photo previews), `res.cloudinary.com` (photos) and `api.cloudinary.com` (signed ID-card and evidence links); `style-src` and `font-src` allow Google Fonts (Inter, JetBrains Mono). `style-src` also needs `'unsafe-inline'`, because the toast library injects a `<style>` element. `worker-src 'self' blob:` lets photo compression, the QR scanner and Tesseract run in workers. Tesseract's worker, cores and English model are served from the site itself under `/tesseract/` (copied there by `client/scripts/copy-tesseract.mjs` before each build), so `connect-src 'self'` is enough and nothing loads from a CDN. `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` |
| `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` | `nosniff`; `same-origin` (nothing in the app needs a referrer sent to Cloudinary or Google); `DENY`, for browsers older than `frame-ancestors`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The headers skip `/api/*`: the API's responses carry helmet's own headers. HTTPS and HSTS come from Vercel and Render.

**Client addresses (`TRUST_PROXY_HOPS`).** A request from the site passes two proxies: Vercel, then Render's own. `TRUST_PROXY_HOPS` says how many of them the API trusts. The coarse per-IP ceilings key on every address those proxies forwarded, visitor first. They cover failed sign-ins, sign-ups, demo sign-ins per role, and each network's share of the day's code emails. The per-email and per-role limits don't depend on it.

| Value                                | Through the site                                                                                                                                                                                                                                     | Calling `onrender.com` directly                                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1`                                  | The key is Vercel's address, the same for every visitor. One visitor scripting 100 failed sign-ins, 60 demo sign-ins for one role, or 50 code requests locks every other visitor out of that, for 15 minutes up to a day. Never use it behind Vercel | The caller's own address                                                                                                                                                                                                                           |
| **`2`** (in `render.yaml`)           | "visitor, Vercel's address", so each visitor has their own ceilings. Vercel replaces any `X-Forwarded-For` a browser sends, so visitors can't pick theirs                                                                                            | "what the caller wrote, the caller's own address". A new value each time gets them fresh ceilings, which leaves them only the per-email and per-role limits. A victim's address never reaches the victim's counter, which ends in Vercel's address |
| More than the real number of proxies | The same as the right number                                                                                                                                                                                                                         | The same as `2`                                                                                                                                                                                                                                    |

Too many trusted hops only hands a caller who writes `X-Forwarded-For` fresh ceilings of their own. Too few makes every visitor share one. So when unsure, round up. Whether Render's proxy is really one hop isn't documented, and community reports differ, so check it once after the first deploy ([§9](#9-smoke-test), "Client addresses").

A direct caller who writes a new address each time also gets past the per-network share of code emails. For them only the global cap (250 a day) is left, and that one stops everyone's sign-ups. Closing the gap needs Vercel to mark its requests with a secret that Render checks, which isn't built. The API logs a warning when 80% of the day's code emails are used: watch for "80% of the code emails" in Render's logs during judging.

**Expected console noise:** one CSP report for `unsafe-eval` per page load. Zod tries `Function("")` once to see whether it may compile validators, and falls back to its normal mode when the CSP says no. Nothing breaks. Preview deployments also show CSP errors for Vercel's toolbar script; turn the toolbar off in the project settings if they get in the way.

**Preview deployments use the same `vercel.json`,** so a preview of any branch talks to the production API and database.

---

## 7. `CLIENT_URL` and the rewrite: each side names the other

| Side   | Setting                                               | Value                                                                                             |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Render | `CLIENT_URL`                                          | The Vercel production origin, exactly: `https://<project>.vercel.app`, no trailing slash, no path |
| Vercel | the `/api/:path*` destination in `client/vercel.json` | The Render origin: `https://<service>.onrender.com`                                               |
| Local  | `CLIENT_URL` in `server/.env`                         | `http://localhost:5173` (the Vite dev server)                                                     |

- [ ] Once Vercel shows its production URL, compare it with `CLIENT_URL` on Render. If they differ, edit `CLIENT_URL` (Render → Environment), save, and deploy.
- `CLIENT_URL` is the base of the links in emails ("See your verification status: …") and the CORS origin for direct calls. Through the rewrite the browser never makes a cross-origin call, so a wrong value doesn't break signing in, only the email links.
- Adding a custom domain on Vercel later means changing `CLIENT_URL` to it. A new Render URL means editing `vercel.json` and redeploying the client.

---

## 8. Seed the Atlas database

The seed writes the 18 NIT JSR org units, the badge catalogue, 13 sample resources, the 6 demo users and 16 demo bookings in every status, then clears the API's caches. It's idempotent, so running it again resets the demo. Run it from your laptop.

- [ ] Your IP is in Atlas's access list ([§1](#1-mongodb-atlas)).
- [ ] Pick a **new** `SEED_PASSWORD` for the deployment (8–72 characters, at least one letter and one digit), not the one from your local `.env`. It's the demo accounts' password, and it goes in the judges' testing notes.
- [ ] Create `server/.env.production.local` (git-ignored) with an editor, not with `echo`, so the values stay out of your shell history:

  ```
  MONGODB_URI=<the Atlas URI from §1>
  REDIS_URL=<the Upstash URL from §2>
  SEED_PASSWORD=<the new password>
  ```

- [ ] Run the seed against it:

  ```
  cd server
  DOTENV_PATH=.env.production.local npm run seed
  ```

  `DOTENV_PATH` makes dotenv load that file instead of `server/.env`. A variable already set in the shell still wins.

  Expect `Seeding the "campuscommons" database.` first and `Done. Demo logins: …` last. Point it at the **Upstash** Redis, not a local one: the seed clears the deployed API's caches there, and the demo bookings need the Redis lock. Without Redis it prints `Demo bookings skipped`.

  On a network that blocks port 6379 (campus Wi-Fi often does: [§0](#0-before-you-start)), the laptop can't reach Upstash. Upstash's port 443 serves only its REST API, not the Redis protocol, so there is no way around it there. Either:
  - **run the seed from a phone hotspot**, as above; or
  - **seed with your local Redis** (`REDIS_URL=redis://127.0.0.1:6379` in `.env.production.local`, with the Atlas `MONGODB_URI`).
    - Any Redis takes the booking lock, so the demo bookings are created.
    - Only clearing the deployed API's caches is skipped: they expire on their own within 10 minutes, and a new deployment has none.
    - Seed while nobody is using the site: the deployed API's bookings take their lock in Upstash, not in your local Redis.

- [ ] Run it while the API is idle. A sweep that runs mid-seed can move a demo booking on, which is then skipped with a warning; run the seed again.
- [ ] **Seed shortly before judging.** The demo bookings are placed relative to the moment of the seed ("tomorrow 10:00", "in use now"), and the sweeper moves them on as time passes.

---

## 9. Smoke test

- [ ] **Health and rewrite:** the two `curl` checks in [§5](#5-render-the-api) and [§6](#6-vercel-the-client).
- [ ] **In a browser:** open `https://<project>.vercel.app` → Login → the **Manager** button. Reload the page: you must still be signed in (the refresh cookie works through the rewrite). In DevTools → Application → Cookies, `refreshToken` is on the Vercel domain with path `/api/v1/auth`, HttpOnly, Secure, SameSite Strict. The console should show no CSP errors apart from the Zod one ([§6](#6-vercel-the-client)).
- [ ] **The judge script, scripted.** Run against the **Vercel** URL so the rewrite is tested too (`/api/v1` is added for you):

  ```
  cd server
  DOTENV_PATH=.env.production.local npm run golden-path -- https://<project>.vercel.app
  # … one line per step …
  # Golden path passed: all 12 steps.
  ```

  It signs in with the demo role buttons' endpoint, falling back to `SEED_PASSWORD` if those are rate limited. When Cloudinary is configured it uploads two 1×1 PNG condition photos (`--no-photos` skips them). A failure prints the step and a `requestId`; search Render's logs for that id. To tell a proxy problem from an API problem, reseed and run it against `https://<service>.onrender.com`.

- [ ] **Reseed straight away.** The run leaves the demo student holding _3D Printing Basics_, so steps 2–4 of the judge script won't work until you do:

  ```
  DOTENV_PATH=.env.production.local npm run seed
  ```

  (The run's own printer listing is archived at the end and stays hidden from members.)

- [ ] **Client addresses** ([§6](#6-vercel-the-client), `TRUST_PROXY_HOPS`). A failed sign-in answers with a `RateLimit` header: how many failed sign-ins the sender's network has left. So a few failed sign-ins with made-up addresses show whether each visitor has their own ceiling. From your laptop, through the site:

  ```
  curl -s -o /dev/null -D - https://<project>.vercel.app/api/v1/auth/login \
    -H 'content-type: application/json' \
    -d '{"email":"proxy-check-1@nitjsr.ac.in","password":"not-the-password-1"}' | grep -i '^ratelimit:'
  # ratelimit: limit=100, remaining=99, reset=900
  ```

  1. Again with `proxy-check-2`: `remaining=98`, your network counted together. A second `99` means Vercel sent the two requests from different addresses, which is fine: run the steps below anyway.
  2. With `proxy-check-3`, adding `-H 'X-Forwarded-For: 192.0.2.1'`: one less again (`97`). Vercel replaced the forged header.
  3. With `proxy-check-4`, from **another network** (a phone's hotspot, a cloud shell, a teammate at home): `remaining=99`. Each visitor has their own ceilings.

  A smaller number in step 3 means every visitor shares one counter. Raise `TRUST_PROXY_HOPS` by one in `render.yaml`, push, wait for the deploy, and repeat with new `proxy-check-` numbers. If no value up to 4 helps, Vercel isn't forwarding visitors' addresses: tell the team before judging, because one visitor can then lock the others out. No `ratelimit` line at all means Redis is down and no limit is enforced: check `/health`.

- [ ] **Email.** A teammate registers on the deployed site with their own `@nitjsr.ac.in` address; the code should arrive within a minute. If it doesn't, Render's logs say why: `SMTP_HOST is not set, so an email was not sent`, or `Couldn't email an OTP` with the SMTP error (a connection timeout on 465/587 is Render's free-tier block, [§4](#4-smtp-email)). That teammate's account is real data on a demo-only instance ([§12](#12-the-demo_mode-decision)).
- [ ] **Private files and the CSP.** Sign in with the password form as `newstudent@demo.campuscommons.test` / `SEED_PASSWORD` (the seeded user whose ID card is pending; there's no role button for them). Go to Verification and upload any test image (never a real ID card). Then sign in as **Admin** → Verifications → open it: the image must show. That checks Cloudinary, the signed Download API link and the CSP's `img-src` in one go. If the dialog says the file can't be shown, the console names the blocked host. Reseed afterwards.
- [ ] **AI.** As the **Student**: Explore → **Ask in your own words** → "something to print a phone case". The FDM 3D Printer should come back with Gemini's reason, and the meter should go down by one. "AI isn't set up" means `GEMINI_API_KEY` is missing on Render; "AI couldn't answer" means Render's log has a `Gemini call failed` line with the reason.
- [ ] **The on-device ID check and the CSP.** In the private-files step above, the picked test image shows "Checking the card on this device", then a **Device check** result. The console must show no CSP error for `wasm-unsafe-eval` or `/tesseract/`. If the check says it couldn't run, look for a 404 on `/tesseract/…` (the copy step didn't run in Vercel's build).
- [ ] Put the Vercel URL, the role buttons, the seeded emails and `SEED_PASSWORD` in the submission's testing notes.

---

## 10. Keep it awake during judging

- [ ] On [cron-job.org](https://cron-job.org), create a job: `GET https://<service>.onrender.com/health` every **10 minutes**, for the judging window. A free Render instance sleeps after about 15 idle minutes; waking takes up to a minute, and a sleeping instance runs no sweeper (the 5-minute reminders, no-shows and overdue returns). The sweeper also runs once at boot to catch up, and booking pages work out "overdue" when they load.
- [ ] A free workspace has a monthly allowance of instance hours. One service awake all month fits; a second free service in the same workspace shares it. For a judging window with no cold starts at all, switch the plan to Starter in `render.yaml` and sync.

---

## 11. Rotate the secrets

The repo is public, and early commits contain a `server/.env` with the JWT secrets (and a `cookies.txt` with a refresh token). Those values are burned: **generate new ones; never reuse old ones anywhere.**

- [ ] **Render:** the Blueprint generated new `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` and `OTP_PEPPER`. Check that nobody overwrote them with values from a local `.env`.
- [ ] **Locally:** replace the three in `server/.env` too, with a new value each:

  ```
  node -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))'
  ```

  Run it once per variable; never give two variables the same value.

- [ ] Anything else that was ever in a committed `.env` is burned as well: database passwords, Redis URLs, API secrets, SMTP passwords. The Atlas user, Upstash database and Cloudinary key made above are new; revoke the old ones (Atlas: delete the old database user; Cloudinary: delete the old API key; Brevo: delete the old SMTP key; Google: remove the old app password).
- [ ] The `yuvraj` branch still contains the old `server/.env` and `cookies.txt` (progress.md §9): delete or clean it. Purging the history is optional once nothing in it works anymore.
- [ ] After judging, delete `server/.env.production.local` from your laptop, or move its values into a password manager.

**Rotating again later** (a suspected leak): Render → Environment → replace the value with a new one generated as above → save and deploy.

| New value for          | Effect                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- |
| `ACCESS_TOKEN_SECRET`  | Every access token fails once. The client refreshes silently, so nobody notices |
| `REFRESH_TOKEN_SECRET` | Everyone is signed out and signs in again                                       |
| `OTP_PEPPER`           | Codes already sent stop working; people ask for a new one                       |

After a leak, rotate both token secrets together.

---

## 12. The `DEMO_MODE` decision

**The judged instance runs `DEMO_MODE=true` and is demo-only.** That's set in `render.yaml`, with the reason next to it.

While it's on, the login page shows the role buttons, and anyone can sign in as the seeded `@demo.campuscommons.test` users, **the demo admin included**. The demo admin is kept away from real members' ID cards, badge evidence and the user list, but it still reads the whole audit log, every booking queue and every incident, names included (progress.md §11, "Decision needed: the demo admin's reach"). So:

- [ ] Don't share the judged URL with students or invite real users onto it. Registration stays open to `@nitjsr.ac.in` (there's no switch to close it), so a teammate can show the OTP flow with their own address, knowing the demo admin can see that account's activity.
- [ ] A deployment for real members is a **separate** stack: its own Render service (copy the Blueprint under another name), its own Atlas database, its own Upstash database, new secrets, and `DEMO_MODE=false`. With it off, the demo buttons disappear, `POST /auth/demo-login` answers 404, and the demo accounts can't sign in at all.
- At start-up the API warns in the log when `DEMO_MODE` is on and accounts outside the demo domain exist: the sign that real people are on a demo instance.
- **Reviewing a real member needs a real admin.** The demo admin's verification queue shows only demo accounts, so a teammate's ID card never appears there. Make your own (email-verified) account an admin, then reload the site:

  ```
  cd server
  npm run grant-admin -- <your email>        # --revoke takes it away again
  ```

  It changes the database in `MONGODB_URI` (`DOTENV_PATH=.env.production.local` for the deployed one, if your `server/.env` points elsewhere) and is audited as `user.roles_changed`.
- **Emergency brake:** setting `DEMO_MODE` to `"false"` on the judged instance (in `render.yaml`, then sync) stops every demo sign-in. A demo session already open ends at its next token refresh, within 15 minutes. The golden-path script needs `DEMO_MODE=true`.

---

## 13. Rolling back

| What                          | How                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API code**                  | Render → the service → **Events** → pick the last good deploy → **Rollback**. The old build comes back with the **current** environment variables, so undo a bad env change by hand. If Render turned auto-deploy off after the rollback, turn it back on once the branch is fixed                                                                                                      |
| **Client**                    | Vercel → **Deployments** → the last good production deployment → ⋯ → **Instant Rollback**. `vercel.json` is part of each deployment, so a rolled-back client also proxies to the Render URL it was built with                                                                                                                                                                           |
| **Both**                      | If a change touched the API's contract, roll both back, API first                                                                                                                                                                                                                                                                                                                       |
| **A bad env value or secret** | Fix the value and deploy; a rollback doesn't restore variables. Leaked secrets are rotated ([§11](#11-rotate-the-secrets)), never rolled back                                                                                                                                                                                                                                           |
| **Demo data**                 | `DOTENV_PATH=.env.production.local npm run seed` puts every seeded record and the demo bookings back                                                                                                                                                                                                                                                                                    |
| **Other data**                | There are no migrations, so code rollbacks never need a data rollback. M0 has no backups: before anything risky, run `mongodump --uri "<MONGODB_URI>" --out ~/campuscommons-backups/<date>` (MongoDB Database Tools), and restore with `mongorestore --uri "<MONGODB_URI>" --drop ~/campuscommons-backups/<date>`. Keep dumps **outside the repo**: they hold password hashes and names |
| **Redis**                     | Nothing to roll back; caches rebuild. Flushing it signs everyone out, voids codes in flight and resets rate limits                                                                                                                                                                                                                                                                      |

---

## 14. Troubleshooting

| Symptom                                                                                                      | Likely cause                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails with `Refusing to start in production…`                                                         | The lines above it name each missing or too-short variable ([§5](#5-render-the-api))                                                                                                                                                                |
| Deploy fails; logs stop before `MongoDB connected`                                                           | Atlas network access doesn't include Render's outbound ranges, or a wrong user or password in `MONGODB_URI`                                                                                                                                         |
| `MongoDB connected` with `db: "test"`                                                                        | No `/campuscommons` in `MONGODB_URI`                                                                                                                                                                                                                |
| `/health` says `"redis":"degraded"`                                                                          | `REDIS_URL` is the REST URL, or `redis://` instead of `rediss://`                                                                                                                                                                                   |
| Bookings answer 503; sign-in says "briefly unavailable"                                                      | Redis is down or out of its command quota                                                                                                                                                                                                           |
| Uploads answer 503 "Uploads aren't configured."                                                              | A `CLOUDINARY_*` variable is missing                                                                                                                                                                                                                |
| No OTP email                                                                                                 | [§9](#9-smoke-test), email. On the free plan, `SMTP_PORT` must be 2525 with Brevo: the boot log then has no `SMTP_PORT is 587, which Render's free instances block` warning. Each failed send logs `Couldn't email an OTP` with the SMTP error within about 15 seconds. Also check the sender is verified in Brevo, and the recipient's spam folder |
| Signed in, but a reload signs you out                                                                        | Look at `POST /api/v1/auth/refresh` in DevTools → Network. No `refreshToken` cookie sent: the login's `Set-Cookie` didn't come back through the rewrite. 401: the session ended (new token secrets, or Redis lost it). 503: Redis is down           |
| `/api/...` on Vercel returns HTML or a DNS error                                                             | The rewrite still points at the placeholder or the wrong host ([§6](#6-vercel-the-client))                                                                                                                                                          |
| The first request after a quiet spell is slow or fails                                                       | Render's free instance waking up ([§10](#10-keep-it-awake-during-judging))                                                                                                                                                                          |
| A large upload (close to the 5 MB limit, e.g. a PDF) fails through the site but works against the Render URL | Vercel's proxy capping the request body below the API's limit: keep files smaller, or check Vercel's current limits for external rewrites                                                                                                           |
| A blank page on every route, the console says `t is not a function` (or `__commonJSMin is not a function` in a non-minified build), although Vercel says the deployment succeeded | Rolldown placed its CommonJS helpers in a chunk that loads after the React chunk. `client/vite.config.js` sets `output.strictExecutionOrder: true` against it (30 Oct); keep it if the chunk groups change |
| An ID card or photo doesn't show                                                                             | The console names the host the CSP blocked; add it to `img-src` in `client/vercel.json`                                                                                                                                                             |
| "This demo account has been signed into a lot from your network"                                             | The per-IP demo ceiling: 60 sign-ins per role from one network in 15 minutes. If visitors on different networks all get it, the API is keying everyone on Vercel's address: `TRUST_PROXY_HOPS` is too low ([§9](#9-smoke-test), "Client addresses") |
| "Too many verification codes asked for from your network today"                                              | That network's share of the day's code emails (50) is used up; other networks can still sign up. It resets a day after the network's first code                                                                                                     |
| Demo buttons missing                                                                                         | `DEMO_MODE` isn't `"true"`, or `/api/v1/auth/demo-config` isn't reaching Render                                                                                                                                                                     |
| Demo button says "Run npm run seed"                                                                          | The database has no demo users: [§8](#8-seed-the-atlas-database)                                                                                                                                                                                    |
