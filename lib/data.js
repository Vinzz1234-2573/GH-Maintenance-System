import { supabase, isSupabaseConfigured } from "./supabaseClient";

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
  const { data, error } = await supabase.from("maintenance_tasks").update(patch).eq("id", id).select();
  return { data: data?.[0] || null, error };
}

export async function deleteTask(id) {
  const blocked = guard();
  if (blocked) return blocked;
  const { error } = await supabase.from("maintenance_tasks").delete().eq("id", id);
  return { error };
}

export const STATUSES = ["Pending", "In Progress", "Completed"];
