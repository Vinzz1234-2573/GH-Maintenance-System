-- =====================================================================
-- Gentle Hill Daily Equipment Maintenance System
-- sql/auth/02-lockdown.sql — Supabase Auth, step 2 of 2: LOCK THE DATABASE DOWN
-- =====================================================================
-- !! THIS BREAKS THE OLD name-only app. !!  Run it only when the NEW
-- (email + password) app is what is deployed, and after everyone has
-- signed up and been linked (see README "Production cutover plan").
-- Needs sql/auth/01-additive.sql to have been run first.
-- Idempotent. To undo: sql/auth/99-rollback-lockdown.sql.
--
-- !! After this file has been run, NEVER re-run sql/schema.sql on its own:
-- !! it re-creates the permissive "anon full access" policies, which would
-- !! give every logged-in user full access again. If you must re-run it,
-- !! run this file again straight afterwards.
--
-- What it does
--   * anon (not logged in) loses all access to the app tables.
--   * authenticated gets only the privileges the policies below use.
--   * Every old permissive policy on the app tables and on the task-photos
--     bucket is dropped; strict, role-based policies replace them.
--   * A BEFORE UPDATE trigger on task_occurrences protects columns that RLS
--     cannot (who reviewed, when, review note, ...).
--
-- Roles (public.users.role): 'manager' can do everything; 'staff' can only
-- touch tasks assigned to them, and only until they submit.
--
-- One deliberate difference from a literal reading of "staff may set the
-- new status to Pending / In Progress / Awaiting Review": the policy also
-- allows the new status 'Rejected', because a staff member saving remarks
-- on a "Needs Correction" task leaves the status at 'Rejected' (the app's
-- saveProgress does exactly that). A WITH CHECK can't see the old row, so
-- the trigger below enforces the real rule: staff can never CHANGE a row's
-- status INTO 'Rejected' or 'Completed'.
-- =====================================================================

begin;

-- 0. Refuse to run without 01 (the policies below depend on its helpers).
do $$
begin
  if to_regprocedure('public.is_manager()') is null
     or to_regprocedure('public.owns_task(uuid)') is null
     or to_regprocedure('public.owns_occurrence(uuid)') is null
     or to_regprocedure('public.owns_editable_occurrence(uuid)') is null
     or to_regprocedure('public.try_uuid(text)') is null
     or to_regprocedure('public.current_user_row_id()') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'users' and column_name = 'auth_user_id'
     )
  then
    raise exception 'Run sql/auth/01-additive.sql first — the helper functions / users.auth_user_id are missing.';
  end if;
end $$;

alter table public.users             enable row level security;
alter table public.equipment         enable row level security;
alter table public.maintenance_tasks enable row level security;
alter table public.task_occurrences  enable row level security;
alter table public.task_photos       enable row level security;

-- ---------------------------------------------------------------------
-- 1. Privileges
-- ---------------------------------------------------------------------
-- (There are no sequences — every id is a uuid — but be safe.)
revoke all on table public.users, public.equipment, public.maintenance_tasks,
  public.task_occurrences, public.task_photos from anon;
revoke all on all sequences in schema public from anon;

-- Reset authenticated, then grant back only what the policies use. users is
-- read-only for clients: names/roles are edited by the admin in the
-- dashboard, and rows are created by the signup trigger.
revoke all on table public.users, public.equipment, public.maintenance_tasks,
  public.task_occurrences, public.task_photos from authenticated;
grant select on public.users to authenticated;
grant select, insert, update, delete on public.equipment, public.maintenance_tasks,
  public.task_occurrences to authenticated;
grant select, insert, delete on public.task_photos to authenticated;   -- no update

-- ---------------------------------------------------------------------
-- 2. Drop every existing policy, then create the strict ones
-- ---------------------------------------------------------------------
-- All policies on the app tables are removed (not just "anon full access"),
-- so a stray permissive policy can't silently defeat the lockdown.
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('users', 'equipment', 'maintenance_tasks', 'task_occurrences', 'task_photos')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;

  -- Storage: the temporary task-photos policies from schema.sql (and any
  -- other policy on storage.objects that targets this bucket).
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname in (
             'anon full access task-photos', 'task-photos anon select',
             'task-photos anon insert', 'task-photos anon delete')
           or coalesce(qual, '') ilike '%task-photos%'
           or coalesce(with_check, '') ilike '%task-photos%')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- ---- users: read own row, or everything if manager. No client writes. ----
create policy "users select own or manager" on public.users
  for select to authenticated
  using (auth_user_id = (select auth.uid()) or (select public.is_manager()));

-- ---- equipment: everyone logged in may read; only managers write ----
create policy "equipment select" on public.equipment
  for select to authenticated using (true);
create policy "equipment insert manager" on public.equipment
  for insert to authenticated with check ((select public.is_manager()));
create policy "equipment update manager" on public.equipment
  for update to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "equipment delete manager" on public.equipment
  for delete to authenticated using ((select public.is_manager()));

-- ---- maintenance_tasks: manager sees all; staff only their own ----
create policy "tasks select manager or assignee" on public.maintenance_tasks
  for select to authenticated
  using ((select public.is_manager()) or assigned_to = (select public.current_user_row_id()));
