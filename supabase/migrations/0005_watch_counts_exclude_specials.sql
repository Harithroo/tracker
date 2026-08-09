-- Progress is measured against TMDB's number_of_episodes, which excludes
-- specials — counting season 0 watches pushed shows past 100% ("1112 / 1108").
-- last_watched_at still spans every watch, so recency ranking is unchanged.
create or replace view public.episode_watch_counts
with (security_invoker = true) as
select
  user_id,
  tmdb_show_id,
  count(*) filter (where season_number > 0)::int as watched_count,
  max(watched_at) as last_watched_at
from public.episode_watches
group by user_id, tmdb_show_id;
