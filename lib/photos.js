import { supabase, isSupabaseConfigured } from "./supabaseClient";

// Photo evidence for task occurrences.
//
// Files live in the PRIVATE "task-photos" Storage bucket at
// {occurrence_id}/{uuid}.jpg and are only ever shown through short-lived
// signed URLs; the task_photos table records which files belong to which
// occurrence. Files must always be deleted through the Storage API
// (.remove()) — deleting rows or storage.objects via SQL orphans the
// actual files.

export const PHOTO_BUCKET = "task-photos";
export const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 5;
export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.7;

const REMOVE_BATCH = 1000; // Storage API limit per .remove() call
const UPLOAD_RETRIES = 3;

function requireSupabase() {
  if (!isSupabaseConfigured) throw new Error("Supabase is not connected yet.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// --- Compression ----------------------------------------------------------

const DECODE_ERROR =
  "This photo couldn't be opened. Please choose a JPEG or PNG photo — some phone formats (e.g. HEIC) " +
  "aren't supported by this browser. On iPhone, set Settings → Camera → Formats → Most Compatible.";

// Decode with EXIF orientation applied. createImageBitmap first; fall back
// to <img> (which browsers also orient by EXIF by default).
async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(DECODE_ERROR));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

// File -> JPEG Blob, longest edge <= 1600px (never upscaled), quality 0.7.
// Typical phone photo ends up ~150-400 KB.
export async function compressImage(file) {
  if (file.type && !file.type.startsWith("image/")) throw new Error(`"${file.name}" is not an image.`);
  let decoded;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw new Error(DECODE_ERROR);
  }
  try {
    const { width, height } = decoded;
    if (!width || !height) throw new Error(DECODE_ERROR);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // transparent PNGs -> white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(decoded.source, 0, 0, w, h);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("Couldn't compress this photo. Please try another one.");
    return blob;
  } finally {
    decoded.release();
  }
}

// Still frame from a live <video> (the in-page camera, components/CameraCapture.js)
// -> JPEG Blob, same size and quality rules as compressImage. The frame comes
// straight from the camera stream, so it is already the right way up.
export async function captureVideoFrame(video) {
  const width = video?.videoWidth;
  const height = video?.videoHeight;
  if (!width || !height) throw new Error("The camera isn't ready yet. Please try again in a moment.");
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(video, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Couldn't save that photo. Please try again.");
  return blob;
}

// --- Upload ---------------------------------------------------------------

// crypto.randomUUID() only exists in secure contexts (https/localhost);
// fall back to getRandomValues so testing from a phone over plain-http LAN works.
function uuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function uploadWithRetry(path, blob) {
  let lastError;
  for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 0.5s, 1s, 2s
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (!error) return;
    lastError = error;
  }
  throw new Error(`Photo upload failed: ${lastError?.message || "network error"}`);
}

// Uploads all blobs and records them in task_photos. All-or-nothing: if
// any upload (or the row insert) fails, files already uploaded by this
// call are removed again and an Error is thrown.
export async function uploadPhotos(occurrenceId, blobs) {
  requireSupabase();
  const uploaded = [];
  try {
    for (const blob of blobs) {
      const path = `${occurrenceId}/${uuid()}.jpg`;
      await uploadWithRetry(path, blob);
      uploaded.push(path);
    }
    const { data, error } = await supabase
      .from("task_photos")
      .insert(uploaded.map((storage_path) => ({ occurrence_id: occurrenceId, storage_path })))
      .select();
    if (error) throw new Error(`Couldn't save photos: ${error.message}`);
    return data || [];
  } catch (err) {
    if (uploaded.length) {
      try {
        await removeStorageFiles(uploaded);
      } catch (cleanupErr) {
        console.error("Photo rollback failed", cleanupErr);
      }
    }
    throw err;
  }
}

// --- Viewing --------------------------------------------------------------

const signedUrlCache = new Map(); // path -> { url, expiresAt }

// Signed URLs for private files (bucket stays private). Cached in memory
// until shortly before they expire.
export async function getSignedUrls(paths, expiresIn = 3600) {
  requireSupabase();
  const now = Date.now();
  const result = {};
  const missing = [];
  for (const p of paths) {
    const hit = signedUrlCache.get(p);
    if (hit && hit.expiresAt > now + 60_000) result[p] = hit.url;
    else missing.push(p);
  }
  if (missing.length) {
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(missing, expiresIn);
    if (error) throw new Error(`Couldn't load photos: ${error.message}`);
    for (const item of data || []) {
      if (!item.signedUrl) continue;
      result[item.path] = item.signedUrl;
      signedUrlCache.set(item.path, { url: item.signedUrl, expiresAt: now + expiresIn * 1000 });
    }
  }
  return result;
}

// --- Deletion -------------------------------------------------------------

// Storage API delete, in batches of <= 1000 paths.
export async function removeStorageFiles(paths, batchSize = REMOVE_BATCH) {
  requireSupabase();
  for (const batch of chunk(paths, batchSize)) {
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(batch);
    if (error) throw new Error(`Couldn't delete photos from storage: ${error.message}`);
    batch.forEach((p) => signedUrlCache.delete(p));
  }
}

// rows: [{ id, storage_path }]. Files first (Storage API), then rows.
export async function deletePhotoRows(rows) {
  requireSupabase();
  if (!rows?.length) return;
  await removeStorageFiles(rows.map((r) => r.storage_path));
  for (const ids of chunk(rows.map((r) => r.id), 200)) {
    const { error } = await supabase.from("task_photos").delete().in("id", ids);
    if (error) throw new Error(`Couldn't delete photo records: ${error.message}`);
  }
}

export async function fetchPhotosForOccurrences(occurrenceIds) {
  requireSupabase();
  const rows = [];
  for (const ids of chunk(occurrenceIds, 200)) {
    const { data, error } = await supabase.from("task_photos").select("*").in("occurrence_id", ids);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return rows;
}

export async function deletePhotosForOccurrence(occurrenceId) {
  const rows = await fetchPhotosForOccurrences([occurrenceId]);
  await deletePhotoRows(rows);
}
