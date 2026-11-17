-- Teacher access is administrator-assigned. Disable the legacy self-serve RPC.
create or replace function public.toggle_role()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  raise exception 'Teacher access is administrator-assigned.' using errcode = '42501';
end;
$$;
revoke execute on function public.toggle_role() from public, anon, authenticated;

drop policy if exists "students leave own classes" on public.class_members;
create policy "students leave own classes" on public.class_members
  for delete to authenticated using (student_id = auth.uid());
