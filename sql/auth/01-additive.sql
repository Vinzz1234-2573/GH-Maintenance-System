-- =====================================================================
-- Gentle Hill Daily Equipment Maintenance System
-- sql/auth/01-additive.sql — Supabase Auth, step 1 of 2: ADDITIVE ONLY
-- =====================================================================
-- Run in the Supabase SQL Editor AFTER sql/schema.sql.
--
-- This file only ADDS things (columns, functions, triggers on auth.users).
-- It does not touch any existing policy or grant, so it is SAFE TO RUN
-- WHILE THE OLD name-only app is still live. It is idempotent: re-running
-- it is harmless (and is how you change the allowed email domains, below).
--
-- The three files, in order:
--   01-additive.sql          (this file)  add auth linkage + helpers. Safe anytime.
--   02-lockdown.sql          strict RLS + revoke anon. BREAKS the old app.
--   99-rollback-lockdown.sql reverts 02 only (re-opens the database).
--
-- WARNING: the two triggers on auth.users below run on EVERY signup. A bug
-- in them blocks all signups ("Database error saving new user"). They are
-- deliberately tiny; if signups ever fail, check Logs -> Postgres first.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. users: link each profile row to a Supabase Auth account
-- ---------------------------------------------------------------------
-- auth_user_id : which login this profile belongs to (null = an old
--                name-only profile that nobody can log in as yet).
-- email        : the login email, lower-cased. Informational + used by
--                admin_link_account(); it is NOT trusted for access.
-- The role check ('manager' | 'staff') from schema.sql is kept as-is.
alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users (id) on delete set null,
  add column if not exists email text;

create unique index if not exists users_email_lower_key
  on public.users (lower(email)) where email is not null;

-- ---------------------------------------------------------------------
-- 2. Allowed email domains (company-only signups)
-- ---------------------------------------------------------------------
-- HOW TO EDIT: change the array below and re-run just this statement
-- (create or replace). Examples:
--   array['gentlehill.my']                   -- default: company only
--   array['gentlehill.my', 'gentlehill.com'] -- several domains
--   array[]::text[]                          -- empty = NO restriction (anyone can sign up)
-- Matching is case-insensitive and exact: "x@mail.gentlehill.my" does NOT
-- match "gentlehill.my".
create or replace function public.allowed_email_domains()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['gentlehill.my']::text[]
$$;

-- BEFORE INSERT on auth.users: reject signups from other domains. The
-- exception text is what the app maps to a friendly message. (Supabase
-- Auth may show only "Database error saving new user" for it — the app
-- handles both.) With the restriction active, an account without an email
-- (anonymous / phone signups) is rejected too.
create or replace function public.enforce_allowed_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domains text[] := public.allowed_email_domains();
  v_domain  text;
begin
  if coalesce(array_length(v_domains, 1), 0) = 0 then
    return new; -- restriction disabled
  end if;

  -- Domain = everything after the LAST '@', so a crafted address such as
  -- '"a@gentlehill.my"@evil.com' can't slip through.
  v_domain := lower(substring(btrim(coalesce(new.email, '')) from '@([^@]*)$'));

  if v_domain is null or v_domain = '' or not exists (
    select 1 from unnest(v_domains) as d where lower(d) = v_domain
  ) then
    raise exception 'Signups are limited to company email addresses';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_check_domain on auth.users;
create trigger on_auth_user_check_domain
  before insert on auth.users
  for each row execute function public.enforce_allowed_email_domain();

-- ---------------------------------------------------------------------
-- 3. New account -> new profile row (always role 'staff')
-- ---------------------------------------------------------------------
-- SECURITY DECISION: a new account is NEVER linked to an existing users row
-- by matching the email. Emails are unverified (Confirm email is OFF), so
-- anyone could otherwise claim the Manager's row by signing up with the
-- Manager's address. Linking existing people is a manual admin action:
-- see admin_link_account() below. Roles are only changed by the admin
-- (Table Editor -> users.role).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(new.email, ''))), '');
begin
  -- A profile whose login was deleted earlier keeps its email (auth_user_id
  -- was set to null). Free that address so the unique index doesn't block
  -- this signup. This does NOT link anything: the new account gets a fresh
  -- staff row, and the admin can re-link the old one with admin_link_account().
  if v_email is not null then
    update public.users set email = null
    where lower(email) = v_email and auth_user_id is null;
  end if;

  insert into public.users (name, role, auth_user_id, email)
  values (
    coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'user'),
    'staff',
    new.id,
    v_email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The trigger functions are only ever fired by the triggers (Postgres
-- checks EXECUTE when a trigger is created, not when it fires), so nobody
-- needs to be able to call them directly.
revoke execute on function public.enforce_allowed_email_domain() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Helpers used by the RLS policies in 02-lockdown.sql
-- ---------------------------------------------------------------------
-- All SECURITY DEFINER (they read tables the caller may not be allowed to
-- read, without recursing into RLS), STABLE, and search_path = '' so
-- nothing can be hijacked through a user-created schema object.

-- users.id of the logged-in person (NOT the auth uid), or null.
create or replace function public.current_user_row_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from public.users u where u.auth_user_id = auth.uid() limit 1
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.role = 'manager'
  )
$$;

-- Is this maintenance task assigned to the logged-in person?
create or replace function public.owns_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.maintenance_tasks t
    where t.id = p_task_id
      and t.assigned_to is not null
      and t.assigned_to = public.current_user_row_id()
  )
$$;

