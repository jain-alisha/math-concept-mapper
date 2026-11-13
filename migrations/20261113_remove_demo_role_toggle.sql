-- Apply to the existing Supabase project before accepting real students.
-- Safe to re-run. Teacher grants remain administrator-managed app_metadata.
begin;
drop function if exists public.toggle_role();
notify pgrst, 'reload schema';
commit;
