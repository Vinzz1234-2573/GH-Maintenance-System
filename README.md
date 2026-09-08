# Gentle Hill — Daily Equipment Maintenance System

A simple maintenance tracking system for **Gentle Hill Elder Care Centre**
(gentlehill.my): a Manager creates equipment and maintenance tasks and
assigns them to Staff; Staff see only their own tasks and update status/
remarks. Login is name-only for now (no password), ready to be upgraded to
real Supabase Auth later.

- **Landing page** (`/`) — Gentle Hill branding + hero photo, with
  **Manager Login** and **Staff Login** buttons.
- **Manager** (`/manager`) — Dashboard (KPI cards + task list), Equipment
  (add/edit/delete), Maintenance Tasks (filterable list, edit/delete),
  Add New Task, plus **Back to Website** and **Login to ECMS** (external
  link to `https://ecms.gentlehill.my/login` — a separate system, this is
  just a shortcut).
- **Staff** (`/staff`) — only tasks assigned to them, grouped into
  Pending / In Progress / Completed, with a status dropdown, a quick
  "Mark Completed" button, and a remarks box.
- **Preset daily checklist** — the 8 items from `docs/Daily Equipment
  Maintenance Record.docx` (Toilet Fixtures, Air-condition & Fan, Water
  Pump, Kitchen & Drainage, Lift & Cargo Lift, Lighting, Flooring &
  Ceiling, Equipment) are seeded automatically by `sql/schema.sql` — the
  Manager never has to create these by hand, just reassign them to real
  staff. See "Daily checklist items" below for how the daily reset works.

It's a normal website — open it in Chrome, Edge, or Safari. Nothing to install.

## What caused the "Add New Task" error, and what I fixed

**The exact cause:** `.env.local` had a placeholder Supabase URL
(`https://YOUR-PROJECT-REF.supabase.co`) — not a real project. When the
Manager saved a task, the server tried to reach that fake host and Node's
`fetch` failed outright (`TypeError: fetch failed`) because the hostname
doesn't resolve to anything. It wasn't a bug in the form, the query, or the
field names — no Supabase project had ever actually been connected.

Beyond just explaining that, this rebuild also removes the failure mode
structurally:

