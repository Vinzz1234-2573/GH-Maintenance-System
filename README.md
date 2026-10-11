# Gentle Hill — Daily Equipment Maintenance System

A simple maintenance tracking system for **Gentle Hill Elder Care Centre**
(gentlehill.my): a Manager creates a recurring maintenance schedule
(daily / weekly / monthly) and assigns each task to Staff; Staff see only
their own tasks — Today's, Upcoming, and what they've completed today —
and update status/remarks. Login is by **email + password** (Supabase Auth),
and the database itself — not just the screens — enforces who can see and
change what (see "Login, roles &amp; access control").

- **Landing page** (`/`) — Gentle Hill branding + hero photo, with a single
  **Login** button. `/login` has the login form and a link to **Sign up**
  (`/signup`).
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
   (below), click Run — this creates the tables, enables RLS with
   permissive policies (see the note in that file), and inserts a sample
   manager, two sample staff, sample equipment, and the 8 preset daily tasks.
4. Add login support and lock the data down with the three files in
   `sql/auth/` — **in the order and at the time described in "Login, roles
   &amp; access control" and "Production cutover plan" below** (running
   `02-lockdown.sql` too early breaks any app that still uses the old
   name-only login).
5. Go to **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** (not the service_role key) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

These are **public** client-side variables by design (that's what
`NEXT_PUBLIC_` means in Next.js) — that's fine because Row Level Security
policies, not secrecy of the key, protect the data. `sql/schema.sql` alone
leaves those policies wide open (`using (true)`); `sql/auth/02-lockdown.sql`
replaces them with strict, role-based ones.

## 2. Run it locally

**Requires Node.js 22 or newer** (Next.js 16 needs ≥ 20.9 and
`@supabase/supabase-js` 2.117 needs ≥ 22). Current stack: Next.js 16.4.0
(Turbopack), React 19.3.0, `@supabase/supabase-js` 2.117.3. Supported
browsers (Next.js 16): Chrome/Edge/Firefox 111+, Safari 16.4+.

