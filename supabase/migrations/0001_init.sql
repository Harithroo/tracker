-- TV Time Alternative — initial schema
-- Run this in the Supabase SQL Editor (or `supabase db push`).

create type public.media_type as enum ('movie', 'tv');
create type public.watch_status as enum ('watching', 'completed', 'plan_to_watch', 'on_hold', 'dropped');

-- ---------------------------------------------------------------------------
-- profiles: mirrors auth.users, created automatically on signup
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles select own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- library_items: one row per (user, movie-or-show)
-- title/poster/runtime/genres are a refreshable TMDB snapshot, not the source
-- of truth — they exist so library pages and stats never need N TMDB calls.
-- ---------------------------------------------------------------------------
create table public.library_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  tmdb_id         integer not null,
  media_type      public.media_type not null,
  status          public.watch_status not null,
  rating          smallint check (rating between 1 and 10),
  favorite        boolean not null default false,
  notes           text,
  started_at      date,
  finished_at     date,
  title           text not null,
  poster_path     text,
  release_year    smallint,
  runtime_minutes integer,
  genre_ids       smallint[] not null default '{}',
  total_episodes  integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, tmdb_id, media_type)
);

create index library_items_user_status_idx on public.library_items (user_id, status);
create index library_items_user_favorite_idx on public.library_items (user_id) where favorite;

alter table public.library_items enable row level security;

create policy "library select own" on public.library_items
  for select using (auth.uid() = user_id);
create policy "library insert own" on public.library_items
  for insert with check (auth.uid() = user_id);
create policy "library update own" on public.library_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "library delete own" on public.library_items
  for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger library_items_set_updated_at
  before update on public.library_items
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- episode_watches: one row per episode watched; progress is derived from this
-- ---------------------------------------------------------------------------
create table public.episode_watches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  tmdb_show_id    integer not null,
  season_number   smallint not null,
  episode_number  smallint not null,
  runtime_minutes integer,
  watched_at      timestamptz not null default now(),
  unique (user_id, tmdb_show_id, season_number, episode_number)
);

create index episode_watches_user_show_idx on public.episode_watches (user_id, tmdb_show_id);
create index episode_watches_user_date_idx on public.episode_watches (user_id, watched_at);

alter table public.episode_watches enable row level security;

create policy "episodes select own" on public.episode_watches
  for select using (auth.uid() = user_id);
create policy "episodes insert own" on public.episode_watches
  for insert with check (auth.uid() = user_id);
create policy "episodes update own" on public.episode_watches
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "episodes delete own" on public.episode_watches
  for delete using (auth.uid() = user_id);
