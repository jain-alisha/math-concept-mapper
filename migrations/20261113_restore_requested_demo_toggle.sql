-- Restore the user-requested DEMO-ONLY self-service toggle.
-- This intentionally preserves the existing schema behavior; it is not a pilot role gate.
-- Not applied automatically. See TODO.md, Auth & roles.
begin;
create or replace function public.toggle_role()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  span_account_role text;
begin
  select coalesce(raw_app_meta_data->>'role', 'student') into span_account_role
  from auth.users where id = auth.uid();

  update auth.users
  set raw_app_meta_data = raw_app_meta_data
    || jsonb_build_object('role', case when span_account_role = 'teacher' then 'student' else 'teacher' end)
  where id = auth.uid();
end;
$$;

revoke execute on function public.toggle_role() from public;
grant execute on function public.toggle_role() to authenticated;

notify pgrst, 'reload schema';
commit;
