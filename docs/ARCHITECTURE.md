# TV Time Alternative — Architecture

Personal movie & TV tracker. Next.js (App Router) + TypeScript + Tailwind + MongoDB + Firebase Auth + TMDB, deployed on Vercel. Free tiers throughout.

## 1. Overall Architecture

Next.js is the only backend — no custom API server.

```
Browser ──► Firebase Auth (sign-in, ID token)
  │
  ▼
Next.js (Vercel)
  ├─ Server Components ──► TMDB API      (metadata reads, cached)
  ├─ Server Components ──► MongoDB       (user data reads)
  ├─ Server Actions ─────► MongoDB       (user data writes)
  ├─ /api/auth/session ──► Firebase Admin (ID token → session cookie)
  └─ proxy.ts ───────────► cookie presence only (optimistic gate)
```

Rules:

1. **TMDB is only called from the server.** The token never reaches the browser. Next.js fetch cache makes repeated lookups nearly free.
2. **MongoDB is accessed directly — no API layer.** Reads in Server Components, writes in Server Actions. There is no database-side authorization: the driver connects as one application user, so **every query must filter on `user_id`**. That rule replaces what Row Level Security used to enforce, and nothing else enforces it.
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
│   ├── api/auth/session/      # ID token → session cookie
│   ├── api/import/, api/export/
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                     # Button, Card, Badge, Skeleton...
│   ├── media/                  # PosterCard, MediaGrid, RatingStars, StatusBadge...
│   ├── library/                # StatusPicker, EpisodeChecklist, ProgressBar...
│   └── layout/                 # Navbar, MobileNav, ThemeProvider...
├── lib/
│   ├── tmdb/                   # client.ts (server-only), types.ts, images.ts
│   ├── mongo/                  # client.ts (collections), collections.ts (docs), watches.ts
│   ├── firebase/               # admin.ts (server), client.ts (browser), session.ts
│   └── utils.ts
├── actions/                    # Server Actions: library.ts, episodes.ts, auth.ts
├── types/                      # domain types
└── proxy.ts
scripts/init-db.mjs             # creates the indexes (npm run db:init)
```

Server Actions are thin: validate input → write to MongoDB → `revalidatePath`. No service layer or repositories.

## 3. Database Schema

**Design decision:** store no TMDB *details* (cast, overview, trailers — always fetched live), but keep a small denormalized **snapshot** per library row (`title`, `poster_path`, `release_year`, `runtime_minutes`, `genre_ids`). Rationale:

- Library pages render from one MongoDB query instead of N TMDB requests.
- Stats (watch time, favorite genres) are computed from the stored runtimes/genres.

The snapshot is a refreshable cache, not a source of truth.

**Design decision:** one shared `status` vocabulary for both media types. Movies use the subset `completed` (UI label "Watched"), `plan_to_watch`, `dropped`. Separate movie statuses would double the status handling for no data-model benefit.

```ts
// profiles — one per account, _id is the Firebase uid
{ _id: "uid", username, avatar_url, email, created_at }

// library_items — one per (user, movie-or-show)
{ _id: ObjectId, user_id, tmdb_id, media_type: "movie"|"tv",
  status: "watching"|"completed"|"plan_to_watch"|"on_hold"|"dropped",
  rating, favorite, notes, started_at, finished_at,
  // TMDB snapshot (performance cache, refreshable)
  title, poster_path, release_year, runtime_minutes,
  genre_ids: number[], total_episodes,      // total_episodes: tv only
  created_at, updated_at }

// episode_watches — one per episode watched; everything else derived
{ _id: ObjectId, user_id, tmdb_show_id, season_number, episode_number,
  runtime_minutes, watched_at }
