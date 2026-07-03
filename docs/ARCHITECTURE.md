# TV Time Alternative — Architecture

Personal movie & TV tracker. Next.js (App Router) + TypeScript + Tailwind + Supabase + TMDB, deployed on Vercel. Free tiers throughout.

## 1. Overall Architecture

Next.js is the only backend — no custom API server.

```
Browser
  │
  ▼
Next.js (Vercel)
  ├─ Server Components ──► TMDB API        (metadata reads, cached)
  ├─ Server Components ──► Supabase (RLS)  (user data reads)
  ├─ Server Actions ─────► Supabase (RLS)  (user data writes)
  └─ Middleware ─────────► Supabase Auth   (session refresh)
```

Rules:

1. **TMDB is only called from the server.** The token never reaches the browser. Next.js fetch cache makes repeated lookups nearly free.
2. **Supabase is accessed directly — no API layer.** Reads in Server Components, writes in Server Actions. Row Level Security is the authorization layer.
3. **Pages compose the two sources** — TMDB metadata + user's library row, fetched in parallel, merged at render time.

## 2. Folder Structure

```
src/
├── app/
│   ├── (auth)/                 # login, signup, reset-password (card layout, no nav)
│   ├── (app)/                  # main app (nav layout, auth-protected)
│   │   ├── page.tsx            # dashboard
│   │   ├── search/
│   │   ├── movie/[id]/
│   │   ├── tv/[id]/
│   │   ├── tv/[id]/season/[seasonNumber]/
│   │   ├── library/            # ?status= filter via searchParams
│   │   ├── stats/
│   │   └── settings/
│   ├── auth/callback/route.ts  # Supabase code exchange
│   ├── auth/confirm/route.ts   # email confirm / recovery
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                     # Button, Card, Badge, Skeleton...
│   ├── media/                  # PosterCard, MediaGrid, RatingStars, StatusBadge...
│   ├── library/                # StatusPicker, EpisodeChecklist, ProgressBar...
│   └── layout/                 # Navbar, MobileNav, ThemeProvider...
├── lib/
│   ├── tmdb/                   # client.ts (server-only), types.ts, images.ts
│   ├── supabase/               # server.ts, client.ts, middleware.ts
│   └── utils.ts
├── actions/                    # Server Actions: library.ts, episodes.ts, auth.ts
├── types/                      # domain types
└── middleware.ts
supabase/migrations/            # SQL migrations, version-controlled
```

Server Actions are thin: validate input → write to Supabase → `revalidatePath`. No service layer or repositories.

## 3. Database Schema

**Design decision:** store no TMDB *details* (cast, overview, trailers — always fetched live), but keep a small denormalized **snapshot** per library row (`title`, `poster_path`, `release_year`, `runtime_minutes`, `genre_ids`). Rationale:

- Library pages render from one Postgres query instead of N TMDB requests.
- Stats (watch time, favorite genres) are SQL aggregates over stored runtimes/genres.

The snapshot is a refreshable cache, not a source of truth.

**Design decision:** one shared `watch_status` enum for both media types. Movies use the subset `completed` (UI label "Watched"), `plan_to_watch`, `dropped`. Separate movie statuses would double enum handling for no data-model benefit.

```sql
create type media_type   as enum ('movie', 'tv');
create type watch_status as enum ('watching', 'completed', 'plan_to_watch', 'on_hold', 'dropped');

-- Mirrors auth.users; created by trigger on signup
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- One row per (user, movie-or-show)
create table library_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  tmdb_id         integer not null,
  media_type      media_type not null,
  status          watch_status not null,
  rating          smallint check (rating between 1 and 10),
  favorite        boolean not null default false,
  notes           text,
  started_at      date,
  finished_at     date,
  -- TMDB snapshot (performance cache, refreshable)
  title           text not null,
  poster_path     text,
  release_year    smallint,
  runtime_minutes integer,      -- movies only
  genre_ids       smallint[],   -- names resolved from static map
  total_episodes  integer,      -- tv only; refreshed on show view
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, tmdb_id, media_type)
);

create index library_items_user_status_idx   on library_items (user_id, status);
create index library_items_user_favorite_idx on library_items (user_id) where favorite;

-- One row per episode watched; everything else derived
create table episode_watches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  tmdb_show_id    integer not null,
  season_number   smallint not null,
  episode_number  smallint not null,
  runtime_minutes integer,      -- snapshot for watch-time stats
  watched_at      timestamptz not null default now(),
  unique (user_id, tmdb_show_id, season_number, episode_number)
);

create index episode_watches_user_show_idx on episode_watches (user_id, tmdb_show_id);
create index episode_watches_user_date_idx on episode_watches (user_id, watched_at);
```

