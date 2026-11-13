begin;
alter table public.maps add column if not exists is_checkpoint boolean not null default false;
-- Checkpoints remain deletable by their owner, but their contents cannot be
-- edited or unlocked. Timeline organization does not alter the snapshot.
create or replace function public.guard_map_checkpoint()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.is_checkpoint and (new.data is distinct from old.data or new.title is distinct from old.title
    or new.owner_id is distinct from old.owner_id or new.activity_id is distinct from old.activity_id
    or new.created_at is distinct from old.created_at or new.is_checkpoint is distinct from old.is_checkpoint
    or new.updated_at is distinct from old.updated_at) then
    raise exception 'Starting checkpoints are read-only. Make a working copy to continue.';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_map_checkpoint on public.maps;
create trigger protect_map_checkpoint before update on public.maps for each row execute function public.guard_map_checkpoint();

create or replace function public.save_starting_checkpoint(source_id uuid)
returns public.maps language plpgsql security definer set search_path=public,pg_temp as $$
declare source public.maps; snapshot public.maps; timeline uuid;
begin
  select * into source from public.maps where id=source_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Map not found'; end if;
  if source.is_checkpoint then raise exception 'This map is already a checkpoint'; end if;
  timeline := source.timeline_id;
  if timeline is null then
    insert into public.map_timelines(owner_id,name) values(auth.uid(),source.title||' — growth') returning id into timeline;
    update public.maps set timeline_id=timeline where id=source.id;
  end if;
  insert into public.maps(owner_id,title,data,activity_id,timeline_id,is_checkpoint,created_at,updated_at)
    values(auth.uid(),source.title||' — starting checkpoint',source.data,source.activity_id,timeline,true,
      source.created_at,source.updated_at) returning * into snapshot;
  return snapshot;
end;
$$;
revoke all on function public.save_starting_checkpoint(uuid) from public;
grant execute on function public.save_starting_checkpoint(uuid) to authenticated;

-- Server time governs retention; a client cannot extend it with a fake date.
-- Checkpoint timestamps stay fixed so timeline reassignment cannot renew them.
create or replace function public.stamp_map_edit()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if TG_OP='INSERT' then
    if not new.is_checkpoint then new.created_at:=now(); new.updated_at:=now(); end if;
  elsif not old.is_checkpoint and (new.data is distinct from old.data or new.title is distinct from old.title) then
    new.updated_at:=now();
  else new.updated_at:=old.updated_at;
  end if;
  return new;
end;
$$;
drop trigger if exists stamp_map_edit on public.maps;
create trigger stamp_map_edit before insert or update on public.maps for each row execute function public.stamp_map_edit();

create or replace function public.expire_span_maps()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare removed integer;
begin
  delete from public.maps where updated_at < now()-interval '12 months';
  get diagnostics removed = row_count;
  delete from public.map_timelines t where t.created_at < now()-interval '12 months'
    and not exists(select 1 from public.maps m where m.timeline_id=t.id);
  delete from public.student_account_attempts where window_start < now()-interval '1 day';
  return removed;
end;
$$;
revoke all on function public.expire_span_maps() from public,anon,authenticated;
grant execute on function public.expire_span_maps() to service_role;
-- Clients can create working maps only. Protected snapshots are made by the
-- owner-checked RPC above, which bypasses this insert policy.
drop policy if exists "insert own maps" on public.maps;
create policy "insert own maps" on public.maps for insert to authenticated with check (
  auth.uid()=owner_id and not is_checkpoint and
  (activity_id is null or exists(select 1 from public.activities a where a.id=maps.activity_id
    and (public.is_class_member(a.class_id) or public.is_class_teacher(a.class_id))))
);

notify pgrst,'reload schema';
commit;

-- Enable Supabase Cron (pg_cron) before applying this final block. The named
-- schedule is idempotent; installation fails visibly if cron is unavailable.
create extension if not exists pg_cron;
select cron.schedule('span-expire-cloud-maps','17 3 * * *','select public.expire_span_maps()');

