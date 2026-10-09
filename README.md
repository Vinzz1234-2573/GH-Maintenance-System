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
  frequency filter (All/Daily/Weekly/Monthly/Once) and four quick-action tabs
  (**Today's Tasks** / **Pending** / **Upcoming** / **Completed**) sit at
  the top; each task is a card showing its frequency (always visible),
  schedule, due time if set, and a single **Update Task** button that
  opens a sheet to change status, add remarks, attach photos and
  **Submit for Review** (see "Photo evidence &amp; Manager review").
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
  status check ('Pending'|'In Progress'|'Awaiting Review'|'Rejected'|'Completed'),
  remarks, completed_at, created_at,
  submitted_at, reviewed_at, reviewed_by -> users.id, review_note,
  rejection_count, photos_purged_at
)
task_photos (                 -- photo evidence, files live in Storage
  id, occurrence_id -> task_occurrences.id (on delete cascade),
  storage_path,               -- '{occurrence_id}/{uuid}.jpg' in bucket 'task-photos'
  created_at
)
storage bucket 'task-photos'  -- PRIVATE, 5 MB/file, jpeg/png/webp
```

Plus: RLS enabled with a permissive "anon full access" policy on each
table (and matching temporary policies on `storage.objects` scoped to the
`task-photos` bucket), and idempotent sample data (safe to re-run — it
only inserts rows that don't already exist by name) — including the 8
preset Daily tasks and today's occurrence for each of them.

**After pulling the photo-evidence update, re-run the whole of
`sql/schema.sql` in the Supabase SQL Editor.** Until you do, dashboards
will show a "Could not load data" error (the app now reads `task_photos`).

## Photo evidence &amp; Manager review

Staff can no longer mark work Completed themselves. The flow is:

```
Pending ──► In Progress ──► Awaiting Review ──► Completed
                 ▲                │  (Manager approves)
                 │                ▼  (Manager rejects, with a note)
                 └──────── Rejected = "Needs Correction"
