# PulseRoom — Free Synchronized Listen Together Web App

PulseRoom is a self-hosted, 100% free **Listen Together** web application built to run on **Render's free Web Service tier** backed by a **free Neon Postgres database**. Groups can create private rooms, queue YouTube and Spotify links, chat, send reactions, and listen in millisecond-level sync through the official YouTube IFrame Player API.

---

## Folder Structure

```text
.
├── migrations/
│   ├── 001_initial_schema.sql      # Users, connect-pg-simple sessions, rooms, members, queue, history, chat
│   └── 002_lookup_cache.sql        # TTL metadata & search lookup cache
├── src/
│   ├── shared/
│   │   ├── types.ts                # Shared domain types
│   │   ├── sync.ts                 # Pure NTP offset, expected position, drift correction, queue transitions
│   │   └── sync.test.ts            # Unit tests (node:test) for sync & queue math
│   ├── server/
│   │   ├── config.ts               # Environment variables & operational caps
│   │   ├── logger.ts               # Structured JSON logger
│   │   ├── db.ts                   # Neon Postgres pg.Pool (max 5, SSL, auto-suspend retry) + PGlite local fallback
│   │   ├── sessionStore.ts         # Postgres sessions via connect-pg-simple (never in-memory)
│   │   ├── auth.ts                 # bcryptjs hashing, admin seeding, CSRF & session middleware
│   │   ├── permissions.ts          # Server-side RBAC & room permission checks
│   │   ├── permissions.test.ts     # Unit tests (node:test) for permissions
│   │   ├── roomManager.ts          # In-memory live room state + Postgres persistence on control events
│   │   ├── socket.ts               # Socket.IO server, NTP ping/pong, idempotent room events
│   │   ├── providers/
│   │   │   ├── types.ts            # Extensible MusicProvider interface
│   │   │   ├── parsers.ts          # SSRF-safe YouTube/Spotify URL parsers & bulk line parser
│   │   │   ├── parsers.test.ts     # Unit tests (node:test) for URL parsing & allowlists
│   │   │   ├── cache.ts            # Postgres TTL lookup cache
│   │   │   ├── youtube.ts          # Keyless youtube-sr + oEmbed fallback + optional YouTube Data API v3
│   │   │   ├── spotify.ts          # Keyless Spotify oEmbed + public embed scraper -> YouTube matcher
│   │   │   └── index.ts            # Provider registry & batch track matcher
│   │   └── routes/
│   │       ├── authRoutes.ts       # Login, logout, first-run admin bootstrap, session check
│   │       ├── adminRoutes.ts      # Admin user management & live online/room presence
│   │       ├── roomRoutes.ts       # Room CRUD, track/playlist import, batch line matcher
│   │       └── musicRoutes.ts      # YouTube search endpoint
│   ├── lib/
│   │   ├── api.ts                  # Typed fetch client with credentials & CSRF header
│   │   └── socket.ts               # Socket.IO client with exponential backoff
│   ├── hooks/
│   │   ├── useTheme.ts             # Dark/light theme hook
│   │   └── useClockSync.ts         # NTP-style client clock offset estimator
│   ├── components/                 # Modular React UI components
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── server.ts                       # Single-service Express + Socket.IO + Vite/dist server + /health + SIGTERM
├── .env.example
├── index.html
└── package.json
```

---

## Deploying for Free (Neon Postgres + Render)