All tables: RLS enabled, four policies each (`user_id = auth.uid()`), plus a signup trigger creating the `profiles` row.

**Derived, never stored:** current episode (max watched), completion % (count / total_episodes), next episode (computed vs TMDB season data), all statistics (SQL aggregates), built-in lists (filtered views of `library_items`).

**Accepted MVP limitation:** movies model a single watch (rewatch = update `finished_at`). A `movie_watches` table can be added later without rework.

## 4. Authentication Flow

Supabase Auth with `@supabase/ssr` (cookie sessions; auth-helpers is deprecated).

- Signup → email confirm link → `/auth/confirm` → session. Trigger creates `profiles` row.
- Login/logout via Server Actions.
- `middleware.ts` refreshes tokens on every request (required for the SSR setup).
- `(app)` layout gates with `supabase.auth.getUser()` (not `getSession()` — must validate server-side), redirects to `/login`.
- Password reset: request email → recovery link → `/auth/confirm` → update-password form.
- OAuth later is config-only.

## 5. TMDB Integration

- v4 Read Access Token in `TMDB_API_TOKEN` (no `NEXT_PUBLIC_`). `lib/tmdb/client.ts` imports `server-only` so client imports fail at build.
- One typed fetch wrapper (base URL, auth header, errors, caching); endpoint functions are one-liners.
- Next.js fetch cache: details 24h, search 1h, trending 12h.
- `append_to_response` bundles credits, videos, watch providers, similar → one request per details page.
- Search is server-rendered from `?q=`. Autocomplete later via a thin `/api/search` route handler.
- `lib/tmdb/images.ts` builds CDN image URLs (pure, client-safe); TMDB image domain allowlisted in `next.config`.

## 6. Routes

| Route | Purpose |
|---|---|
| `/` | Dashboard: continue watching, up next, recent activity |
| `/search?q=` | TMDB search |
| `/movie/[id]`, `/tv/[id]`, `/tv/[id]/season/[n]` | Details / episode checklist |
| `/library?status=` | Library filtered by status/favorites |
| `/stats` | Statistics dashboard |
| `/settings` | Profile, password |
| `/login`, `/signup`, `/reset-password`, `/auth/*` | Auth |

Filters live in the URL, not client state.

## 7. State Management

None deliberately — no Redux/Zustand/React Query for MVP:

- Server state arrives as rendered Server Components; mutations `revalidatePath`.
- Optimistic UI via `useOptimistic`/`useTransition` where latency is felt (episode checklist).
- URL as state for search/filters; `useState` for ephemeral UI.
- Dark mode first via class on `<html>`.

TanStack Query can be added surgically later if client interactivity grows.

## 8. Roadmap

| Feature | Approach |
|---|---|
| Custom lists | `lists` + `list_items` tables |
| Reviews | `reviews` table (public/spoiler flags), public-read RLS policy |
| Friends | `follows` table; public profiles |
| Activity feed | Query over friends' timestamped rows; Supabase Realtime optional |
| Notifications | `pg_cron` checks TMDB for new episodes; `notifications` table; Resend for email |
| Calendar | TMDB air dates for shows with status `watching` |
| Recommendations | TMDB `/recommendations` filtered against library |
| Mobile app | Expo against the same Supabase project (RLS already mobile-ready); or responsive PWA |

## Build Phases

1. Scaffold — Next.js + TS + Tailwind, Supabase project, env, base layout & dark theme
2. Auth — full flow
3. TMDB + Discover — client wrapper, search, details pages (read-only)
4. Library — migration, add/status/rating/favorite actions, library page
5. Episode tracking — season pages, checklist, progress
6. Dashboard + Stats
7. Polish — skeletons, empty states, mobile nav, error boundaries
