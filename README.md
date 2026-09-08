# Gentle Hill — Daily Equipment Maintenance System

A simple maintenance tracking system for **Gentle Hill Elder Care Centre**
(gentlehill.my): a Manager creates a recurring maintenance schedule
(daily / weekly / monthly) and assigns each task to Staff; Staff see only
their own tasks — Today's, Upcoming, and what they've completed today —
and update status/remarks. Login is name-only for now (no password),
ready to be upgraded to real Supabase Auth later.

- **Landing page** (`/`) — Gentle Hill branding + hero photo, with
  **Manager Login** and **Staff Login** buttons.
- **Manager** (`/manager`) — Dashboard (date filter: Today / Tomorrow /
  This Week / This Month / Custom Range, KPI cards, an Overdue panel,
  and the scheduled task list for the selected range), Equipment
  (add/edit/delete), Maintenance Tasks (the full recurring schedule —
  filterable, edit/enable/disable/delete), Add New Task, plus
  **Back to Website** and **Login to ECMS** (external link to
  `https://ecms.gentlehill.my/login` — a separate system, this is just a
  shortcut).
- **Staff** (`/staff`) — mobile-first, only tasks assigned to them. A
  frequency filter (All/Daily/Weekly/Monthly) and four quick-action tabs
  (**Today's Tasks** / **Pending** / **Upcoming** / **Completed**) sit at
  the top; each task is a card showing its frequency (always visible),
  schedule, due time if set, and a single **Update Task** button that
  opens a sheet to change status, mark completed, and add remarks.
  Upcoming renders as a compact scannable list
  (`Today — Clean Lobby — Daily`) rather than full cards.
- **Recurring schedule, set once** — a Manager picks Daily, Weekly (choose
  the day(s)), or Monthly (choose the date) when creating a task, and it
  keeps appearing for Staff automatically from then on — see "Scheduling
  &amp; recurrence" below for exactly how that works without a server/cron.
- **Preset daily checklist** — the 8 items from `docs/Daily Equipment
  Maintenance Record.docx` (Toilet Fixtures, Air-condition & Fan, Water
  Pump, Kitchen & Drainage, Lift & Cargo Lift, Lighting, Flooring &
  Ceiling, Equipment) are seeded automatically by `sql/schema.sql` as
  Daily tasks — the Manager never has to create these by hand, just
  reassign them to real staff.

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
   (below), click Run — this creates the 4 tables, enables RLS with
   permissive policies (see the note in that file), and inserts a sample
   manager, two sample staff, sample equipment, and the 8 preset daily tasks.
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
# paste in your NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
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
maintenance_tasks (          -- the recurring SCHEDULE, manager-owned
  id, equipment_id -> equipment.id, task_name, description,
  assigned_to -> users.id,
  frequency check ('once'|'daily'|'weekly'|'monthly'),
  weekly_days int[],          -- ISO weekday numbers, Mon=1..Sun=7
  monthly_day int,            -- 1-31, clamped to month length
  start_date,                 -- also the single due date when frequency='once'
  due_time,                   -- optional 'HH:MM', shown on staff task cards
  enabled,                    -- manager enable/disable
  created_at, updated_at
)
task_occurrences (            -- one row per calendar date a task is due
  id, task_id -> maintenance_tasks.id, due_date,
  status check ('Pending'|'In Progress'|'Completed'),
  remarks, completed_at, created_at
)
```

Plus: RLS enabled with a permissive "anon full access" policy on each
table, and idempotent sample data (safe to re-run — it only inserts rows
that don't already exist by name) — including the 8 preset Daily tasks
and today's occurrence for each of them. (No photo/evidence upload —
that was considered and dropped as unnecessary, so there's no Storage
bucket either.)

## Scheduling &amp; recurrence

`maintenance_tasks` is the schedule a Manager sets once; `task_occurrences`
is what Staff actually see and check off — one row per calendar date a
task is due. This split is what makes "Completed Today" and "Upcoming"
possible, and lets a daily task's history exist without a single row
being overwritten every day.

- **Frequency options**: Once (a single due date), Daily, Weekly (pick
  one or more days), Monthly (pick a day of the month, 1-31 — clamped to
  the last day of shorter months). All the date math is in
  `lib/schedule.js` (`isDueOn`, `occurrenceDatesInRange`) and is pure/testable,
  no database calls.
- **How occurrences "automatically appear"**: there is no server or cron
  job in this app. Instead, whenever the Staff dashboard or Manager
  dashboard loads, `ensureOccurrences()` (`lib/data.js`) works out which
  calendar dates each enabled task is due on within the range being
  viewed, and creates any missing `task_occurrences` rows on the spot
  (`Pending`). In practice this means: the next occurrence exists by the
  time anyone next opens a relevant dashboard on or after that date —
  which, for a real daily-use system, is every shift. It is **not** a
  background job that fires at midnight on its own.
- **Completion**: marking an occurrence Completed only affects that one
  date's row — `task_occurrences` has a unique `(task_id, due_date)`, so
  the next day's occurrence is a separate row, generated fresh (Pending)
  the next time it's viewed. Nothing needs to be "reset."
- **Overdue**: computed for display only (`occurrenceDisplayStatus()` in
  `lib/schedule.js`) — an occurrence whose `due_date` has passed and is
  still not Completed reads as Overdue. Nothing is stored as "overdue."
- **Enable / Disable**: only changes `maintenance_tasks.enabled`. A
  disabled task immediately stops generating new occurrences and is
  filtered out of the Staff dashboard, but any occurrences it already
  generated (and the task itself) are untouched — re-enabling picks up
  right where it left off. Only the Manager pages ever call
  `setTaskEnabled()`; Staff have no access to it.
- **Manager Dashboard date filter** (Today/Tomorrow/This Week/This
  Month/Custom Range) scopes the Pending/Completed counts and the task
  table to that window; **Overdue** and **Disabled Tasks** are shown
  as absolute counts regardless of the filter, since "what's overdue"
  and "what's turned off" aren't really date-range questions.
- **Status filter, on top of the date filter** — a Status dropdown (or
  clicking the Pending/Completed/Overdue KPI cards directly) narrows the
  task table further, e.g. Today + Completed shows exactly what's been
  done today. The KPI counts themselves stay as the full range breakdown
  regardless of this filter — it only narrows the table below them.

**Limitation worth knowing:** because occurrences are generated lazily
(on view, not on a schedule), a date that nobody ever viewed a dashboard
for won't retroactively show up as "overdue" later — there's no row for
it. For a system opened every shift this isn't an issue in practice, but
if you need guaranteed backfill regardless of whether anyone opens the
app, that's what a real scheduled job (Supabase Edge Function + `pg_cron`)
would be for — a reasonable next step if it becomes important.

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

## Files changed for the recurrence engine

Added: `lib/schedule.js` (frequency math: `isDueOn`, `occurrenceDatesInRange`,
`scheduleSummary`, `occurrenceDisplayStatus`), `task_occurrences` table
in `sql/schema.sql`.

Rewritten: `lib/data.js` (task templates + occurrences + `ensureOccurrences`
lazy generation, replacing the old single-row `is_daily`/`effectiveStatus`
model), `lib/dates.js` (`periodRange` now supports today/tomorrow/week/month),
`components/TaskForm.js` (frequency picker with weekly-day/monthly-day
inputs, replacing status/date/remarks fields), `app/manager/page.js`
(date-filtered Dashboard with Overdue panel), `app/manager/tasks/page.js`
(schedule/template management list), `app/staff/page.js` (Today's Tasks /
Completed Today / Upcoming Tasks), `components/Badges.js` (added Overdue,
Disabled).

Kept as-is: `components/ConfirmDialog.js`, `components/useToast.js`,
`app/globals.css` (design tokens), `app/layout.js`, `app/manager/layout.js`,
`app/manager/equipment/page.js`, `app/manager/tasks/new/page.js`,
`components/LoginForm.js`, `lib/session.js`, `lib/supabaseClient.js`.

## Notes

- The ECMS button is a plain external link (`target="_blank"`) to
  `https://ecms.gentlehill.my/login` — it does not integrate with ECMS in
  any way, exactly as requested.
- Equipment images/logo were pulled from gentlehill.my with your
  authorization: `public/gentlehill-logo.png` (header), `public/gentlehill-mark.png`
  (favicon/compact icon), `public/gentlehill-hero.jpg` (landing page hero,
  the same photo used as a hero slide on gentlehill.my).
