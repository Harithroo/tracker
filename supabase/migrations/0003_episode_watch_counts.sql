-- Aggregated per-show watch counts, so pages don't have to page through
-- thousands of episode_watches rows. security_invoker makes the view respect
-- the base table's RLS.
create view public.episode_watch_counts
with (security_invoker = true) as
select user_id, tmdb_show_id, count(*)::int as watched_count
from public.episode_watches
group by user_id, tmdb_show_id;