create policy "tasks insert manager" on public.maintenance_tasks
  for insert to authenticated with check ((select public.is_manager()));
create policy "tasks update manager" on public.maintenance_tasks
  for update to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "tasks delete manager" on public.maintenance_tasks
  for delete to authenticated using ((select public.is_manager()));

-- ---- task_occurrences ----
create policy "occurrences select manager or owner" on public.task_occurrences
  for select to authenticated
  using ((select public.is_manager()) or public.owns_task(task_id));

-- The dashboards lazily create each day's row, so staff may insert their
-- own tasks' rows — but only a blank Pending one (no review data).
create policy "occurrences insert manager or owner" on public.task_occurrences
  for insert to authenticated
  with check (
    (select public.is_manager())
    or (
      public.owns_task(task_id)
      and status = 'Pending'
      and completed_at is null and submitted_at is null and reviewed_at is null
      and reviewed_by is null and review_note is null
      and rejection_count = 0 and photos_purged_at is null
    )
  );

-- Staff: only while the existing row is still theirs to edit, and only to a
-- status they may set. (Locked once Awaiting Review / Completed.)
create policy "occurrences update manager or owner" on public.task_occurrences
  for update to authenticated
  using (
    (select public.is_manager())
    or (public.owns_task(task_id) and status in ('Pending', 'In Progress', 'Rejected'))
  )
  with check (
    (select public.is_manager())
    or (public.owns_task(task_id) and status in ('Pending', 'In Progress', 'Awaiting Review', 'Rejected'))
  );

create policy "occurrences delete manager" on public.task_occurrences
  for delete to authenticated using ((select public.is_manager()));

-- ---- task_photos ----
create policy "photos select manager or owner" on public.task_photos
  for select to authenticated
  using ((select public.is_manager()) or public.owns_occurrence(occurrence_id));
create policy "photos insert manager or editable owner" on public.task_photos
  for insert to authenticated
  with check ((select public.is_manager()) or public.owns_editable_occurrence(occurrence_id));
create policy "photos delete manager or editable owner" on public.task_photos
  for delete to authenticated
  using ((select public.is_manager()) or public.owns_editable_occurrence(occurrence_id));

-- ---- Storage: bucket 'task-photos', path '{occurrence_id}/{uuid}.jpg' ----
-- The bucket stays private. try_uuid() turns a non-uuid folder name into
-- null, which owns_*() treats as "not yours".
create policy "task-photos select manager or owner" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-photos'
    and ((select public.is_manager())
         or public.owns_occurrence(public.try_uuid((storage.foldername(name))[1])))
  );
create policy "task-photos insert manager or editable owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-photos'
    and ((select public.is_manager())
         or public.owns_editable_occurrence(public.try_uuid((storage.foldername(name))[1])))
  );
create policy "task-photos delete manager or editable owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-photos'
    and ((select public.is_manager())
         or public.owns_editable_occurrence(public.try_uuid((storage.foldername(name))[1])))
  );

-- ---------------------------------------------------------------------
-- 3. Column protection RLS can't express: BEFORE UPDATE trigger
-- ---------------------------------------------------------------------
-- Skipped when there is no logged-in end user (auth.uid() is null: the SQL
-- Editor, the service role, admin_link_account(), FK "set null" actions).
-- After the privileges above, anon can't reach this table at all.
create or replace function public.guard_task_occurrence_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_manager() then
    if new.id is distinct from old.id
       or new.task_id is distinct from old.task_id
       or new.due_date is distinct from old.due_date
       or new.created_at is distinct from old.created_at
       or new.completed_at is distinct from old.completed_at
       or new.reviewed_at is distinct from old.reviewed_at
       or new.reviewed_by is distinct from old.reviewed_by
       or new.review_note is distinct from old.review_note
       or new.rejection_count is distinct from old.rejection_count
       or new.photos_purged_at is distinct from old.photos_purged_at
    then
      raise exception 'Staff cannot change task, due date, review or completion fields'
        using errcode = '42501';
    end if;

    -- Staff may keep a Rejected row Rejected (saving remarks) but never
    -- move a row INTO Rejected or Completed — only a Manager review does.
    if new.status is distinct from old.status and new.status in ('Rejected', 'Completed') then
      raise exception 'Only a Manager can set a task to %', new.status
        using errcode = '42501';
    end if;

    -- submitted_at is set below when submitting; otherwise it is untouchable.
    if new.submitted_at is distinct from old.submitted_at and new.status <> 'Awaiting Review' then
      raise exception 'Staff cannot change submitted_at' using errcode = '42501';
    end if;
  end if;

  -- For everyone: the reviewer is whoever is actually logged in, never a
  -- value the client sent.
  if new.reviewed_by is distinct from old.reviewed_by then
    new.reviewed_by := public.current_user_row_id();
  end if;

  -- Submission time is the server's clock, not the browser's.
  if new.status = 'Awaiting Review' and old.status is distinct from 'Awaiting Review' then
    new.submitted_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_task_occurrence_update() from public, anon, authenticated;

drop trigger if exists task_occurrences_guard_update on public.task_occurrences;
create trigger task_occurrences_guard_update
  before update on public.task_occurrences
  for each row execute function public.guard_task_occurrence_update();

commit;

notify pgrst, 'reload schema';
