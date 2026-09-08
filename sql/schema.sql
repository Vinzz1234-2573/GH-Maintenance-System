-- Gentle Hill Elder Care Centre — Daily Equipment Maintenance System
-- Run this in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Safe to re-run: every create/insert is idempotent.
--
-- Two-table model for tasks:
--   maintenance_tasks  — the recurring SCHEDULE a manager defines once
--                        (equipment, description, who it's assigned to,
--                        frequency, enabled/disabled).
--   task_occurrences   — one row per calendar date a task is actually due.
--                        The app generates these lazily (see lib/data.js
--                        ensureOccurrences) whenever a dashboard is opened
--                        for a date range — there is no server/cron here,
--                        so "the next occurrence appears automatically"
--                        means "the next time anyone opens a dashboard on
--                        or after that date", which in practice is every
--                        shift. This keeps the system serverless and the
--                        schema simple, at the cost of no background job.
--
-- If you already ran an earlier version of this file, this script
-- upgrades the existing maintenance_tasks table in place — adding the
-- frequency/weekly_days/monthly_day/start_date/enabled columns it needs
-- and dropping the old status/date/remarks/is_daily columns it no
-- longer uses — rather than requiring you to drop and recreate anything.
-- Just re-run the whole file.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('manager', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  equipment_name text not null,
  location text,
  created_at timestamptz not null default now()
);

-- The recurring schedule — what to check, on what equipment, assigned to
-- whom, and how often. Manager-only to create/edit/enable/disable.
create table if not exists maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references equipment (id) on delete set null,
  task_name text not null,
  description text,
  assigned_to uuid references users (id) on delete set null,
  frequency text not null default 'once' check (frequency in ('once', 'daily', 'weekly', 'monthly')),
  weekly_days int[] not null default '{}',   -- ISO weekday numbers, Mon=1..Sun=7 (frequency = 'weekly')
  monthly_day int,                            -- day of month, 1-31, clamped to month length (frequency = 'monthly')
  start_date date not null default current_date, -- also the single due date when frequency = 'once'
  due_time text,                              -- optional 'HH:MM' 24h, shown on staff task cards
  enabled boolean not null default true,      -- manager enable/disable — disabled tasks stop generating occurrences
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Self-healing for a table that already existed from an earlier version
-- of this script (e.g. one with status/date/remarks/is_daily columns,
-- or simply missing a column added since): "create table if not exists"
-- above is a no-op once the table exists, so these add whatever this
-- version needs and drop whatever it no longer uses. Safe to re-run.
alter table maintenance_tasks add column if not exists frequency text not null default 'once';
alter table maintenance_tasks add column if not exists weekly_days int[] not null default '{}';
alter table maintenance_tasks add column if not exists monthly_day int;
alter table maintenance_tasks add column if not exists start_date date not null default current_date;
alter table maintenance_tasks add column if not exists enabled boolean not null default true;
alter table maintenance_tasks add column if not exists due_time text;
alter table maintenance_tasks add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'maintenance_tasks_frequency_check'
  ) then
    alter table maintenance_tasks add constraint maintenance_tasks_frequency_check
      check (frequency in ('once', 'daily', 'weekly', 'monthly'));
  end if;
end $$;
alter table maintenance_tasks drop column if exists status;
alter table maintenance_tasks drop column if exists date;
alter table maintenance_tasks drop column if exists remarks;
alter table maintenance_tasks drop column if exists is_daily;

create index if not exists maintenance_tasks_assigned_to_idx on maintenance_tasks (assigned_to);
create index if not exists maintenance_tasks_equipment_idx on maintenance_tasks (equipment_id);
create index if not exists maintenance_tasks_enabled_idx on maintenance_tasks (enabled);

-- One row per calendar date a task is due. This is what staff actually
-- see and check off; maintenance_tasks above never gets a "status".
create table if not exists task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references maintenance_tasks (id) on delete cascade,
  due_date date not null,
  status text not null default 'Pending' check (status in ('Pending', 'In Progress', 'Completed')),
  remarks text,
  photo_url text, -- optional evidence photo, uploaded to the 'task-photos' storage bucket below
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, due_date)
);
alter table task_occurrences add column if not exists photo_url text;

create index if not exists task_occurrences_due_date_idx on task_occurrences (due_date);
create index if not exists task_occurrences_task_idx on task_occurrences (task_id);
create index if not exists task_occurrences_status_idx on task_occurrences (status);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
-- There's no real authentication yet (login is just "enter your name"),
-- so the app talks to Supabase with the public anon key. These policies
-- are deliberately permissive — anyone with the anon key can read/write —
-- which matches "simple for now" but is NOT meant to stay this open once
-- you add real Supabase Auth. At that point, tighten these to check
-- auth.uid() against the users table instead of allowing anon access.

alter table users enable row level security;
alter table equipment enable row level security;
alter table maintenance_tasks enable row level security;
alter table task_occurrences enable row level security;

drop policy if exists "anon full access" on users;
create policy "anon full access" on users for all using (true) with check (true);

drop policy if exists "anon full access" on equipment;
create policy "anon full access" on equipment for all using (true) with check (true);

drop policy if exists "anon full access" on maintenance_tasks;
create policy "anon full access" on maintenance_tasks for all using (true) with check (true);

drop policy if exists "anon full access" on task_occurrences;
create policy "anon full access" on task_occurrences for all using (true) with check (true);

-- Storage bucket for the optional "photo evidence" a staff member can
-- attach when updating a task. Same permissive stance as the tables
-- above — public bucket, anon can upload/read — for the same reason:
-- no real auth exists yet to scope it to.
insert into storage.buckets (id, name, public)
values ('task-photos', 'task-photos', true)
on conflict (id) do nothing;

