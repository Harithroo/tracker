-- Adds last_watched_at so "Continue Watching" can rank by recency.
create or replace view public.episode_watch_counts
with (security_invoker = true) as
select user_id, tmdb_show_id, count(*)::int as watched_count, max(watched_at) as last_watched_at
from public.episode_watches
group by user_id, tmdb_show_id;
