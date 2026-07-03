-- Fixes from the Supabase security advisor (applied 2026-07-03).

-- Pin search_path (advisor: function_search_path_mutable)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Trigger functions don't need to be callable via the REST RPC surface
-- (advisors: anon/authenticated_security_definer_function_executable)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
