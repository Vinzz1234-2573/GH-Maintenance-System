-- =====================================================================
-- Gentle Hill Daily Equipment Maintenance System
-- sql/auth/99-rollback-lockdown.sql — undo sql/auth/02-lockdown.sql ONLY
-- =====================================================================
-- !! THIS RE-OPENS THE DATABASE. !!  Every table and the task-photos
-- bucket go back to "anyone with the public key can read and write
-- everything". Only use it while the OLD name-only (localStorage) app is
-- what is deployed — e.g. an emergency revert during the cutover.
-- Run 02-lockdown.sql again as soon as the new app is back.
--
-- Reverses 02 only: 01-additive.sql (auth_user_id/email columns, helper
-- functions, signup triggers) stays in place — it is harmless to the old
-- app. Idempotent.
-- =====================================================================

begin;

-- 1. Remove the strict policies and the update trigger.
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

drop trigger if exists task_occurrences_guard_update on public.task_occurrences;
drop function if exists public.guard_task_occurrence_update();

-- 2. Restore the old permissive policies (same as sql/schema.sql).
alter table public.users             enable row level security;
alter table public.equipment         enable row level security;
alter table public.maintenance_tasks enable row level security;
alter table public.task_occurrences  enable row level security;
alter table public.task_photos       enable row level security;

create policy "anon full access" on public.users for all using (true) with check (true);
create policy "anon full access" on public.equipment for all using (true) with check (true);
create policy "anon full access" on public.maintenance_tasks for all using (true) with check (true);
create policy "anon full access" on public.task_occurrences for all using (true) with check (true);
create policy "anon full access" on public.task_photos for all using (true) with check (true);

create policy "task-photos anon select" on storage.objects
  for select using (bucket_id = 'task-photos');
create policy "task-photos anon insert" on storage.objects
  for insert with check (bucket_id = 'task-photos');
create policy "task-photos anon delete" on storage.objects
  for delete using (bucket_id = 'task-photos');

-- 3. Give anon (and authenticated) their table privileges back — the
--    Supabase default for tables in public.
grant all on table public.users, public.equipment, public.maintenance_tasks,
  public.task_occurrences, public.task_photos to anon, authenticated;

commit;

notify pgrst, 'reload schema';