```bash
npm install
cp .env.local.example .env.local
# paste in your NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

Open http://localhost:3000. Try:
- **Login → Sign up** with a company email → you land on `/staff` (new
  accounts are always Staff).
- Make yourself a Manager (see "Bootstrapping the first Manager" below),
  log out and in → you land on `/manager`.
- Manager → **+ Add New Task** → assign it to your staff account → "Maintenance task created successfully."

Use a **separate TEST Supabase project** for local development — see
"Test project setup". Put its URL and key in `.env.development.local`
(`next dev` prefers it over `.env.local`; it is git-ignored via `.env*.local`).

## 3. Deploy on Vercel

Add the same two environment variables in **Vercel → Project → Environment
Variables**, then deploy. No other server-side secrets are needed.

**Set Vercel's Node.js version to 22.x or newer** (Project → Settings →
General → Node.js Version) — builds on an older Node are unsupported.

## Complete Supabase SQL

See [`sql/schema.sql`](sql/schema.sql) — copy its full contents into the
Supabase SQL Editor. Summary of what it creates:

```sql
users (id, name, role check ('manager'|'staff'), created_at,
       auth_user_id -> auth.users.id,   -- added by sql/auth/01-additive.sql: the login this profile belongs to
       email)                           --   (null auth_user_id = an old name-only profile nobody can log in as)
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
`task-photos` bucket) — **temporary: `sql/auth/02-lockdown.sql` replaces
them with strict ones** (see "Login, roles &amp; access control") — and
idempotent sample data (safe to re-run — it
only inserts rows that don't already exist by name) — including the 8
preset Daily tasks and today's occurrence for each of them.

**After pulling the photo-evidence update, re-run the whole of
`sql/schema.sql` in the Supabase SQL Editor.** Until you do, dashboards
will show a "Could not load data" error (the app now reads `task_photos`).

**Once `sql/auth/02-lockdown.sql` has been run on a project, never re-run
`sql/schema.sql` on its own**: it re-creates the permissive "anon full
access" policies, which would give every logged-in user full access again.
If you ever must, run `02-lockdown.sql` again straight afterwards.

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

Access control is enforced by the **database** — strict Row Level Security
from `sql/auth/02-lockdown.sql` — not by the screens: even someone who
calls the API directly with the public key (it's in the browser bundle, by
design) can only do what their own login is allowed to. **A project that
has not had `02-lockdown.sql` run on it is still wide open** (the policies
in `sql/schema.sql` allow everyone everything), and the old name-only
login is gone from this version of the app. Read "Honest security notes"
in the next section before putting this in front of real users.

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

## Login, roles &amp; access control

### How login works

- **`/login`** — email + password and a **Login** button, with "Don't have
  an account? **Sign up**" underneath. **`/signup`** — email, password
  (at least 8 characters) and confirm password; no name field (a new
  account's name defaults to the part of the email before `@`).
  `/login/manager` and `/login/staff` just redirect to `/login`, so old
  bookmarks keep working.
- Sign-ups are **company email addresses only** (see "Allowed email
  domains"). New accounts are always **Staff**.
- After logging in or signing up, the app reads the person's row in
  `public.users` (the row whose `auth_user_id` is their login) and sends
  **manager → `/manager`**, **staff → `/staff`**. If that row doesn't exist
  (the signup trigger failed) it shows a clear error and signs them out.
- `app/manager/layout.js` and `app/staff/layout.js` (via the shared
  `components/useAuthGuard.js`) check the Supabase session and the role on
  every visit: no session → `/login`; the wrong role → that person's own
  dashboard; signing out in another tab logs this tab out. **Logout** ends
  this browser's session only.
- `lib/session.js` is the single place that talks to Supabase Auth. Pages
  get `{ id, authId, name, email, role }` from it, where **`id` is the
  `users.id`** (what `maintenance_tasks.assigned_to` and
  `task_occurrences.reviewed_by` point at, so existing data keeps working)
  and `authId` is the Supabase login id.
- "Confirm email" is **OFF** by design (there is no SMTP), so signing up
  logs you straight in. If you ever turn it on, signing up shows "Check
  your email to confirm your account" instead — the app already handles it.
- **No "forgot password"**: it needs email delivery (SMTP). The login page
  says "Forgot your password? Ask your manager or administrator." The admin
  can reset someone without email: in Supabase → Authentication → Users,
  delete that user; they sign up again with the same email (their old
  profile row — name, role, tasks — is kept, just unlinked); then re-link
  it with `admin_link_account` (below).

### Roles, and how to change them

Every profile has a `role` in `public.users`: **`staff`** (every new
account) or **`manager`**. There is deliberately **no screen for changing
roles or names** — the app can't write to `users` at all. The admin does it
in Supabase:

> **Table Editor → `users`** → click the row's `role` (or `name`) → change
> it → save. The person logs out and back in.

or in the SQL Editor: `update public.users set role = 'manager' where lower(email) = 'pavi@gentlehill.my';`

| | Manager | Staff |
|---|---|---|
| Equipment | read, add, edit, delete | read |
| Maintenance tasks (the schedule) | read all; add, edit, enable/disable, delete | read only the ones assigned to them |
| Occurrences (one per date) | read all; approve, reject, delete | read their own; create their own blank day; set Pending / In Progress; **Submit for Review** (then locked) |
| Photos + the `task-photos` bucket | read all; upload; delete (rejection, task deletion, 6-month purge) | read their own; add/remove while the task is still theirs to edit |
| `users` | read all | read their own row only |

Staff can never set a task to Completed or Rejected, change who reviewed it,
the completion/review fields or the due date, or edit a task once it has
been submitted — the database refuses, whatever the browser sends. The
submit time and the reviewer are stamped by the database, not the browser.

The Manager's **Assign To** dropdown shows **`name (email)`** and lists only
accounts that can actually log in. Tasks still assigned to an old
name-only profile keep showing that person's name everywhere (and the Edit
dialog flags them as "no login yet").

### Bootstrapping the first Manager

New accounts are Staff, so the first Manager is promoted by hand:

1. Sign up in the app with their company email (they land on `/staff`).
2. In Supabase: Table Editor → `users` → set `role` to `manager` (or run
   the `update` above).
3. They log out and back in → `/manager`.

### Linking an existing person (so their tasks and history keep working)

The sample data (and anything from the old name-only version) has `users`
rows with **no login** — e.g. "Zul" with tasks assigned to him. When Zul
signs up he gets a **new, separate** row, and the app deliberately does
**not** merge them automatically (see the security notes). The admin does
it in the SQL Editor with `admin_link_account`:

```sql
-- 1. Zul signs up in the app. Find his OLD row (auth_user_id is empty):
select id, name, role, email, auth_user_id from public.users order by name;

-- 2. Link them (old row id, the email he signed up with):
select public.admin_link_account('<Zul old users.id>', 'zul@gentlehill.my');

-- Same for the Manager, so Pavi stays a Manager (the old row's role is kept):
select public.admin_link_account('<Pavi old users.id>', 'pavi@gentlehill.my');
```

It moves the login onto the old row, re-points the tasks and review
records that had been given to the duplicate, deletes the duplicate, and
keeps the old row's id, name and role — all in one transaction, with a
clear error if anything is wrong (not signed up yet, already linked, ...).

### Allowed email domains

Only addresses on these domains can sign up (case-insensitive, exact match —
`x@mail.gentlehill.my` would need its own entry). The default is
`gentlehill.my`, `amitabhafoundation.my` and `gamutpro.my`. To change it, edit the array in
`public.allowed_email_domains()` in `sql/auth/01-additive.sql` and re-run
that one statement; an empty array (`array[]::text[]`) turns the
restriction off. A rejected sign-up shows "Sign-ups are limited to company
email addresses". (Supabase Auth can hide a database trigger's own message
behind "Database error saving new user"; the app recognises both.)

### Honest security notes

- **Email addresses are not verified** (Confirm email is OFF). So anyone can
  sign up with *any* address on the allowed domain — including one that
  isn't theirs (`someone@gentlehill.my`). Because of that:
  - **Accounts are never auto-linked to an existing profile by email.**
    Otherwise a stranger could claim the Manager's row by signing up with
    the Manager's address. Linking is a manual admin action
    (`admin_link_account`).
  - A stranger with a company-looking address can create an **empty**
    Staff account. With strict RLS and no assigned tasks they see no tasks,
    no photos and no other users (they can read the equipment list and
    their own profile). They can't promote themselves — **roles only change
    by admin action**.
  - Watch the **Assign To** list: a stranger's account appears there like
    anyone else's. Only assign tasks to people you recognise.
- The public key is in the browser bundle (that's how Supabase works). What
  protects the data is RLS, which only holds if you have run
  `sql/auth/02-lockdown.sql` on that project, and not re-run
  `sql/schema.sql` after it.
- **Recommended later:** turn on email confirmation and set up a custom
  SMTP provider (Authentication → Sign In / Providers → Email, and
  Authentication → SMTP). The app already copes with confirmation being on
  (signup then asks the person to check their email), and it would verify
  addresses and make "forgot password" possible. Also consider Supabase's
  CAPTCHA / rate-limit settings (Authentication → Attack Protection) while
  sign-up is open.

### The SQL files (`sql/auth/`)

Run in the Supabase **SQL Editor**; each is safe to re-run.

| File | What it does | Safe while the OLD app is live? |
|---|---|---|
| `01-additive.sql` | Adds `users.auth_user_id` / `email`, the allowed-domain check and the new-user trigger on `auth.users`, the helper functions used by the policies, and `admin_link_account`. Only adds things. | **Yes** |
| `02-lockdown.sql` | Removes anon access, drops every "anon full access" policy (tables and the `task-photos` bucket), creates the strict role-based policies and the `task_occurrences` guard trigger. Stops with an error if 01 hasn't been run. | **No — it breaks the old app** |
| `99-rollback-lockdown.sql` | Undoes 02 only: restores the old permissive policies and grants. **Re-opens the database** — use only while the OLD app is what's deployed. | n/a |

### Test project setup

Never develop or test against the live project. Make a separate one:

1. Create a **second Supabase project**.
2. Run `sql/schema.sql`, then `sql/auth/01-additive.sql`, then `sql/auth/02-lockdown.sql` (SQL Editor, in that order).
3. **Authentication → Sign In / Providers → Email** → turn **OFF "Confirm email"**.
4. **Authentication → URL Configuration** → **Site URL** `http://localhost:3000`.
5. Put the TEST project's URL and publishable key in **`.env.development.local`** (git-ignored, and `next dev` prefers it over `.env.local`):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-TEST-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
6. `npm run dev`, open http://localhost:3000, and sign up a **manager** account and a **staff** account (company-domain emails). Promote the manager in the Table Editor (`users.role`).

### Tests

- `node scripts/test-auth-helpers.mjs` — email/password validation and the
  friendly error messages. No database or network needed.
- `node scripts/test-dates.mjs` — the existing date tests.
- **`node scripts/rls-test.mjs --confirm-test-project`** — checks the
  *real* policies on the TEST project: not-logged-in users can read nothing;
  staff see only their own tasks/occurrences/photos, can't write tasks,
  equipment or users (or change their own role), can't complete/reject or
  touch review fields, can submit and are then locked out, can't touch
  other people's photo folders; the manager can do the full
  create → approve / reject → delete cycle; a non-company signup is
  rejected and a company one gets a Staff profile. Prints PASS/FAIL per
  check and exits non-zero on any failure.
  - It reads the project URL and key **only** from `.env.development.local`,
    prints the URL, and **refuses to run without `--confirm-test-project`**.
  - Add four more variables (same file, or the shell) for the accounts from
    step 6: `TEST_MANAGER_EMAIL`, `TEST_MANAGER_PASSWORD`,
    `TEST_STAFF_EMAIL`, `TEST_STAFF_PASSWORD`.
  - It removes everything it creates (tasks, occurrences, photo rows,
    Storage files, equipment) and checks that they're gone. The one
    exception is the sign-up check's login `rls-test-signup@<your domain>`,
    which a public-key script can't delete; the same account is re-used on
    every run, and the script prints the two `delete` statements if you
    want it gone.

### Production cutover plan

The order matters.

1. **Back up the data** (Database → Backups, or export the tables) — and
   the `task-photos` bucket if you need the photos.
2. Run **`sql/auth/01-additive.sql`** on production. It only adds things,
   so the old app keeps working.
3. **Deploy the new app code.** It works against the still-open database.
4. **Everyone signs up.** Then the admin links existing people with
   `admin_link_account` and sets the Manager's role (see above).
5. In a quiet window, run **`sql/auth/02-lockdown.sql`**.
6. **Smoke-test** as a manager and as a staff member: log in, create and
   assign a task, submit with photos, approve and reject.
7. If anything breaks, run **`sql/auth/99-rollback-lockdown.sql`**
   (this re-opens the database, so redeploy the old app code while it's
   in effect), fix the problem, and try again.

Running `02-lockdown.sql` **before** the new code is live breaks the old
app: it logs in by name using the public key, which 02 no longer allows.

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
`app/globals.css` (design tokens), `app/layout.js`,
`app/manager/equipment/page.js`, `app/manager/tasks/new/page.js`,
`lib/supabaseClient.js`.
(The Supabase Auth work later replaced `components/LoginForm.js` and
rewrote `lib/session.js` and both layouts — see the next section.)

## Notes

- The ECMS button is a plain external link (`target="_blank"`) to
  `https://ecms.gentlehill.my/login` — it does not integrate with ECMS in
  any way, exactly as requested.
- Equipment images/logo were pulled from gentlehill.my with your
  authorization: `public/gentlehill-logo.png` (header), `public/gentlehill-mark.png`
  (favicon/compact icon), `public/gentlehill-hero.jpg` (landing page hero,
  the same photo used as a hero slide on gentlehill.my).