- The app now talks to Supabase **directly from the browser** using the
  public anon key (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`),
  per your request — no more server-side API routes that could throw an
  opaque 500.
- Every data call (`lib/data.js`) checks `isSupabaseConfigured` first and
  returns a clear `{ error: { message: "Supabase is not connected yet...` }`
  instead of ever throwing, so a missing/placeholder connection shows a
  visible banner on the Dashboard and Add New Task page rather than a
  crash or a blank error.
- Real Supabase errors (bad column, RLS rejection, etc.) are surfaced as
  their actual `error.message` in a toast — e.g. "Maintenance task created
  successfully." on success, or the real Postgres/PostgREST message on
  failure — never a silent/blank failure.
- Empty states are handled explicitly everywhere data can legitimately be
  empty: no equipment yet, no tasks yet (Dashboard and Maintenance Tasks
  both show "No maintenance tasks have been created yet." with a
  **+ Add New Maintenance Task** button), and no tasks assigned to a staff
  member yet. Nothing indexes into an array without checking it first.

## 1. Create a free Supabase project

1. Go to https://supabase.com → sign up (free tier is enough)
2. Create a new project, wait ~2 min for it to spin up
3. Go to **SQL Editor → New query**, paste the contents of `sql/schema.sql`
   (below), click Run — this creates the 3 tables, enables RLS with
   permissive policies (see the note in that file), and inserts a sample
   manager, two sample staff, sample equipment, and sample tasks.
4. Go to **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** (not the service_role key) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

These are **public** client-side variables by design (that's what
`NEXT_PUBLIC_` means in Next.js) — that's fine because Row Level Security
policies, not secrecy of the key, are what's supposed to protect the data.
Right now those policies are wide open (`using (true)`) to match "keep it
simple for now" — see the note at the bottom of `sql/schema.sql` on
tightening them once you add real authentication.

## 2. Run it locally

```bash
npm install
cp .env.local.example .env.local
# paste in your NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

Open http://localhost:3000. Try:
- **Manager Login** → name `Pavi` → Dashboard shows the sample tasks.
- **Staff Login** → name `John` → sees only John's assigned tasks.
- Manager → **+ Add New Task** → create a task → "Maintenance task created successfully."

## 3. Deploy on Vercel

Add the same two environment variables in **Vercel → Project → Environment
Variables**, then deploy. No other server-side secrets are needed.

## Complete Supabase SQL

See [`sql/schema.sql`](sql/schema.sql) — copy its full contents into the
Supabase SQL Editor. Summary of what it creates:

```sql
users (id, name, role check ('manager'|'staff'), created_at)
equipment (id, equipment_name, location, created_at)
maintenance_tasks (
  id, equipment_id -> equipment.id, task_name, description,
  assigned_to -> users.id, status check ('Pending'|'In Progress'|'Completed'),
  date, remarks, is_daily, created_at
)
```

Plus: RLS enabled with a permissive "anon full access" policy on each
table, and idempotent sample data (safe to re-run — it only inserts rows
that don't already exist by name) — including the 8 preset daily
checklist tasks below.

## Daily checklist items (`is_daily`)

A maintenance task marked `is_daily = true` is treated as due again every
day, no matter what it was marked yesterday — this is what makes the 8
preset equipment checks behave like a real daily checklist instead of a
one-time to-do. The logic (`effectiveStatus()` in `lib/data.js`) is
purely a display-time rule, not a scheduled job:

- If `is_daily` is true and the task's stored `date` is before today, the
  app shows it as **Pending** everywhere (Staff page, Dashboard, task
  list) regardless of the stored `status`.
- The stored `status`/`date` only change when someone actually acts on
  the task — `markTaskStatus()` stamps `date = today` whenever staff
  update a task's status, so the next calendar day it resets automatically.
- One-off tasks a manager creates for a specific repair are left with
  `is_daily = false` by default and behave normally — completed stays
  completed, no daily reset.
- A manager can toggle "Repeats daily" on any task from Add/Edit — it's
  not limited to the 8 presets.

**Trade-off worth knowing:** this keeps the database to 3 tables as
requested, but it means there's no historical log of *previous* days'
completions for a daily task — only whatever the single row currently
says. If you later want an audit trail ("was the water pump checked on
the 3rd?"), that needs a separate log table recording one row per
task-per-day, which is a natural follow-up if it becomes important.

## Login flow (name-only, no password yet)

- `/login/manager` and `/login/staff` each ask for a name, look it up in
  `users` filtered by the expected `role`, and:
  - name not found at all → **"User not found. Please check your name and try again."**
  - name found but wrong role (e.g. a staff member on Manager Login) →
    **"This account does not have Manager access."**
  - name found with matching role → stores `{ id, name, role }` in
    `localStorage` (see `lib/session.js`) and redirects to the right dashboard.
- `app/manager/layout.js` and `app/staff/layout.js` each check that
  localStorage session on mount and bounce back to the matching login page
  if it's missing or the wrong role — so a staff member can't reach
  `/manager` by typing the URL, and vice versa.
- **This is not secure authentication** — it's exactly what you asked for
  ("very simple... no password for now"). `lib/session.js` is written as
  the single seam to swap in real Supabase Auth later: replace
  `getSession`/`setSession`/`clearSession` with `supabase.auth` calls, and
  every page that only ever calls `getSession()` keeps working unchanged.

## Files changed in this rewrite

Removed (old server-side task/checklist system): `app/api/**`,
`app/manager/**` (old dashboard/tasks/records/reports/settings),
`lib/auth.js`, `lib/analytics.js`, `lib/taskStatus.js`,
`components/useManagerData.js`.

Added/rewritten: `lib/supabaseClient.js` (browser anon client),
`lib/data.js` (all Supabase queries), `lib/session.js` (name-based
session), `sql/schema.sql` (new 3-table schema), `app/page.js` (landing
page), `app/login/manager/page.js`, `app/login/staff/page.js`,
`components/LoginForm.js`, `app/manager/layout.js`, `app/manager/page.js`
(Dashboard), `app/manager/equipment/page.js`, `app/manager/tasks/page.js`,
`app/manager/tasks/new/page.js`, `components/TaskForm.js`,
`app/staff/layout.js`, `app/staff/page.js`, `components/Badges.js`
(updated statuses).

Kept as-is: `components/ConfirmDialog.js`, `components/useToast.js`,
`lib/dates.js`, `app/globals.css` (design tokens), `app/layout.js`.

## Notes

- The ECMS button is a plain external link (`target="_blank"`) to
  `https://ecms.gentlehill.my/login` — it does not integrate with ECMS in
  any way, exactly as requested.
- Equipment images/logo were pulled from gentlehill.my with your
  authorization: `public/gentlehill-logo.png` (header), `public/gentlehill-mark.png`
  (favicon/compact icon), `public/gentlehill-hero.jpg` (landing page hero,
  the same photo used as a hero slide on gentlehill.my).
