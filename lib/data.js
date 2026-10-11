import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { occurrenceDatesInRange } from "./schedule";
import { todayStr } from "./dates";
import {
  MIN_PHOTOS, MAX_PHOTOS, uploadPhotos, deletePhotoRows, removeStorageFiles, fetchPhotosForOccurrences,
} from "./photos";

const NOT_CONFIGURED = {
  data: null,
  error: { message: "Supabase is not connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local." },
};

function guard() {
  return isSupabaseConfigured ? null : NOT_CONFIGURED;
}

const USER_COLUMNS = "id, name, role, email, auth_user_id";

// People a task can be assigned to: staff who can actually log in (a users
// row with no auth_user_id is an old name-only profile nobody can sign in
// as). Use fetchUsers() when you only need to look a name up.
export async function fetchStaffUsers() {
  const blocked = guard();
  if (blocked) return { ...blocked, data: [] };
  const { data, error } = await supabase
    .from("users")
    .select(USER_COLUMNS)
    .eq("role", "staff")
    .not("auth_user_id", "is", null)
    .order("name");
  return { data: data || [], error };
}

export async function fetchEquipment() {
  const blocked = guard();
  if (blocked) return { ...blocked, data: [] };
  const { data, error } = await supabase.from("equipment").select("*").order("equipment_name");
  return { data: data || [], error };
}

export async function addEquipment(payload) {
  const blocked = guard();
  if (blocked) return blocked;
  const { data, error } = await supabase.from("equipment").insert([payload]).select();
  return { data: data?.[0] || null, error };
}

export async function updateEquipment(id, patch) {
  const blocked = guard();
  if (blocked) return blocked;
  const { data, error } = await supabase.from("equipment").update(patch).eq("id", id).select();
  return { data: data?.[0] || null, error };
}

export async function deleteEquipment(id) {
  const blocked = guard();
  if (blocked) return blocked;
  const { error } = await supabase.from("equipment").delete().eq("id", id);
  return { error };
}

// --- Task templates (the recurring schedule) --------------------------

export async function fetchTasks() {
  const blocked = guard();
  if (blocked) return { ...blocked, data: [] };
  const { data, error } = await supabase.from("maintenance_tasks").select("*").order("created_at", { ascending: false });
  return { data: data || [], error };
}

export async function addTask(payload) {
  const blocked = guard();
  if (blocked) return blocked;
  const { data, error } = await supabase.from("maintenance_tasks").insert([payload]).select();
  return { data: data?.[0] || null, error };
}

