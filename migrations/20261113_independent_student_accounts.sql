-- Additive signup/recovery support. Run once before deploying student-accounts.
begin;
create table if not exists public.student_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{3,23}$'),
  recovery_hash text not null check (recovery_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.student_accounts enable row level security;
revoke all on public.student_accounts from anon, authenticated;
grant all on public.student_accounts to service_role;

create table if not exists public.student_account_attempts (
  bucket text primary key,
  attempts integer not null,
  window_start timestamptz not null
);
alter table public.student_account_attempts enable row level security;
revoke all on public.student_account_attempts from anon, authenticated;
grant all on public.student_account_attempts to service_role;
create or replace function public.consume_student_account_attempt(bucket text, max_attempts integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare hits integer;
begin
  -- Bound storage: keep only current/recent counters, never raw IP addresses.
  delete from public.student_account_attempts where window_start < now() - interval '1 day';
  insert into public.student_account_attempts as a (bucket,attempts,window_start)
  values (bucket,1,now())
  on conflict on constraint student_account_attempts_pkey do update
  set attempts = case when a.window_start < now()-interval '15 minutes' then 1 else a.attempts+1 end,
      window_start = case when a.window_start < now()-interval '15 minutes' then now() else a.window_start end
  returning attempts into hits;
  return hits <= max_attempts;
end;
$$;
revoke all on function public.consume_student_account_attempt(text,integer) from public, anon, authenticated;
grant execute on function public.consume_student_account_attempt(text,integer) to service_role;

-- Account ownership stays independent of class membership. The existing
-- (class_id, student_id) primary key already permits any number of classes.
-- Keep internal login identifiers out of teacher rosters.
create or replace function public.join_class_by_code(code text)
returns table (class_id uuid, class_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare target record; me record;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select id,name into target from public.classes where invite_code = upper(trim(code));
  if target is null then raise exception 'Invalid invite code'; end if;
  select case when raw_app_meta_data->>'account_kind' = 'username' then null else email end as email,
    coalesce(raw_user_meta_data->>'display_name',raw_user_meta_data->>'username') as display_name
    into me from auth.users where id = auth.uid();
  insert into public.class_members (class_id,student_id,student_email,student_display_name)
  values (target.id,auth.uid(),me.email,me.display_name)
  on conflict on constraint class_members_pkey do update
  set student_email=excluded.student_email,student_display_name=excluded.student_display_name;
  return query select target.id,target.name;
end;
$$;
revoke execute on function public.join_class_by_code(text) from public;
grant execute on function public.join_class_by_code(text) to authenticated;

-- Joining one class must not expose personal maps or work for another class.
drop policy if exists "teachers view their students maps" on public.maps;
create policy "teachers view their students maps" on public.maps for select to authenticated using (
  exists (select 1 from public.activities a join public.class_members cm on cm.class_id=a.class_id
    where a.id=maps.activity_id and cm.student_id=maps.owner_id and public.is_class_teacher(a.class_id))
);
notify pgrst, 'reload schema';
commit;