drop policy if exists "anon full access task-photos" on storage.objects;
create policy "anon full access task-photos" on storage.objects
  for all using (bucket_id = 'task-photos') with check (bucket_id = 'task-photos');

-- ---------------------------------------------------------------------
-- Sample users — safe to re-run (only inserts if not already present)
-- ---------------------------------------------------------------------

insert into users (name, role)
select 'Pavi', 'manager' where not exists (select 1 from users where name = 'Pavi');

insert into users (name, role)
select 'John', 'staff' where not exists (select 1 from users where name = 'John');

insert into users (name, role)
select 'Ali', 'staff' where not exists (select 1 from users where name = 'Ali');

-- ---------------------------------------------------------------------
-- Preset daily checklist — the 8 items from "Daily Equipment
-- Maintenance Record", pre-loaded as daily-recurring tasks so the
-- Manager never has to create them by hand. Split alternately between
-- the two sample staff — reassign to real staff any time from
-- Maintenance Tasks -> Edit. Today's occurrence is seeded directly so
-- the checklist shows up immediately even before the app has run once.
-- ---------------------------------------------------------------------

insert into equipment (equipment_name)
select 'Toilet Fixtures' where not exists (select 1 from equipment where equipment_name = 'Toilet Fixtures');
insert into equipment (equipment_name)
select 'Air-condition & Fan' where not exists (select 1 from equipment where equipment_name = 'Air-condition & Fan');
insert into equipment (equipment_name)
select 'Water Pump' where not exists (select 1 from equipment where equipment_name = 'Water Pump');
insert into equipment (equipment_name)
select 'Kitchen & Drainage' where not exists (select 1 from equipment where equipment_name = 'Kitchen & Drainage');
insert into equipment (equipment_name)
select 'Lift & Cargo Lift' where not exists (select 1 from equipment where equipment_name = 'Lift & Cargo Lift');
insert into equipment (equipment_name)
select 'Lighting' where not exists (select 1 from equipment where equipment_name = 'Lighting');
insert into equipment (equipment_name)
select 'Flooring & Ceiling' where not exists (select 1 from equipment where equipment_name = 'Flooring & Ceiling');
insert into equipment (equipment_name)
select 'Equipment (Chairs, Tables, Beds, Windows, Cabinets)' where not exists (select 1 from equipment where equipment_name = 'Equipment (Chairs, Tables, Beds, Windows, Cabinets)');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, frequency)
select e.id, 'Toilet Fixtures', 'Flush, water leakage, tap, toilet seat, basin, exhaust fan', u.id, 'daily'
from equipment e, users u where e.equipment_name = 'Toilet Fixtures' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Toilet Fixtures');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, frequency)
select e.id, 'Air-condition & Fan', 'Operation, noise, vibration, compressor', u.id, 'daily'
from equipment e, users u where e.equipment_name = 'Air-condition & Fan' and u.name = 'Ali'
and not exists (select 1 from maintenance_tasks where task_name = 'Air-condition & Fan');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, frequency)
select e.id, 'Water Pump', 'Pressure, leakage, noise, vibration, motor condition', u.id, 'daily'
from equipment e, users u where e.equipment_name = 'Water Pump' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Water Pump');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, frequency)
select e.id, 'Kitchen & Drainage', 'Pump operation, water level, leakage, alarm, water flow, blockage, smell', u.id, 'daily'
from equipment e, users u where e.equipment_name = 'Kitchen & Drainage' and u.name = 'Ali'
and not exists (select 1 from maintenance_tasks where task_name = 'Kitchen & Drainage');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, frequency)
select e.id, 'Lift & Cargo Lift', 'Operation, noise, vibration, compressor', u.id, 'daily'
from equipment e, users u where e.equipment_name = 'Lift & Cargo Lift' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Lift & Cargo Lift');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, frequency)
select e.id, 'Lighting', 'Bulbs lighting', u.id, 'daily'
from equipment e, users u where e.equipment_name = 'Lighting' and u.name = 'Ali'
and not exists (select 1 from maintenance_tasks where task_name = 'Lighting');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, frequency)
select e.id, 'Flooring & Ceiling', 'Broken / damaged sections', u.id, 'daily'
from equipment e, users u where e.equipment_name = 'Flooring & Ceiling' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Flooring & Ceiling');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, frequency)
select e.id, 'Equipment (Chairs, Tables, Beds, Windows, Cabinets)', 'Chairs, tables, beds, windows, cabinets', u.id, 'daily'
from equipment e, users u where e.equipment_name = 'Equipment (Chairs, Tables, Beds, Windows, Cabinets)' and u.name = 'Ali'
and not exists (select 1 from maintenance_tasks where task_name = 'Equipment (Chairs, Tables, Beds, Windows, Cabinets)');

-- Seed today's occurrence for every preset task so the checklist isn't
-- empty even before the app has generated anything itself.
insert into task_occurrences (task_id, due_date)
select t.id, current_date
from maintenance_tasks t
where t.task_name in (
  'Toilet Fixtures', 'Air-condition & Fan', 'Water Pump', 'Kitchen & Drainage',
  'Lift & Cargo Lift', 'Lighting', 'Flooring & Ceiling',
  'Equipment (Chairs, Tables, Beds, Windows, Cabinets)'
)
and not exists (
  select 1 from task_occurrences o where o.task_id = t.id and o.due_date = current_date
);

-- ---------------------------------------------------------------------
-- Force PostgREST to pick up the schema changes above immediately,
-- instead of waiting for its own auto-refresh. If you still see a
-- "Could not find column X in schema cache" error from the app right
-- after running this script, it means the reload hasn't landed yet —
-- wait ~10 seconds and retry, or reload manually from the Supabase
-- Dashboard: Project Settings -> API -> "Reload schema cache".
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