-- Does this occurrence belong to a task assigned to the logged-in person?
create or replace function public.owns_occurrence(p_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_occurrences o
    join public.maintenance_tasks t on t.id = o.task_id
    where o.id = p_occurrence_id
      and t.assigned_to is not null
      and t.assigned_to = public.current_user_row_id()
  )
$$;

-- Same, and the occurrence is still in a state staff may change (photos
-- can be added / removed). Once submitted (Awaiting Review) or approved
-- (Completed) it is locked.
create or replace function public.owns_editable_occurrence(p_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_occurrences o
    join public.maintenance_tasks t on t.id = o.task_id
    where o.id = p_occurrence_id
      and o.status in ('Pending', 'In Progress', 'Rejected')
      and t.assigned_to is not null
      and t.assigned_to = public.current_user_row_id()
  )
$$;

-- Safe uuid cast for Storage paths ('{occurrence_id}/{file}.jpg'): returns
-- null instead of raising when a folder name isn't a uuid, so a malformed
-- path just fails the policy instead of erroring the whole request.
create or replace function public.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- Only logged-in users call these (from policies). Not anon, not public.
revoke execute on function
  public.current_user_row_id(), public.is_manager(), public.owns_task(uuid),
  public.owns_occurrence(uuid), public.owns_editable_occurrence(uuid), public.try_uuid(text)
  from public, anon;
grant execute on function
  public.current_user_row_id(), public.is_manager(), public.owns_task(uuid),
  public.owns_occurrence(uuid), public.owns_editable_occurrence(uuid), public.try_uuid(text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 5. admin_link_account — attach a login to an EXISTING person
-- ---------------------------------------------------------------------
-- For SQL-Editor use only (execute is revoked from every client role).
--
-- Why it exists: people who already have a users row (with tasks assigned,
-- reviewed_by history, a Manager role...) get a NEW, duplicate row when
-- they sign up. This function merges the two safely:
--   * moves the login (auth_user_id + email) from the duplicate onto the
--     existing row p_old_user_id (which must not have a login yet),
--   * re-points maintenance_tasks.assigned_to and task_occurrences.reviewed_by
--     from the duplicate to the existing row,
--   * deletes the duplicate,
--   * keeps the existing row's id, name and role.
-- Everything happens in one transaction; any problem raises a clear error
-- and changes nothing.
--
-- Usage (SQL Editor):
--   1. The person signs up in the app with their company email.
--   2. Find their OLD row (the one with auth_user_id empty):
--        select id, name, role, email, auth_user_id from public.users order by name;
--   3. Link them:
--        -- Zul's existing row (his assigned tasks keep working):
--        select public.admin_link_account('<Zul old users.id>', 'zul@gentlehill.my');
--        -- Pavi's existing row, so Pavi stays a Manager (role is kept from the old row):
--        select public.admin_link_account('<Pavi old users.id>', 'pavi@gentlehill.my');
create or replace function public.admin_link_account(p_old_user_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_old     public.users%rowtype;
  v_new     public.users%rowtype;
  v_tasks   int;
  v_reviews int;
begin
  if p_old_user_id is null then
    raise exception 'p_old_user_id is required (the id of the existing users row)';
  end if;
  if v_email = '' then
    raise exception 'p_email is required (the email the person signed up with)';
  end if;

  select * into v_old from public.users where id = p_old_user_id for update;
  if not found then
    raise exception 'No users row with id %', p_old_user_id;
  end if;
  if v_old.auth_user_id is not null then
    raise exception 'users row "%" (%) already has a login (auth_user_id %); nothing to link',
      v_old.name, v_old.id, v_old.auth_user_id;
  end if;

  select * into v_new from public.users
  where lower(email) = v_email and auth_user_id is not null
  for update;
  if not found then
    raise exception 'No signed-up account found for "%". Ask them to sign up in the app first (company email), then run this again.', v_email;
  end if;

  -- Order matters. (1) Re-point references while the duplicate still
  -- exists, because deleting it would SET NULL on them. (2) Delete the
  -- duplicate, which frees its auth_user_id and email (both are UNIQUE).
  -- (3) Only then move them onto the existing row.
  update public.maintenance_tasks set assigned_to = v_old.id where assigned_to = v_new.id;
  get diagnostics v_tasks = row_count;
  update public.task_occurrences set reviewed_by = v_old.id where reviewed_by = v_new.id;
  get diagnostics v_reviews = row_count;

  delete from public.users where id = v_new.id;

  update public.users
  set auth_user_id = v_new.auth_user_id, email = v_new.email
  where id = v_old.id;

  return format('Linked %s to existing user "%s" (id %s, role %s). Moved %s task assignment(s) and %s review record(s); removed duplicate row %s.',
    v_new.email, v_old.name, v_old.id, v_old.role, v_tasks, v_reviews, v_new.id);
end;
$$;

revoke execute on function public.admin_link_account(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Bootstrapping the first Manager
-- ---------------------------------------------------------------------
-- New accounts are always 'staff'. To make the first Manager:
--   1. Sign up in the app with their company email (they land on /staff).
--   2. In the SQL Editor (or Table Editor -> users -> role):
--        update public.users set role = 'manager' where lower(email) = 'pavi@gentlehill.my';
--   3. They log out and back in -> /manager.
-- If that person already has an old row (tasks, review history), link it
-- first with admin_link_account() above, then set the role on that row.
-- Names are edited the same way (Table Editor -> users -> name).

commit;

notify pgrst, 'reload schema';
