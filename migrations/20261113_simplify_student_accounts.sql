-- Retire signup gates and secret-key reset data without deleting accounts,
-- passwords, maps, checkpoints, timelines or class memberships.
begin;
alter table public.student_accounts drop column if exists recovery_hash;
alter table public.student_accounts drop column if exists age_band;
alter table public.student_accounts drop column if exists authorization_id;
drop function if exists public.claim_student_authorization(text);
drop function if exists public.release_student_authorization(uuid);
drop table if exists public.student_authorizations;
notify pgrst, 'reload schema';
commit;