// Fields that decide which occurrences exist (and for whom). If any of
// these change, already-generated future Pending rows may be wrong.
const REGENERATING_FIELDS = ["frequency", "weekly_days", "monthly_day", "start_date", "assigned_to", "enabled"];

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export async function updateTask(id, patch) {
  const blocked = guard();
  if (blocked) return blocked;
  const { data: before } = await supabase.from("maintenance_tasks").select("*").eq("id", id).maybeSingle();
  const { data, error } = await supabase.from("maintenance_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select();
  if (error) return { data: null, error };

  const changed = !before || REGENERATING_FIELDS.some((f) => f in patch && !sameValue(before[f], patch[f]));
  if (changed) {
    const pruned = await pruneFutureOccurrences(id);
    if (pruned.error) return { data: data?.[0] || null, error: pruned.error };
  }
  return { data: data?.[0] || null, error: null };
}

// After a schedule/assignee/enabled change: delete this task's future
// (due today or later), still-Pending, photo-less occurrences so
// ensureOccurrences regenerates them from the new rule. Anything a staff
// member has acted on (In Progress, Awaiting Review, Rejected, Completed,
// or with photos attached) is never touched.
async function pruneFutureOccurrences(taskId) {
  const { data, error } = await supabase
    .from("task_occurrences")
    .select("id, task_photos(id)")
    .eq("task_id", taskId)
    .eq("status", "Pending")
    .gte("due_date", todayStr());
  if (error) return { error };
  const ids = (data || []).filter((o) => !o.task_photos?.length).map((o) => o.id);
  if (ids.length === 0) return { error: null };
  const res = await supabase.from("task_occurrences").delete().in("id", ids).eq("status", "Pending");
  return { error: res.error };
}

// Manager-only — enable/disable never deletes anything, it just stops
// new occurrences from being generated; disabled tasks and their history
// stay intact.
export async function setTaskEnabled(id, enabled) {
  return updateTask(id, { enabled });
}

// Deleting a task cascades to its occurrences and task_photos rows in the
// DB, but NOT to the image files in Storage — so remove those first via
// the Storage API, then delete the task.
export async function deleteTask(id) {
  const blocked = guard();
  if (blocked) return blocked;
  const occ = await supabase.from("task_occurrences").select("id").eq("task_id", id);
  if (occ.error) return { error: occ.error };
  try {
    const photos = await fetchPhotosForOccurrences((occ.data || []).map((o) => o.id));
    if (photos.length) await removeStorageFiles(photos.map((p) => p.storage_path));
  } catch (err) {
    return { error: { message: err.message } };
  }
  const { error } = await supabase.from("maintenance_tasks").delete().eq("id", id);
  return { error };
}

// --- Users ---------------------------------------------------------------

// Every users row (staff + managers, with or without a login) — for name
// lookups: who a task is assigned to, who reviewed it. Manager-only: staff
// can only read their own row.
export async function fetchUsers() {
  const blocked = guard();
  if (blocked) return { ...blocked, data: [] };
  const { data, error } = await supabase.from("users").select(USER_COLUMNS).order("name");
  return { data: data || [], error };
}

// --- Occurrences (one row per due date) --------------------------------

const OCCURRENCE_SELECT = "*, task_photos(id, storage_path, created_at)";

export async function fetchOccurrences({ from, to, taskIds } = {}) {
  const blocked = guard();
  if (blocked) return { ...blocked, data: [] };
  let query = supabase.from("task_occurrences").select(OCCURRENCE_SELECT);
  if (from) query = query.gte("due_date", from);
  if (to) query = query.lte("due_date", to);
  if (taskIds) query = query.in("task_id", taskIds);
  const { data, error } = await query.order("due_date", { ascending: true });
  return { data: data || [], error };
}

// Everything waiting for a Manager decision, regardless of due date, so
// nothing can fall outside the dashboard's date window.
export async function fetchAwaitingReview() {
  const blocked = guard();
  if (blocked) return { ...blocked, data: [] };
  const { data, error } = await supabase
    .from("task_occurrences")
    .select(OCCURRENCE_SELECT)
    .eq("status", "Awaiting Review")
    .order("submitted_at", { ascending: true });
  return { data: data || [], error };
}

async function fetchOccurrence(id) {
  return supabase.from("task_occurrences").select(OCCURRENCE_SELECT).eq("id", id).maybeSingle();
}

// Guarded update: only applies if the row is currently in one of
// `fromStatuses`, so a stale screen can't overwrite someone else's step
// (e.g. reopen a task the Manager already approved).
async function transition(id, fromStatuses, patch) {
  const { data, error } = await supabase
    .from("task_occurrences")
    .update(patch)
    .eq("id", id)
    .in("status", fromStatuses)
    .select(OCCURRENCE_SELECT);
  if (error) return { data: null, error };
  if (!data?.length) {
    return { data: null, error: { message: "This task was changed by someone else. Please refresh and try again." } };
  }
  return { data: data[0], error: null };
}

// ========================================================================
// STAFF-ONLY actions. Staff can move their own work between Pending and
// In Progress and submit it (with photos) for review — they can never set
// Completed. The database enforces this too (sql/auth/02-lockdown.sql:
// RLS policies + a trigger on task_occurrences), so a staff session cannot
// do anything else even by calling the API directly.
// ========================================================================

export const STAFF_STATUSES = ["Pending", "In Progress"];

// Save status (Pending/In Progress) and remarks without submitting.
// `status` may be omitted (e.g. a Rejected task saving remarks only keeps
// its Needs Correction state).
export async function saveProgress(id, { status, remarks }) {
  if (status !== undefined && !STAFF_STATUSES.includes(status)) {
    throw new Error(`saveProgress: staff cannot set status "${status}".`);
  }
  const blocked = guard();
  if (blocked) return blocked;
  const patch = { remarks };
  if (status !== undefined) patch.status = status;
  return transition(id, ["Pending", "In Progress", "Rejected"], patch);
}

// Upload 1-5 compressed photos and hand the task to the Manager.
// Photos from a previous rejected attempt were already deleted at
// rejection time; any stragglers are cleared defensively first.
export async function submitForReview(id, { remarks, blobs }) {
  if (!blobs || blobs.length < MIN_PHOTOS || blobs.length > MAX_PHOTOS) {
    throw new Error(`Attach between ${MIN_PHOTOS} and ${MAX_PHOTOS} photos.`);
  }
  const blocked = guard();
  if (blocked) return blocked;

  const current = await fetchOccurrence(id);
  if (current.error) return { data: null, error: current.error };
  if (!current.data || !["Pending", "In Progress", "Rejected"].includes(current.data.status)) {
    return { data: null, error: { message: "This task can't be submitted right now. Please refresh." } };
  }

  let uploaded;
  try {
    if (current.data.status === "Rejected" && current.data.task_photos?.length) {
      await deletePhotoRows(current.data.task_photos);
    }
    uploaded = await uploadPhotos(id, blobs);
  } catch (err) {
    return { data: null, error: { message: err.message } };
  }

  const res = await transition(id, ["Pending", "In Progress", "Rejected"], {
    status: "Awaiting Review",
    submitted_at: new Date().toISOString(),
    remarks,
  });
  if (res.error) {
    // Don't leave photos attached to a task that never reached review.
    try {
      await deletePhotoRows(uploaded);
    } catch (err) {
      console.error("Photo rollback failed", err);
    }
  }
  return res;
}

// ========================================================================
// MANAGER-ONLY actions. reviewTask is the ONLY code path that sets
// Completed on new work. These run in the Manager's login; RLS lets only a
// Manager complete/reject a task, and the database stamps reviewed_by from
// the logged-in user (the reviewerId passed in is just a convenience).
// ========================================================================

export async function reviewTask(id, { decision, note, reviewerId }) {
  if (decision !== "approve" && decision !== "reject") {
    throw new Error(`reviewTask: unknown decision "${decision}".`);
  }
  const blocked = guard();
  if (blocked) return blocked;
  const now = new Date().toISOString();

  if (decision === "approve") {
    return transition(id, ["Awaiting Review"], {
      status: "Completed",
      completed_at: now,
      reviewed_at: now,
      reviewed_by: reviewerId || null,
    });
  }

  const trimmed = (note || "").trim();
  if (!trimmed) return { data: null, error: { message: "Please write a note telling staff what to correct." } };

  const current = await fetchOccurrence(id);
  if (current.error) return { data: null, error: current.error };
  if (current.data?.status !== "Awaiting Review") {
    return { data: null, error: { message: "This task is no longer awaiting review. Please refresh." } };
  }
  // Rejected photos are not kept: remove files (Storage API) + rows first,
  // so a failed cleanup leaves the task untouched in Awaiting Review.
  try {
    await deletePhotoRows(current.data.task_photos || []);
  } catch (err) {
    return { data: null, error: { message: err.message } };
  }
  return transition(id, ["Awaiting Review"], {
    status: "Rejected",
    review_note: trimmed,
    reviewed_at: now,
    reviewed_by: reviewerId || null,
    rejection_count: (current.data.rejection_count || 0) + 1,
    submitted_at: null,
  });
}

// --- Clearing overdue work (Manager only) ----------------------------------
// "Overdue" isn't stored anywhere: it's any past-due occurrence that is still
// with staff. So clearing it means deleting those occurrence rows. RLS lets
// only a Manager do this (sql/auth/02-lockdown.sql: "occurrences delete
// manager"), so this needs no SQL change.
//
// Only rows that are STILL Pending / In Progress / Rejected and due BEFORE
// today are touched. The checks run again here against the database, so a
// stale screen can never delete something that was submitted or completed in
// the meantime, or anything due today or later.
//
// Recurring tasks simply carry on from today (past dates are never
// backfilled). A one-time task would be re-created the next time a date range
// covering its day is opened, so it is dealt with too: see retireOneTimeTasks.
const CLEARABLE_STATUSES = ["Pending", "In Progress", "Rejected"];
const CLEAR_BATCH = 100; // ids per request, keeps the URL short

// Returns { cleared, retiredTasks, error }. On a failure part-way through,
// `cleared` is how many were already removed before it stopped.
export async function clearOverdueOccurrences(occurrenceIds) {
  const blocked = guard();
  if (blocked) return { cleared: 0, retiredTasks: 0, error: blocked.error };
  const ids = [...new Set(occurrenceIds || [])];
  const touchedTaskIds = new Set();
  let cleared = 0;
  try {
    for (let i = 0; i < ids.length; i += CLEAR_BATCH) {
      const batch = ids.slice(i, i + CLEAR_BATCH);
      const { data: rows, error } = await supabase
        .from("task_occurrences")
        .select("id, task_id, task_photos(id, storage_path)")
        .in("id", batch)
        .in("status", CLEARABLE_STATUSES)
        .lt("due_date", todayStr());
      if (error) throw new Error(error.message);
      if (!rows?.length) continue;

      // Photos normally exist only while a task is Awaiting Review, so this is
      // for stragglers, but never leave files behind in Storage.
      await deletePhotoRows(rows.flatMap((r) => r.task_photos || []));

      const { data: gone, error: deleteError } = await supabase
        .from("task_occurrences")
        .delete()
        .in("id", rows.map((r) => r.id))
        .in("status", CLEARABLE_STATUSES)
        .lt("due_date", todayStr())
        .select("id, task_id");
      if (deleteError) throw new Error(deleteError.message);
      for (const row of gone || []) touchedTaskIds.add(row.task_id);
      cleared += gone?.length || 0;
    }
    const retiredTasks = await retireOneTimeTasks([...touchedTaskIds]);
    return { cleared, retiredTasks, error: null };
  } catch (err) {
    return { cleared, retiredTasks: 0, error: { message: err.message } };
  }
}

// A one-time task has a single date, so once that date's occurrence is cleared
// nothing is left of it: delete the task. If it still has other occurrences
// (history), switch it off instead so it can't be re-created. Returns how many
// tasks were deleted or switched off.
async function retireOneTimeTasks(taskIds) {
  if (taskIds.length === 0) return 0;
  const { data: oneTimeTasks, error } = await supabase
    .from("maintenance_tasks")
    .select("id")
    .in("id", taskIds)
    .eq("frequency", "once");
  if (error) throw new Error(error.message);

  let retired = 0;
  for (const task of oneTimeTasks || []) {
    const { data: remaining, error: remainingError } = await supabase
      .from("task_occurrences")
      .select("id")
      .eq("task_id", task.id)
      .limit(1);
    if (remainingError) throw new Error(remainingError.message);
    const res = remaining?.length ? await setTaskEnabled(task.id, false) : await deleteTask(task.id);
    if (res.error) throw new Error(res.error.message);
    retired += 1;
  }
  return retired;
}

// The "automatic" part of scheduling: for every enabled task, work out
// which calendar dates in [from, to] it's due on, and create any
// occurrence rows that don't exist yet (Pending). There's no server/cron
// here — this runs whenever a dashboard loads, so a task's next
// occurrence appears the next time anyone opens a relevant dashboard on
// or after that date, which in practice is every shift.
//
// No backfill: recurring (daily/weekly/monthly) tasks are only generated
// for dates >= today, even if [from, to] reaches into the past — otherwise
// opening a wide range would invent dozens of fake "overdue" rows for days
// nobody worked. One-time tasks may be generated on any date in range.
// Consequence: a recurring date on which nobody opened the app never gets
// a row (see README).
export async function ensureOccurrences(tasks, existingOccurrences, from, to) {
  const blocked = guard();
  if (blocked) return { data: existingOccurrences, error: blocked.error };

  const today = todayStr();
  const have = new Set(existingOccurrences.map((o) => `${o.task_id}|${o.due_date}`));
  const toInsert = [];
  for (const task of tasks) {
    if (!task.enabled) continue;
    const genFrom = task.frequency === "once" ? from : [from, today].sort()[1];
    for (const dueDate of occurrenceDatesInRange(task, genFrom, to)) {
      const key = `${task.id}|${dueDate}`;
      if (!have.has(key)) {
        have.add(key);
        toInsert.push({ task_id: task.id, due_date: dueDate });
      }
    }
  }
  if (toInsert.length === 0) return { data: existingOccurrences, error: null };

  const { data, error } = await supabase
    .from("task_occurrences")
    .upsert(toInsert, { onConflict: "task_id,due_date", ignoreDuplicates: true })
    .select();
  if (error) return { data: existingOccurrences, error };
  return { data: [...existingOccurrences, ...(data || [])], error: null };
}
