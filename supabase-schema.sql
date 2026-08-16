-- Span: cloud map storage.
--
-- Run this once in your Supabase project's SQL Editor
-- (https://supabase.com/dashboard/project/_/sql/new) after creating the
-- project. See README.md for the full setup walkthrough.
--
-- Deliberately no `profiles` table: display name lives in the client-settable
-- `auth.users.user_metadata`, and role lives in `auth.users.app_metadata`,
-- which the client SDK cannot write (only a service-role/dashboard call can) -
-- see README.md for how to promote an account to 'teacher'. This keeps role
-- out of any table a logged-in user could update on themselves.

create table public.maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null default 'Untitled map',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.maps enable row level security;

-- Every policy is scoped `to authenticated` and every write policy has an
-- explicit `with check` (an insert policy with only a `using` clause is
-- silently ignored - `using` only governs which existing rows are visible).
create policy "select own maps" on public.maps
  for select to authenticated
  using (auth.uid() = owner_id);

create policy "insert own maps" on public.maps
  for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "update own maps" on public.maps
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "delete own maps" on public.maps
  for delete to authenticated
  using (auth.uid() = owner_id);

-- To promote an account to teacher after it signs up normally through the
-- app (self-serve signup always creates a student - see README.md):
--
--   update auth.users
--   set raw_app_meta_data = raw_app_meta_data || '{"role":"teacher"}'::jsonb
--   where email = 'teacher@example.com';
--
-- Note: a user's existing access token still carries the OLD role claim
-- until it refreshes (~1hr, or immediately on next sign-in) - sign out/in
-- after promoting an account or "why can't they create a class" will look
-- like a bug.


-- ============================================================
-- Rostering: classes, invite codes, and read-only teacher access
-- to their students' maps. Run this after the block above.
-- ============================================================

-- Unambiguous alphabet (no I/L/O/U/0/1), formatted XXXX-XXXX for easy
-- reading-aloud/writing-on-a-board, collision-checked against existing codes.
-- security definer so the uniqueness check sees ALL classes, not just ones
-- RLS would let the calling (about-to-be-teacher) user see - otherwise this
-- could "successfully" generate a code that collides with another teacher's
-- class it isn't allowed to query.
create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  code text;
  taken boolean;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    end loop;
    code := substr(code, 1, 4) || '-' || substr(code, 5, 4);
    select exists(select 1 from public.classes where invite_code = code) into taken;
    exit when not taken;
  end loop;
  return code;
end;
$$;
revoke execute on function public.generate_invite_code() from public;
grant execute on function public.generate_invite_code() to authenticated;

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  invite_code text not null unique default public.generate_invite_code(),
  created_at timestamptz not null default now()
);

