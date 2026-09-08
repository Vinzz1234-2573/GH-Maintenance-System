import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { occurrenceDatesInRange } from "./schedule";

const NOT_CONFIGURED = {
  data: null,
  error: { message: "Supabase is not connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local." },
};

function guard() {
  return isSupabaseConfigured ? null : NOT_CONFIGURED;
}

export async function findUser(name, role) {
  const blocked = guard();
  if (blocked) return blocked;
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .ilike("name", name.trim())
    .maybeSingle();
  return { data, error };
}

export async function fetchStaffUsers() {
  const blocked = guard();
  if (blocked) return { ...blocked, data: [] };
  const { data, error } = await supabase.from("users").select("*").eq("role", "staff").order("name");
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

export async function updateTask(id, patch) {
  const blocked = guard();
  if (blocked) return blocked;
  const { data, error } = await supabase.from("maintenance_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select();
  return { data: data?.[0] || null, error };
}

// Manager-only — enable/disable never deletes anything, it just stops
// new occurrences from being generated; disabled tasks and their history
// stay intact.
export async function setTaskEnabled(id, enabled) {
  return updateTask(id, { enabled });
}

export async function deleteTask(id) {
  const blocked = guard();
  if (blocked) return blocked;
  const { error } = await supabase.from("maintenance_tasks").delete().eq("id", id);
  return { error };
}

// --- Occurrences (one row per due date) --------------------------------

export async function fetchOccurrences({ from, to, taskIds } = {}) {
  const blocked = guard();
  if (blocked) return { ...blocked, data: [] };
  let query = supabase.from("task_occurrences").select("*");
  if (from) query = query.gte("due_date", from);
  if (to) query = query.lte("due_date", to);
  if (taskIds) query = query.in("task_id", taskIds);
  const { data, error } = await query.order("due_date", { ascending: true });
  return { data: data || [], error };
}

export async function updateOccurrence(id, patch) {
  const blocked = guard();
  if (blocked) return blocked;
  const body = { ...patch };
  if (patch.status === "Completed" && !("completed_at" in patch)) body.completed_at = new Date().toISOString();
  const { data, error } = await supabase.from("task_occurrences").update(body).eq("id", id).select();
  return { data: data?.[0] || null, error };
}

// The "automatic" part of scheduling: for every enabled task, work out
// which calendar dates in [from, to] it's due on, and create any
// occurrence rows that don't exist yet (Pending). There's no server/cron
// here — this runs whenever a dashboard loads, so a task's next
// occurrence appears the next time anyone opens a relevant dashboard on
// or after that date, which in practice is every shift.
export async function ensureOccurrences(tasks, existingOccurrences, from, to) {
  const blocked = guard();
  if (blocked) return { data: existingOccurrences, error: blocked.error };

  const have = new Set(existingOccurrences.map((o) => `${o.task_id}|${o.due_date}`));
  const toInsert = [];
  for (const task of tasks) {
    if (!task.enabled) continue;
    for (const dueDate of occurrenceDatesInRange(task, from, to)) {
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

// Optional "evidence photo" a staff member attaches when updating a
// task — uploads to the public 'task-photos' bucket (see sql/schema.sql)
// and stamps the resulting URL onto the occurrence.
export async function uploadOccurrencePhoto(occurrenceId, file) {
  const blocked = guard();
  if (blocked) return blocked;
  const path = `${occurrenceId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from("task-photos").upload(path, file, { upsert: true });
  if (uploadError) return { data: null, error: uploadError };
  const { data: pub } = supabase.storage.from("task-photos").getPublicUrl(path);
  return updateOccurrence(occurrenceId, { photo_url: pub.publicUrl });
}

export const STATUSES = ["Pending", "In Progress", "Completed"];