```

Indexes (`scripts/init-db.mjs`):

| Collection | Index | Why |
|---|---|---|
| `library_items` | `{user_id, tmdb_id, media_type}` **unique** | one row per title; the upsert guard |
| `library_items` | `{user_id, status}`, `{user_id, favorite}`, `{user_id, updated_at}`, `{user_id, media_type, finished_at}` | library filters, Continue Watching, history |
| `episode_watches` | `{user_id, tmdb_show_id, season_number, episode_number}` **unique** | makes "mark watched" idempotent |
| `episode_watches` | `{user_id, watched_at}` | recent history, week summary |

**Design decision:** timestamps are ISO-8601 **strings**, not BSON dates (`started_at`/`finished_at` as `YYYY-MM-DD`). Every query over them is a sort or a range, which strings do correctly, and one representation then runs from the collection through the page to the export file unchanged.

**Design decision:** the per-show watch count was a SQL view; it is now one `$group` aggregation in `lib/library/watch-counts.ts`, which also drops specials inside the pipeline (TMDB's `number_of_episodes` excludes them, so counting them read as "1112 / 1108").

**Derived, never stored:** current episode (max watched), completion % (count / total_episodes), next episode (computed vs TMDB season data), all statistics, built-in lists (filtered views of `library_items`).

**Accepted MVP limitation:** movies model a single watch (rewatch = update `finished_at`). A `movie_watches` collection can be added later without rework.

## 4. Authentication Flow

Firebase Auth, with the session exchanged for an httpOnly cookie.

- The browser SDK signs in (email/password or Google popup) — it is the only thing that can mint an ID token. `components/auth/EmailAuthForm.tsx` posts that token to `/api/auth/session`, which verifies it, creates a 14-day Firebase session cookie, and upserts the `profiles` document (so Google accounts get one too, with no signup trigger).
- Email/password accounts must confirm their address: `/api/auth/session` refuses a `password` sign-in whose `email_verified` is false. Google has already verified it.
- Server-side, `lib/firebase/admin.ts#getCurrentUser()` verifies the cookie. Revocation isn't checked — that would cost a round trip per request — so sign-out clears the cookie *and* revokes refresh tokens.
- `proxy.ts` only checks that the cookie **exists**. It runs on every request including prefetches, and Next's docs are explicit that it isn't a session-management layer; the real check happens in the `(app)` layout and in every action.
- Password resets and confirmation emails are sent and handled by Firebase's own hosted pages, so there are no `/auth/*` routes and no mail provider.
- Changing a password while signed in goes through a Server Action using the Admin SDK.

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
| `/login`, `/signup`, `/reset-password` | Auth (sign-in happens in the browser) |
| `/api/auth/session` | ID token → session cookie (POST), sign-out (DELETE) |

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
| Custom lists | `lists` + `list_items` collections |
| Reviews | `reviews` collection (public/spoiler flags) |
| Friends | `follows` collection; public profiles |
| Activity feed | Query over friends' timestamped rows; change streams optional |
| Notifications | A cron route checks TMDB for new episodes; `notifications` collection; Resend for email |
| Calendar | TMDB air dates for shows with status `watching` |
| Recommendations | TMDB `/recommendations` filtered against library |
| Mobile app | Expo against the same Firebase project, talking to route handlers; or responsive PWA |

## Import / Export

Settings offers data portability (`src/lib/import/`, `/api/import`, `/api/export`):

- **Parsing happens client-side** — the uploaded zip (fflate) or JSON is parsed in the
  browser into a normalized `ImportItem[]` (`types.ts`), so there are no upload size
  limits or server parse timeouts. `detect.ts` sniffs the source from filenames.
- **Sources**: Trakt export zip (best — native TMDB ids on everything), TV Time GDPR
  zip (TVDB ids for shows, name+year search for movies), tracker backup JSON
  (round-trips `/api/export`). Liberator pending a sample file.
- **Import executes in chunks**: the client POSTs batches to `/api/import` (auth via
  session cookie), which resolves each item against TMDB
  (id → /find → search fallback), fetches snapshot data and per-season episode
  runtimes, and inserts only episodes not already recorded (the unique index). Modes: merge (default) or
  replace (wipes the user's rows first via `op: "reset"`).
- **Export** (`/api/export`) downloads the full library + watch history as
  `tracker-backup@1` JSON — itself an accepted import source, so it doubles as backup.

## Build Phases

1. Scaffold — Next.js + TS + Tailwind, Atlas cluster + Firebase project, env, base layout & dark theme
2. Auth — full flow
3. TMDB + Discover — client wrapper, search, details pages (read-only)
4. Library — indexes, add/status/rating/favorite actions, library page
5. Episode tracking — season pages, checklist, progress
6. Dashboard + Stats
7. Polish — skeletons, empty states, mobile nav, error boundaries
