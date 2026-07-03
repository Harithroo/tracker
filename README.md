# Tracker

Personal movie & TV show tracker — a TV Time replacement. Next.js (App Router) + TypeScript + Tailwind + Supabase + TMDB. Architecture notes live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

### 1. Supabase

1. Go to [supabase.com](https://supabase.com), sign in, and click **New project** (free tier). Pick any name (e.g. `tracker`) and a database password (you won't need it day-to-day).
2. Once the project is ready, open **SQL Editor**, paste the entire contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and click **Run**. It should say "Success. No rows returned".
3. Open **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Open **Authentication → URL Configuration** and set **Site URL** to `http://localhost:3000`.
5. Open **Authentication → Emails** (email templates) and replace the link in two templates, so email links work in any browser:
   - **Confirm signup** — replace the `<a>` href with:
     ```
     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
     ```
   - **Reset password** — replace the `<a>` href with:
     ```
     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/update-password
     ```

   *(Optional: under **Authentication → Sign In / Providers → Email**, you can turn off "Confirm email" to skip the confirmation step entirely — it's a personal app.)*

### 2. TMDB

1. Create a free account at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to [Settings → API](https://www.themoviedb.org/settings/api) and request an API key (choose "Developer"; approval is instant — any placeholder app details are fine).
3. Copy the **API Read Access Token** (the long `eyJ…` one, *not* the short API key) → `TMDB_API_TOKEN`.

### 3. Environment

Fill in `.env.local` (already created — same shape as `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
TMDB_API_TOKEN=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000 — you'll be redirected to `/login`. Create an account and start tracking.

## Deploying to Vercel

1. Push the repo to GitHub and import it in [vercel.com/new](https://vercel.com/new).
2. Add the four env vars from `.env.local`, with `NEXT_PUBLIC_SITE_URL` set to your Vercel URL.
3. In Supabase **Authentication → URL Configuration**, set **Site URL** to the Vercel URL and add it under **Redirect URLs**.

## How it works (short version)

- **No custom backend.** Server Components read from TMDB (cached) and Supabase; Server Actions write to Supabase. Row Level Security keeps every user's data isolated.
- **TMDB is the source of truth for metadata.** The database stores only user data (status, rating, favorites, notes, episode watches) plus a small refreshable snapshot (title/poster/runtime/genres) so library pages and stats don't need N TMDB calls.
- **Progress is derived, never stored** — completion %, next episode, and all statistics are computed from `episode_watches` at request time.
