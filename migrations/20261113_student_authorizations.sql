begin;
-- Created by an administrator only AFTER verifying the adult's authority
-- and recording evidence outside the public signup flow. Not a checkbox.
create table if not exists public.student_authorizations (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  authority text not null check(authority in ('school','parent')),
  evidence_reference text not null check(length(trim(evidence_reference))>0),
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  max_accounts integer not null check(max_accounts>0),
  accounts_used integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.student_authorizations enable row level security;
revoke all on public.student_authorizations from anon,authenticated;
grant all on public.student_authorizations to service_role;
alter table public.student_accounts add column if not exists authorization_id uuid references public.student_authorizations(id);
alter table public.student_accounts add column if not exists age_band text not null default '13plus' check(age_band in ('under13','13plus'));
create or replace function public.claim_student_authorization(digest text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare claimed uuid;
begin
  update public.student_authorizations set accounts_used=accounts_used+1
  where code_hash=digest and revoked_at is null and expires_at>now() and accounts_used<max_accounts
  returning id into claimed;
  return claimed;
end;
$$;
create or replace function public.release_student_authorization(authorization_ref uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.student_authorizations set accounts_used=greatest(0,accounts_used-1) where id=authorization_ref;
$$;
revoke all on function public.claim_student_authorization(text) from public,anon,authenticated;
revoke all on function public.release_student_authorization(uuid) from public,anon,authenticated;
grant execute on function public.claim_student_authorization(text) to service_role;
grant execute on function public.release_student_authorization(uuid) to service_role;
notify pgrst,'reload schema';
commit;
