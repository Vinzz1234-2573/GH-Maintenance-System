import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { removeStorageFiles } from "./photos";

// Photo evidence is kept for 6 months, then the image files are deleted.
// The task, its status, remarks and review record are kept forever; the
// occurrence just gets photos_purged_at so the UI can say
// "Photos removed after 6 months".
//
// There's no server here, so this runs from the Manager dashboard in the
// background, at most once per 24h per browser. (Alternative if your
// Supabase plan includes it: Supabase Cron + an Edge Function calling the
// Storage API. Never purge with SQL DELETE on storage.objects — that
// orphans the actual files.)

export const RETENTION_MONTHS = 6;

const STORAGE_BATCH = 100; // files per Storage .remove() call
const PAGE_SIZE = 500; // task_photos rows fetched per round
const THROTTLE_KEY = "gh_photo_purge_last_run";
const THROTTLE_MS = 24 * 60 * 60 * 1000;

function cutoffISO(now = new Date()) {
  const d = new Date(now);
  d.setMonth(d.getMonth() - RETENTION_MONTHS);
  return d.toISOString(); // an instant (timestamptz), not a calendar date
}

// Returns the number of photos purged.
export async function purgeOldPhotos() {
  if (!isSupabaseConfigured) return 0;
  const cutoff = cutoffISO();
  let purged = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("task_photos")
      .select("id, occurrence_id, storage_path")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw new Error(error.message);
    if (!data?.length) break;

    // 1. Files first, via the Storage API.
    await removeStorageFiles(data.map((r) => r.storage_path), STORAGE_BATCH);

    // 2. Then the rows.
    const ids = data.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      const del = await supabase.from("task_photos").delete().in("id", ids.slice(i, i + 200));
      if (del.error) throw new Error(del.error.message);
    }

    // 3. Mark the occurrences so the UI can explain where the photos went.
    const occurrenceIds = [...new Set(data.map((r) => r.occurrence_id))];
    for (let i = 0; i < occurrenceIds.length; i += 200) {
      const upd = await supabase
        .from("task_occurrences")
        .update({ photos_purged_at: new Date().toISOString() })
        .in("id", occurrenceIds.slice(i, i + 200));
      if (upd.error) throw new Error(upd.error.message);
    }

    purged += data.length;
    if (data.length < PAGE_SIZE) break;
  }
  return purged;
}

function readLastRun() {
  try {
    return Number(window.localStorage.getItem(THROTTLE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastRun(ts) {
  try {
    window.localStorage.setItem(THROTTLE_KEY, String(ts));
  } catch {
    // storage blocked (private mode etc.) — just means we may run again sooner
  }
}

// Fire-and-forget: never throws, never blocks rendering.
export function maybePurgeOldPhotos() {
  if (typeof window === "undefined" || !isSupabaseConfigured) return;
  const now = Date.now();
  if (now - readLastRun() < THROTTLE_MS) return;
  writeLastRun(now); // claim the slot up front so parallel tabs don't double-run
  setTimeout(() => {
    purgeOldPhotos()
      .then((n) => { if (n) console.info(`Photo retention: removed ${n} photo(s) older than ${RETENTION_MONTHS} months.`); })
      .catch((err) => console.error("Photo retention purge failed", err));
  }, 3000);
}