create table public.class_members (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  student_email text,
  student_display_name text,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

-- Postgres doesn't auto-index the referencing side of a foreign key; both of
-- these are queried on every RLS check below, so index them explicitly.
create index on public.class_members(student_id);
create index on public.classes(teacher_id);

alter table public.classes enable row level security;
alter table public.class_members enable row level security;

-- classes' SELECT policy needs to check class_members, and class_members'
-- SELECT policy needs to check classes - a direct subquery on each side
-- causes genuine infinite recursion in Postgres (evaluating one table's
-- policy re-triggers the other's, forever). SECURITY DEFINER helper
-- functions break the cycle: their internal queries run as the function
-- owner and bypass RLS, so calling one from the other's policy doesn't
-- re-trigger policy evaluation on the way back in.
create or replace function public.is_class_teacher(cid uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists(select 1 from public.classes where id = cid and teacher_id = auth.uid());
$$;
revoke execute on function public.is_class_teacher(uuid) from public;
grant execute on function public.is_class_teacher(uuid) to authenticated;

create or replace function public.is_class_member(cid uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists(select 1 from public.class_members where class_id = cid and student_id = auth.uid());
$$;
revoke execute on function public.is_class_member(uuid) from public;
grant execute on function public.is_class_member(uuid) to authenticated;

-- A user sees classes they teach, or classes they've joined as a student.
-- No broader "browse all classes" policy - that would leak class/teacher
-- names to anyone with an account. Joining by code goes through the RPC
-- below instead of a direct SELECT-by-invite_code policy.
create policy "select own or joined classes" on public.classes
  for select to authenticated
  using (teacher_id = auth.uid() or public.is_class_member(id));

-- Defense in depth: role comes from the JWT's app_metadata claim (server-
-- controlled - see the "promote to teacher" note above; the same source
-- static/auth.js already reads client-side), not just a hidden UI button.
-- A student calling this endpoint directly cannot create a class.
create policy "teachers create classes" on public.classes
  for insert to authenticated
  with check (teacher_id = auth.uid() and (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

create policy "teacher sees own class rosters" on public.class_members
  for select to authenticated
  using (public.is_class_teacher(class_id));

create policy "student sees own memberships" on public.class_members
  for select to authenticated
  using (student_id = auth.uid());

-- No insert policy on class_members at all - the only way to join a class is
-- through this function, which resolves invite_code -> class_id server-side
-- without ever exposing the classes table to browsing/code-guessing via a
-- direct query. security definer + a pinned search_path (privilege-escalation
-- guard for any object-name resolution inside the function body) is the same
-- hardened pattern used for auth-schema access elsewhere in this project.
create or replace function public.join_class_by_code(code text)
returns table (class_id uuid, class_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target record;
  me record;
begin
  select id, name into target from public.classes where invite_code = upper(code);
  if target is null then
    raise exception 'Invalid invite code';
  end if;

  select email, raw_user_meta_data->>'display_name' as display_name
    into me from auth.users where id = auth.uid();

  -- Named-constraint form, not a bare (class_id, student_id) column list:
  -- RETURNS TABLE(class_id uuid, ...) implicitly creates a plpgsql variable
  -- named class_id, which a bare ON CONFLICT column list collides with
  -- ("ambiguous... PL/pgSQL variable or a table column").
  insert into public.class_members (class_id, student_id, student_email, student_display_name)
  values (target.id, auth.uid(), me.email, me.display_name)
  on conflict on constraint class_members_pkey do update
    set student_email = excluded.student_email, student_display_name = excluded.student_display_name;

  return query select target.id, target.name;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default, which would
-- make this callable by the unauthenticated anon role too. Restrict it.
revoke execute on function public.join_class_by_code(text) from public;
grant execute on function public.join_class_by_code(text) to authenticated;

-- Additive and read-only: this is a second, independent policy - Postgres
-- OR's multiple permissive policies for the same command together, so this
-- does NOT loosen or replace "select own maps" above. Lets a teacher view
-- (never edit/delete) maps owned by students in their own class(es).
create policy "teachers view their students maps" on public.maps
  for select to authenticated
  using (
    owner_id in (
      select cm.student_id from public.class_members cm
      join public.classes c on c.id = cm.class_id
      where c.teacher_id = auth.uid()
    )
  );

-- ============================================================
-- Beta: classwide gap analysis - "what has the teacher taught?"
-- ============================================================
-- Flat array of "grade::unit::topic" strings the teacher has marked as
-- taught, so Class Insights can distinguish "prereq genuinely missing" from
-- "prereq just hasn't been taught yet" (see computeMissingPrereqs in
-- static/dashboard.js). No column-level restriction - same pattern as the
-- maps.update policy below, which also allows updating a full row rather
-- than restricting to specific columns.
alter table public.classes add column if not exists taught_topics jsonb not null default '[]'::jsonb;

-- classes had no UPDATE policy at all before this - teachers could create
-- and read classes, but not modify them.
create policy "teachers update own classes" on public.classes
  for update to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- ============================================================
-- Beta: map timeline - group existing saved maps (e.g. "Oct 4", "Oct 18")
-- into a named sequence, scrub between them with a slider.
-- ============================================================
create table public.map_timelines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  created_at timestamptz not null default now()
);
create index on public.map_timelines(owner_id);
alter table public.map_timelines enable row level security;

create policy "select own timelines" on public.map_timelines
  for select to authenticated using (owner_id = auth.uid());
create policy "insert own timelines" on public.map_timelines
  for insert to authenticated with check (owner_id = auth.uid());
create policy "delete own timelines" on public.map_timelines
  for delete to authenticated using (owner_id = auth.uid());

-- Nullable, on delete set null: deleting a timeline ungroups its maps
-- rather than deleting them - the maps are the student's real saved work,
-- the timeline is just a label grouping some of them together.
alter table public.maps add column if not exists timeline_id uuid references public.map_timelines(id) on delete set null;
-- maps already has an owner-scoped, non-column-restricted UPDATE policy
-- ("update own maps"), so setting timeline_id needs no new maps policy.

-- ============================================================
-- DEMO-ONLY, TEMPORARY: self-serve "become a teacher."
-- ============================================================
-- !! Intentionally ungated - ANY authenticated user can call this and
-- immediately become a teacher (gaining read access to every one of their
-- students' maps once they create/join a class). This is acceptable ONLY
-- because this deployment is a demo with no real student data at stake.
-- TODO before any real usage: replace with a real gate (an invite/signup
-- code checked inside this function, or move promotion to an admin-only
-- flow) - see TODO.md's "Auth & roles" section, which tracks this
-- explicitly so it doesn't get forgotten.
create or replace function public.claim_teacher_role()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update auth.users
  set raw_app_meta_data = raw_app_meta_data || '{"role":"teacher"}'::jsonb
  where id = auth.uid();
end;
$$;

revoke execute on function public.claim_teacher_role() from public;
grant execute on function public.claim_teacher_role() to authenticated;
