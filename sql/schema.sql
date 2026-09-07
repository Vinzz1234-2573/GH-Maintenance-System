-- Gentle Hill Elder Care Centre — Daily Equipment Maintenance System
-- Run this in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Safe to re-run: every create/insert is idempotent.
--
-- This is intentionally a simple 3-table schema with a simple name-based
-- login (no passwords yet) — see the app's lib/session.js and
-- app/login/**/page.js for how that's structured to be swapped for real
-- Supabase Auth later without changing the table shapes.
--
-- If you're upgrading from an older version of this app that used
-- tasks / task_entries / checklist_submissions, those are unrelated to
-- this schema and safe to drop once you've exported anything you need:
--   drop table if exists task_entries;
--   drop table if exists checklist_submissions;
--   drop table if exists tasks;

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

create table if not exists maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references equipment (id) on delete set null,
  task_name text not null,
  description text,
  assigned_to uuid references users (id) on delete set null,
  status text not null default 'Pending' check (status in ('Pending', 'In Progress', 'Completed')),
  date date,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists maintenance_tasks_assigned_to_idx on maintenance_tasks (assigned_to);
create index if not exists maintenance_tasks_equipment_idx on maintenance_tasks (equipment_id);
create index if not exists maintenance_tasks_status_idx on maintenance_tasks (status);

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

drop policy if exists "anon full access" on users;
create policy "anon full access" on users for all using (true) with check (true);

drop policy if exists "anon full access" on equipment;
create policy "anon full access" on equipment for all using (true) with check (true);

drop policy if exists "anon full access" on maintenance_tasks;
create policy "anon full access" on maintenance_tasks for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- Sample data — safe to re-run (only inserts if not already present)
-- ---------------------------------------------------------------------

insert into users (name, role)
select 'Pavi', 'manager' where not exists (select 1 from users where name = 'Pavi');

insert into users (name, role)
select 'John', 'staff' where not exists (select 1 from users where name = 'John');

insert into users (name, role)
select 'Ali', 'staff' where not exists (select 1 from users where name = 'Ali');

insert into equipment (equipment_name, location)
select 'Water Pump', 'Basement' where not exists (select 1 from equipment where equipment_name = 'Water Pump');

insert into equipment (equipment_name, location)
select 'Air-Condition Unit', 'Level 2' where not exists (select 1 from equipment where equipment_name = 'Air-Condition Unit');

insert into equipment (equipment_name, location)
select 'Passenger Lift', 'Main Lobby' where not exists (select 1 from equipment where equipment_name = 'Passenger Lift');

insert into equipment (equipment_name, location)
select 'Kitchen Drainage', 'Kitchen' where not exists (select 1 from equipment where equipment_name = 'Kitchen Drainage');

-- Sample maintenance tasks, assigned to the sample staff above.
insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, date, remarks)
select e.id, 'Check water pump pressure', 'Check pressure, leakage, noise, vibration, motor condition', u.id, 'Pending', current_date, ''
from equipment e, users u
where e.equipment_name = 'Water Pump' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Check water pump pressure');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, date, remarks)
select e.id, 'Service air-conditioning', 'Operation, noise, vibration, compressor', u.id, 'In Progress', current_date, 'Ordered replacement filter'
from equipment e, users u
where e.equipment_name = 'Air-Condition Unit' and u.name = 'Ali'
and not exists (select 1 from maintenance_tasks where task_name = 'Service air-conditioning');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, date, remarks)
select e.id, 'Inspect passenger lift', 'Operation, noise, vibration, emergency phone', u.id, 'Completed', current_date - 1, 'All clear'
from equipment e, users u
where e.equipment_name = 'Passenger Lift' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Inspect passenger lift');