```

- **Staff** (`saveProgress`, `submitForReview` in `lib/data.js`): can set
  Pending / In Progress and remarks, and **Submit for Review** with
  **1–5 photos** (the button stays disabled until at least one photo is
  attached). The picker accepts camera or gallery. Each photo is
  compressed in the browser before upload (longest edge ≤ 1600 px, JPEG
  quality 0.7 — typically 150–400 KB) with EXIF orientation respected.
  Formats the browser can't decode (e.g. HEIC on some Android/desktop
  browsers) show a clear error. Uploads retry up to 3 times; if any photo
  fails, the ones already uploaded are removed so nothing is left half
  submitted, and the staff member gets a Retry button.
- **Awaiting Review** shows in Staff's Today/Pending tabs with a badge,
  remarks and read-only photos. It **never turns Overdue** — staff have
  done their part.
- **Manager** (`reviewTask`): the Dashboard has a **Review Queue** above
  the task table (task, equipment, staff, submitted time, remarks, photo
  thumbnails — tap for a full-screen viewer with prev/next). **Approve**
  sets Completed (+ `completed_at`, `reviewed_at`, `reviewed_by`).
  **Reject** requires a note; the submitted photos are deleted, and the
  task returns to staff as **Needs Correction** with the note shown at
  the top of the card. Resubmitting requires fresh photos.
  `reviewTask` is the **only** code path that sets Completed.
- The table's old "✓ Mark Completed" quick buttons are gone; each row has
  **Review** (if awaiting) or **View** / **View photos**, which opens the
  detail dialog including who reviewed it and when.
- The Manager's **Pending** KPI counts Pending + Awaiting Review + Needs
  Correction; clicking it filters the table to exactly those.
- **Private bucket + signed URLs**: the `task-photos` bucket is not
  public. Photos are displayed through signed URLs (valid 1 hour),
  requested only when the thumbnails scroll into view.
- **Deleting** a task first removes its photo files through the Storage
  API, then deletes the task (the DB cascades occurrences and
  `task_photos` rows). Files are never deleted via SQL — a SQL `DELETE`
  on `task_photos` or `storage.objects` leaves the actual files orphaned.

### 6-month photo retention

`lib/retention.js` (`RETENTION_MONTHS = 6`): photos older than 6 months
are deleted (files via the Storage API in batches of ≤ 100, then their
`task_photos` rows) and the occurrence gets `photos_purged_at`, so the
Manager sees "Photos removed after 6 months". **The task, its status,
remarks and review record are kept.** There's no server, so this runs in
the background from the Manager Dashboard at most once every 24 hours per
browser (throttled via `localStorage`); it never blocks the page and only
logs errors to the console.

If your Supabase plan includes it, a sturdier alternative is **Supabase
Cron + an Edge Function** that does the same thing on a schedule using
the Storage API. Do **not** implement the purge as a SQL `DELETE` on
`storage.objects` — that removes the metadata row but not the file.

## Security — please read

Login is still name-only (see below), and every table and the photo
bucket use deliberately permissive policies for the public key. The
Staff/Manager split in this update (`saveProgress`/`submitForReview` vs
`reviewTask`, status-guarded updates) is a **process/UI control only**:
anyone who has the public Supabase key (it's in the browser bundle) can
still call the API directly and, for example, set a task to Completed or
download/delete photos. Real enforcement needs Supabase Auth plus RLS
policies keyed on `auth.uid()` and the user's role — the separately named
staff-only and manager-only functions in `lib/data.js` are where those
checks will attach.

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
- **Dates are local calendar dates**: every `YYYY-MM-DD` string is the
  device's local date (`lib/dates.js`: `todayStr`, `toDateStr`, `addDays`,
  `isoWeekday`) and never goes through `toISOString()`, which used to
  shift ranges a day early in Malaysia (UTC+8). `node scripts/test-dates.mjs`
  checks this under Asia/Kuala_Lumpur, UTC and America/Los_Angeles.
- **Editing a task's schedule, assignee or enabled flag** deletes that
  task's future (today or later), still-Pending, photo-less occurrences
  so they're regenerated from the new rule. Anything staff have acted on
  (In Progress, Awaiting Review, Needs Correction, Completed) is kept.
- **Completion**: completing an occurrence (via Manager approval) only affects that one
  date's row — `task_occurrences` has a unique `(task_id, due_date)`, so
  the next day's occurrence is a separate row, generated fresh (Pending)
  the next time it's viewed. Nothing needs to be "reset."
- **Overdue**: computed for display only (`occurrenceDisplayStatus()` in
  `lib/schedule.js`) — an occurrence whose `due_date` has passed and is
  still with staff (Pending, In Progress, or Needs Correction) reads as
  Overdue; Awaiting Review never does. Disabled tasks' occurrences are
  hidden from the Manager table and Overdue panel (history stays in the
  DB). Nothing is stored as "overdue."
- **Staff view window**: Staff see existing rows from 30 days ago to 13
  days ahead — **Today's Tasks** (due today, not Completed), **Pending**
  (everything not Completed due today or earlier, oldest first, incl.
  Overdue / Awaiting Review / Needs Correction), **Upcoming**, and
  **Completed** (approved in the last 30 days, newest first, with due
  date and completion time). The frequency filter has All / Daily /
  Weekly / Monthly / Once and resets to All on every load.
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

**Limitation worth knowing (no backfill):** occurrences are generated
lazily (on view, not on a schedule), and recurring (daily/weekly/monthly)
tasks are deliberately only generated for **today and later** — even
when the Manager views a past date range — so opening a wide range never
invents dozens of fake overdue rows. One-time tasks are generated for
any date in range. The consequence: a recurring date on which nobody
opened the app never gets a row, so it can't show up as "overdue" later. For a system opened every shift this isn't an issue in practice, but
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
