# Tracker

Personal movie & TV show tracker — a TV Time replacement. Next.js (App Router) + TypeScript + Tailwind + MongoDB + Firebase Auth + TMDB. Architecture notes live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

### 1. MongoDB Atlas

1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas), sign in, and create a free **M0** cluster (any name, any region near you).
2. Under **Database Access**, add a database user with a password, and note both.
3. Under **Network Access**, add an IP allowlist entry. `0.0.0.0/0` is the simplest for a hobby app deployed on Vercel, whose egress IPs aren't fixed.
4. Click **Connect → Drivers** and copy the connection string → `MONGODB_URI` (substitute your user's password). `MONGODB_DB` can stay `tracker`.
5. Create the indexes:
   ```bash
   npm run db:init
   ```
   Safe to re-run; the unique indexes it creates are what make "mark watched" idempotent, so don't skip it.

### 2. Firebase Auth

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) (Analytics optional).
2. **Build → Authentication → Get started**, then enable the **Email/Password** and **Google** providers.
3. **Project settings → General → Your apps → Web app** (`</>`). From the config snippet, copy:
   - `apiKey` → `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `authDomain` → `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `projectId` → `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
4. **Project settings → Service accounts → Generate new private key**. From the downloaded JSON, copy `project_id`, `client_email` and `private_key` into `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`. Keep the key's `\n` escapes and wrap the value in double quotes.
5. **Authentication → Settings → Authorized domains** already lists `localhost`; add your Vercel domain when you deploy, or Google sign-in will be rejected there.

Confirmation and password-reset emails are sent and handled by Firebase — there are no email templates to edit and no mail provider to wire up.

An email/password account can't log in until its address is confirmed (`Check your email for a confirmation link before logging in.`). The login screen offers **Resend confirmation email** when that happens. If the mail still doesn't arrive, confirm the account directly:

```bash
npm run user:verify -- you@example.com
```

Google sign-in skips confirmation entirely — Google has already verified the address.

### 3. TMDB

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to [Settings → API](https://www.themoviedb.org/settings/api) and request an API key (choose "Developer"; approval is instant — any placeholder app details are fine).
3. Copy the **API Read Access Token** (the long `eyJ…` one, *not* the short API key) → `TMDB_API_TOKEN`.

### 4. Environment

Copy `.env.example` to `.env.local` and fill it in:

```
MONGODB_URI=mongodb+srv://user:password@cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=tracker
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
FIREBASE_PROJECT_ID=your-project
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"
TMDB_API_TOKEN=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 5. Run

```bash
npm run dev
```

Open http://localhost:3000 — you'll be redirected to `/login`. Sign up with an email and password (confirm the emailed link first) or use **Continue with Google**, and start tracking.

## Deploying to Vercel

1. Push the repo to GitHub and import it in [vercel.com/new](https://vercel.com/new).
2. Add every env var from `.env.local`, with `NEXT_PUBLIC_SITE_URL` set to your Vercel URL.
3. Add the Vercel domain under Firebase **Authentication → Settings → Authorized domains**.
4. Make sure Atlas **Network Access** allows Vercel's egress (`0.0.0.0/0` unless you've set up a static IP).

## How it works (short version)

- **No custom backend.** Server Components read from TMDB (cached) and MongoDB; Server Actions write to MongoDB. Every query is scoped by the signed-in user's Firebase uid.
- **Auth is a session cookie.** The browser signs in with the Firebase SDK and posts the resulting ID token to `/api/auth/session`, which mints an httpOnly session cookie. Server code verifies that cookie; `proxy.ts` only checks that one exists.
- **TMDB is the source of truth for metadata.** The database stores only user data (status, rating, favorites, notes, episode watches) plus a small refreshable snapshot (title/poster/runtime/genres) so library pages and stats don't need N TMDB calls.
- **Progress is derived, never stored** — completion %, next episode, and all statistics are computed from `episode_watches` at request time.