### 1. Create a Free Neon Postgres Database
1. Sign up for a free account at [neon.tech](https://neon.tech) and create a new project (choose a region close to your Render region, such as US East or Frankfurt).
2. On the Neon dashboard, open **Connection Details**.
3. Check the **Pooled connection** toggle (the hostname will include `-pooler`).
4. Copy the full PostgreSQL connection string (`postgresql://user:password@ep-...-pooler.region.aws.neon.tech/neondb?sslmode=require`).

> SQL migrations in `migrations/` run automatically on startup and are tracked in the `schema_migrations` table. The pool is capped at `max: 5` connections with automatic SSL and retry backoff for Neon's free-tier auto-suspend.

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "Initial PulseRoom deploy"
git branch -M main
git remote add origin https://github.com/<your-username>/pulseroom.git
git push -u origin main
```

### 3. Deploy on Render (Free Web Service)
1. Sign in to [render.com](https://render.com), click **New + -> Web Service**, and connect your GitHub repository.
2. Configure the service:
   - **Runtime**: `Node` (Node 20+)
   - **Instance Type**: `Free`
   - **Build Command**: `npm install` (or `npm install && npm run build` to pre-bundle static frontend assets for lowest RAM use on the 512 MB free tier)
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
3. Add the following **Environment Variables** in Render:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = *(paste your pooled Neon connection string)*
   - `SESSION_SECRET` = *(generate a long random 32+ character string, e.g. `openssl rand -hex 32`)*
   - `ADMIN_USERNAME` = *(your admin username, e.g. `admin`)*
   - `ADMIN_PASSWORD` = *(a strong password, 12+ characters)*
   - *(Optional)* `YOUTUBE_API_KEY` = *(free YouTube Data API v3 key if you want an extra metadata layer; not required)*
   - *(Optional)* `MAX_ROOMS` (`50`), `MAX_USERS_PER_ROOM` (`30`), `MAX_PLAYLIST_IMPORT` (`100`)
4. Click **Create Web Service**. Render installs dependencies, runs the SQL migrations on startup, seeds your admin user, and binds automatically to `process.env.PORT`.

### 4. Create Your First Users
1. Open your deployed Render URL and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` (there is no public signup page).
2. Click **Admin** in the top bar.
3. Use **Create User Account** to add accounts for your friends and share their credentials privately.
4. From the Admin console you can also reset passwords, disable or delete accounts (immediately revoking their sessions and sockets), and see who is currently online and in which room.

### 5. Keep the Service Awake (Optional Free Uptime Pinger)
Render's free Web Service sleeps after ~15 minutes of inactivity. To keep it warm during listening hours, configure a free monitor on **UptimeRobot**, **cron-job.org**, or **Better Stack**:
- **URL**: `https://<your-service>.onrender.com/health`
- **Interval**: Every 10–14 minutes
- **Method**: `GET` (expects HTTP `200`)

`/health` returns immediately from memory without querying Neon, so it keeps your web process responsive while still allowing Neon to auto-suspend when nobody is actively using the app.

---

## Local Development & Automated Tests

```bash
npm install
npm test          # Runs node:test suites for sync engine, permissions, and URL/SSRF parsers
npm run dev       # Starts Express + Socket.IO + Vite on http://localhost:3000
```

> If `DATABASE_URL` is left blank locally, PulseRoom automatically uses embedded PostgreSQL (`@electric-sql/pglite` in `.data/pglite`) executing the exact same SQL migrations and queries. If `ADMIN_USERNAME`/`ADMIN_PASSWORD` are unset on first local run, an inline first-run Admin Setup form appears once and locks permanently after creation.

---

## Known Limitations

- **Render Free Tier Sleep & Cold Starts**: Without an external uptime pinger (or after monthly free hours reset), Render spins the service down after ~15 minutes of inactivity. Waking from sleep takes 20–50 seconds. PulseRoom handles this gracefully by showing a *"Server waking up, reconnecting..."* screen with an automatic retry countdown and restoring all persisted rooms, queues, and playback timestamps from Neon Postgres once awake.
- **Spotify Matched Through YouTube**: Because no paid APIs or Spotify Premium accounts are used, Spotify track/album/playlist links are resolved via Spotify's public oEmbed/embed metadata and matched to YouTube videos (`"artist - title"`). Occasional mismatches (e.g. live versions or covers) can happen; every Spotify-originated track displays a **"Playing via YouTube"** notice. If Spotify blocks scraping on a playlist, PulseRoom automatically opens a **"Track List"** tab where you can paste song names (one per line) to match on YouTube.
- **Embed-Blocked YouTube Videos**: Playback strictly uses the official YouTube IFrame Player API. Some music labels disable third-party embedding (`error 101` / `150`). When encountered, PulseRoom automatically skips to the next queued track and displays a toast notification to the room.
- **Keyless Lookups from Datacenter IPs**: Keyless metadata scraping (`youtube-sr` and Spotify's public embed page) can occasionally be throttled or return different markup from cloud datacenter IPs like Render. All lookups are cached in Postgres with a TTL, use timeouts and retries, fall back to YouTube oEmbed where possible, and optionally accept a free `YOUTUBE_API_KEY` if you want additional resilience.
- **Mobile Browser Autoplay**: Mobile and desktop browsers block unmuted video/audio autoplay until a user gesture occurs. Every room displays a one-time **"Tap to join the music"** overlay to unlock audio and jump straight to the synchronized timestamp.
