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
  -- Daily checklist items (e.g. the preset equipment checks below) are
  -- marked is_daily = true: the app treats them as due again every day
  -- regardless of yesterday's status (see lib/data.js effectiveStatus).
  -- One-off tasks a manager creates for a specific repair stay false and
  -- keep whatever status they're given, with no daily reset.
  is_daily boolean not null default false,
  created_at timestamptz not null default now()
);
alter table maintenance_tasks add column if not exists is_daily boolean not null default false;

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
-- Maintenance Record", pre-loaded so the Manager never has to create
-- these by hand. Each is marked is_daily = true, split alternately
-- between the two sample staff — reassign them to real staff any time
-- from Task Management -> Edit.
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

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, is_daily)
select e.id, 'Toilet Fixtures', 'Flush, water leakage, tap, toilet seat, basin, exhaust fan', u.id, 'Pending', true
from equipment e, users u where e.equipment_name = 'Toilet Fixtures' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Toilet Fixtures');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, is_daily)
select e.id, 'Air-condition & Fan', 'Operation, noise, vibration, compressor', u.id, 'Pending', true
from equipment e, users u where e.equipment_name = 'Air-condition & Fan' and u.name = 'Ali'
and not exists (select 1 from maintenance_tasks where task_name = 'Air-condition & Fan');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, is_daily)
select e.id, 'Water Pump', 'Pressure, leakage, noise, vibration, motor condition', u.id, 'Pending', true
from equipment e, users u where e.equipment_name = 'Water Pump' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Water Pump');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, is_daily)
select e.id, 'Kitchen & Drainage', 'Pump operation, water level, leakage, alarm, water flow, blockage, smell', u.id, 'Pending', true
from equipment e, users u where e.equipment_name = 'Kitchen & Drainage' and u.name = 'Ali'
and not exists (select 1 from maintenance_tasks where task_name = 'Kitchen & Drainage');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, is_daily)
select e.id, 'Lift & Cargo Lift', 'Operation, noise, vibration, compressor', u.id, 'Pending', true
from equipment e, users u where e.equipment_name = 'Lift & Cargo Lift' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Lift & Cargo Lift');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, is_daily)
select e.id, 'Lighting', 'Bulbs lighting', u.id, 'Pending', true
from equipment e, users u where e.equipment_name = 'Lighting' and u.name = 'Ali'
and not exists (select 1 from maintenance_tasks where task_name = 'Lighting');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, is_daily)
select e.id, 'Flooring & Ceiling', 'Broken / damaged sections', u.id, 'Pending', true
from equipment e, users u where e.equipment_name = 'Flooring & Ceiling' and u.name = 'John'
and not exists (select 1 from maintenance_tasks where task_name = 'Flooring & Ceiling');

insert into maintenance_tasks (equipment_id, task_name, description, assigned_to, status, is_daily)
select e.id, 'Equipment (Chairs, Tables, Beds, Windows, Cabinets)', 'Chairs, tables, beds, windows, cabinets', u.id, 'Pending', true
from equipment e, users u where e.equipment_name = 'Equipment (Chairs, Tables, Beds, Windows, Cabinets)' and u.name = 'Ali'
and not exists (select 1 from maintenance_tasks where task_name = 'Equipment (Chairs, Tables, Beds, Windows, Cabinets)');
