// Integration test for the strict Row Level Security in sql/auth/02-lockdown.sql
// (and the signup rules in sql/auth/01-additive.sql).
//
// !! Run it ONLY against a separate TEST Supabase project — never the live one.
// !! It creates (and removes again) tagged rows: equipment, tasks, occurrences,
// !! photos and Storage files. See "Test project setup" in the README.
//
//   node scripts/rls-test.mjs --confirm-test-project
//
// Reads, and only from, .env.development.local (project root):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// plus four accounts YOU created by signing up in the TEST app (set them as
// environment variables, or as extra lines in .env.development.local):
//   TEST_MANAGER_EMAIL / TEST_MANAGER_PASSWORD   (then set users.role = 'manager' in the Table Editor)
//   TEST_STAFF_EMAIL   / TEST_STAFF_PASSWORD     (a normal staff account, company domain)
//
// Prints PASS / FAIL per check and exits non-zero if anything failed.
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.development.local");
const BUCKET = "task-photos";
const FLAG = "--confirm-test-project";

// ---------------------------------------------------------------- config

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    out[m[1]] = value;
  }
  return out;
}

const fileEnv = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
// The project URL/key come ONLY from .env.development.local, never from the
// shell, so an exported production value can't be picked up by accident.
const URL = fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const KEY = fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const account = (name) => process.env[name] || fileEnv[name] || "";
const MANAGER = { email: account("TEST_MANAGER_EMAIL"), password: account("TEST_MANAGER_PASSWORD") };
const STAFF = { email: account("TEST_STAFF_EMAIL"), password: account("TEST_STAFF_PASSWORD") };

if (!URL || !KEY) {
  console.error(`Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in ${ENV_FILE}`);
  process.exit(2);
}
console.log(`Target Supabase project: ${URL}`);
if (!process.argv.includes(FLAG)) {
  console.error(`\nRefusing to run without ${FLAG}.`);
  console.error("This script writes test data. Run it only against your separate TEST project, never the live one.");
  process.exit(2);
}
const missing = ["TEST_MANAGER_EMAIL", "TEST_MANAGER_PASSWORD", "TEST_STAFF_EMAIL", "TEST_STAFF_PASSWORD"]
  .filter((k) => !account(k));
if (missing.length) {
  console.error(`\nMissing: ${missing.join(", ")}`);
  console.error("Create a manager and a staff account by signing up in the TEST app, then set these variables.");
  process.exit(2);
}

// ---------------------------------------------------------------- tiny test kit

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n        ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// "Denied" means the API said no (an error), or it silently matched nothing
// (RLS filters rows instead of erroring for select/update/delete).
function isDenied(res) {
  if (!res || res.error) return true;
  if (res.data == null) return true;
  return Array.isArray(res.data) && res.data.length === 0;
}
function assertDenied(res, what) {
  assert(isDenied(res), `${what} was ALLOWED (got ${JSON.stringify(res.data)?.slice(0, 160)})`);
}
function assertOk(res, what) {
  assert(!res.error, `${what} failed: ${res.error?.message}`);
  assert(res.data != null && !(Array.isArray(res.data) && res.data.length === 0), `${what} changed nothing (blocked silently)`);
}

const newClient = () =>
  createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function signIn(who) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email: who.email, password: who.password });
  if (error) throw new Error(`Could not log in as ${who.email}: ${error.message}`);
  return { client, authId: data.user.id };
}

// A few bytes labelled image/jpeg — the bucket only checks the declared type.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const jpegBlob = () => new Blob([JPEG], { type: "image/jpeg" });

// ---------------------------------------------------------------- run

const tag = `RLSTEST-${Date.now().toString(36)}`;
const created = { equipment: [], tasks: [], files: new Set() }; // for cleanup
let mgr, stf, mgrRow, stfRow;
let anon = newClient();

async function upload(client, p) {
  const res = await client.storage.from(BUCKET).upload(p, jpegBlob(), { contentType: "image/jpeg", upsert: false });
  if (!res.error) created.files.add(p);
  return res;
}
const folderFiles = async (client, folder) => {
  const { data } = await client.storage.from(BUCKET).list(folder);
  return (data || []).filter((f) => f.name && !f.name.startsWith(".")).map((f) => f.name);
};
const getOcc = async (id) => (await mgr.from("task_occurrences").select("*").eq("id", id).maybeSingle()).data;

async function main() {
  // ---- who is who
  const mgrSession = await signIn(MANAGER);
  mgr = mgrSession.client;
  const stfSession = await signIn(STAFF);
  stf = stfSession.client;

  mgrRow = (await mgr.from("users").select("id, name, role, email, auth_user_id").eq("auth_user_id", mgrSession.authId).maybeSingle()).data;
  stfRow = (await stf.from("users").select("id, name, role, email, auth_user_id").eq("auth_user_id", stfSession.authId).maybeSingle()).data;
  if (!mgrRow) throw new Error(`No users row for ${MANAGER.email} — did the signup trigger (01-additive.sql) run?`);
  if (!stfRow) throw new Error(`No users row for ${STAFF.email} — did the signup trigger (01-additive.sql) run?`);
  if (mgrRow.role !== "manager") throw new Error(`${MANAGER.email} has role "${mgrRow.role}". Set users.role = 'manager' for it in the Table Editor first (Manager reads can't be tested otherwise).`);
  if (stfRow.role !== "staff") throw new Error(`${STAFF.email} has role "${stfRow.role}", expected "staff".`);
  if (mgrRow.id === stfRow.id) throw new Error("The manager and staff accounts must be different people.");
  console.log(`Manager: ${mgrRow.email} (users.id ${mgrRow.id})\nStaff:   ${stfRow.email} (users.id ${stfRow.id})\nTag:     ${tag}\n`);

  // ---- fixtures, created as the manager
  const eq = (await mgr.from("equipment").insert({ equipment_name: `${tag} equipment` }).select().single()).data;
  assert(eq, "setup: manager could not create equipment — is 02-lockdown.sql too strict, or the manager role not set?");
  created.equipment.push(eq.id);
  const mkTask = async (name, assignee) => {
    const res = await mgr.from("maintenance_tasks")
      .insert({ equipment_id: eq.id, task_name: `${tag} ${name}`, assigned_to: assignee, frequency: "once", start_date: "2099-01-01" })
      .select().single();
    assert(res.data, `setup: could not create task "${name}": ${res.error?.message}`);
    created.tasks.push(res.data.id);
    return res.data;
  };
  const taskOwn = await mkTask("own task", stfRow.id); // assigned to the staff account
  const taskOther = await mkTask("other task", mgrRow.id); // assigned to someone else
  const occRes = await mgr.from("task_occurrences").insert([
    { task_id: taskOwn.id, due_date: "2099-01-01" }, // A — submit + approve
    { task_id: taskOwn.id, due_date: "2099-01-02" }, // B — forbidden changes
    { task_id: taskOwn.id, due_date: "2099-01-03" }, // C — rejected by the manager
    { task_id: taskOther.id, due_date: "2099-01-01" }, // X — not the staff member's
  ]).select();
  assert(occRes.data?.length === 4, `setup: could not create occurrences: ${occRes.error?.message}`);
  const occ = (task, date) => occRes.data.find((o) => o.task_id === task.id && o.due_date === date);
  const occA = occ(taskOwn, "2099-01-01");
  const occB = occ(taskOwn, "2099-01-02");
  const occC = occ(taskOwn, "2099-01-03");
  const occX = occ(taskOther, "2099-01-01");
  const otherPath = `${occX.id}/other.jpg`;
  assert(!(await upload(mgr, otherPath)).error, "setup: manager could not upload a photo");
  const otherPhoto = (await mgr.from("task_photos").insert({ occurrence_id: occX.id, storage_path: otherPath }).select().single()).data;
  assert(otherPhoto, "setup: manager could not insert a task_photos row");

  // ================= anon (not logged in)
  console.log("-- anon (not logged in)");
  for (const table of ["users", "equipment", "maintenance_tasks", "task_occurrences", "task_photos"]) {
    await check(`anon cannot read ${table}`, async () => assertDenied(await anon.from(table).select("id"), `reading ${table}`));
  }
  await check("anon cannot list the task-photos bucket", async () => {
    assertDenied(await anon.storage.from(BUCKET).list(occX.id), "listing a photo folder");
    assertDenied(await anon.storage.from(BUCKET).list(""), "listing the bucket root");
  });
  await check("anon cannot get a signed URL / upload / delete", async () => {
    assertDenied(await anon.storage.from(BUCKET).createSignedUrl(otherPath, 60), "creating a signed URL");
    const up = await upload(anon, `${occA.id}/anon.jpg`);
    assert(up.error, "anon upload was ALLOWED");
    assertDenied(await anon.storage.from(BUCKET).remove([otherPath]), "deleting a file");
    assert((await folderFiles(mgr, occX.id)).includes("other.jpg"), "the file is gone after anon tried to delete it");
  });
  await check("anon cannot write any table", async () => {
    assertDenied(await anon.from("equipment").insert({ equipment_name: `${tag} anon` }).select(), "anon insert");
    assertDenied(await anon.from("equipment").update({ location: "anon" }).eq("id", eq.id).select(), "anon update");
    assertDenied(await anon.from("maintenance_tasks").delete().eq("id", taskOwn.id).select(), "anon delete");
    assertDenied(await anon.from("task_occurrences").update({ status: "Completed" }).eq("id", occB.id).select(), "anon status change");
    const still = (await mgr.from("equipment").select("location").eq("id", eq.id).maybeSingle()).data;
    assert(still && still.location == null, "equipment was modified by anon");
    assert((await getOcc(occB.id)).status === "Pending", "occurrence was modified by anon");
  });

  // ================= staff
  console.log("\n-- staff (reads)");
  await check("staff sees only their own tasks", async () => {
    const { data, error } = await stf.from("maintenance_tasks").select("id, assigned_to");
    assert(!error, error?.message);
    assert(data.every((t) => t.assigned_to === stfRow.id), "staff can see a task assigned to someone else");
    assert(data.some((t) => t.id === taskOwn.id), "staff cannot see their own task");
    assert(!data.some((t) => t.id === taskOther.id), "staff can see the other person's task");
  });
  await check("staff sees only their own occurrences", async () => {
    const { data: tasks } = await stf.from("maintenance_tasks").select("id");
    const ownIds = new Set(tasks.map((t) => t.id));
    const { data, error } = await stf.from("task_occurrences").select("id, task_id");
    assert(!error, error?.message);
    assert(data.every((o) => ownIds.has(o.task_id)), "staff can see an occurrence of someone else's task");
    for (const o of [occA, occB, occC]) assert(data.some((x) => x.id === o.id), "staff cannot see their own occurrence");
    assert(!data.some((x) => x.id === occX.id), "staff can see the other person's occurrence");
  });
  await check("staff cannot read another person's task / occurrence / photo by id", async () => {
    assertDenied(await stf.from("maintenance_tasks").select("*").eq("id", taskOther.id), "reading someone else's task");
    assertDenied(await stf.from("task_occurrences").select("*").eq("id", occX.id), "reading someone else's occurrence");
    assertDenied(await stf.from("task_photos").select("*").eq("id", otherPhoto.id), "reading someone else's photo row");
    const { data } = await stf.from("task_photos").select("occurrence_id");
    assert(!(data || []).some((p) => p.occurrence_id === occX.id), "staff can list someone else's photo rows");
  });
  await check("staff sees only their own users row, but can read equipment", async () => {
    const { data, error } = await stf.from("users").select("id");
    assert(!error, error?.message);
    assert(data.length === 1 && data[0].id === stfRow.id, `staff sees ${data.length} users rows (expected only their own)`);
    const equipment = await stf.from("equipment").select("id").eq("id", eq.id);
    assert(equipment.data?.length === 1, "staff cannot read equipment");
  });

  console.log("\n-- staff (writes that must be refused)");
  await check("staff cannot create / change / delete tasks", async () => {
    const ins = await stf.from("maintenance_tasks").insert({ task_name: `${tag} hack`, assigned_to: stfRow.id }).select();
    if (ins.data?.[0]) created.tasks.push(ins.data[0].id);
    assertDenied(ins, "creating a task");
    assertDenied(await stf.from("maintenance_tasks").update({ task_name: "pwned" }).eq("id", taskOwn.id).select(), "editing own task");
    assertDenied(await stf.from("maintenance_tasks").update({ assigned_to: stfRow.id }).eq("id", taskOther.id).select(), "taking over another task");
    assertDenied(await stf.from("maintenance_tasks").delete().eq("id", taskOwn.id).select(), "deleting a task");
    const t = (await mgr.from("maintenance_tasks").select("task_name").eq("id", taskOwn.id).maybeSingle()).data;
    assert(t && t.task_name === `${tag} own task`, "the task was changed or deleted");
  });
  await check("staff cannot create / change / delete equipment", async () => {
    assertDenied(await stf.from("equipment").insert({ equipment_name: `${tag} staff` }).select(), "creating equipment");
    assertDenied(await stf.from("equipment").update({ location: "staff" }).eq("id", eq.id).select(), "editing equipment");
    assertDenied(await stf.from("equipment").delete().eq("id", eq.id).select(), "deleting equipment");
    const e = (await mgr.from("equipment").select("equipment_name, location").eq("id", eq.id).maybeSingle()).data;
    assert(e && e.location == null, "equipment was changed or deleted");
  });
  await check("staff cannot create / change / delete users — including their own role", async () => {
    assertDenied(await stf.from("users").update({ role: "manager" }).eq("id", stfRow.id).select(), "changing own role to manager");
    assertDenied(await stf.from("users").update({ name: "pwned" }).eq("id", stfRow.id).select(), "changing own name");
    assertDenied(await stf.from("users").update({ role: "manager" }).eq("id", mgrRow.id).select(), "changing someone else's role");
    assertDenied(await stf.from("users").insert({ name: `${tag} user`, role: "manager" }).select(), "inserting a manager user");
    assertDenied(await stf.from("users").delete().eq("id", stfRow.id).select(), "deleting own user row");
    const u = (await mgr.from("users").select("name, role").eq("id", stfRow.id).maybeSingle()).data;
    assert(u && u.role === "staff" && u.name === stfRow.name, "the staff user row was changed");
  });
  await check("staff cannot set an occurrence to Completed or Rejected", async () => {
    assertDenied(await stf.from("task_occurrences").update({ status: "Completed" }).eq("id", occB.id).select(), "setting Completed");
    assertDenied(await stf.from("task_occurrences").update({ status: "Rejected" }).eq("id", occB.id).select(), "setting Rejected");
    assertDenied(await stf.from("task_occurrences").update({ status: "Completed", completed_at: new Date().toISOString() }).eq("id", occB.id).select(), "setting Completed + completed_at");
    assert((await getOcc(occB.id)).status === "Pending", "the occurrence status changed");
  });
  await check("staff cannot modify reviewed_by / completed_at / review_note / other protected fields", async () => {
    const before = await getOcc(occB.id);
    const attempts = {
      reviewed_by: mgrRow.id,
      completed_at: new Date().toISOString(),
      review_note: "approved by me",
      reviewed_at: new Date().toISOString(),
      rejection_count: 9,
      photos_purged_at: new Date().toISOString(),
      due_date: "2099-12-31",
      task_id: taskOther.id,
      submitted_at: new Date().toISOString(),
    };
    for (const [field, value] of Object.entries(attempts)) {
      assertDenied(await stf.from("task_occurrences").update({ [field]: value }).eq("id", occB.id).select(), `changing ${field}`);
    }
    const after = await getOcc(occB.id);
    for (const field of Object.keys(attempts)) {
      assert(JSON.stringify(after[field]) === JSON.stringify(before[field]), `${field} was changed`);
    }
  });
  await check("staff cannot change or delete occurrences they don't own, or delete their own", async () => {
    assertDenied(await stf.from("task_occurrences").update({ remarks: "x" }).eq("id", occX.id).select(), "editing someone else's occurrence");
    assertDenied(await stf.from("task_occurrences").delete().eq("id", occB.id).select(), "deleting an occurrence");
    assertDenied(await stf.from("task_occurrences").delete().eq("id", occX.id).select(), "deleting someone else's occurrence");
    assert(await getOcc(occB.id) && await getOcc(occX.id), "an occurrence was deleted");
  });
  await check("staff cannot add a photo row or upload to someone else's occurrence / folder", async () => {
    assertDenied(await stf.from("task_photos").insert({ occurrence_id: occX.id, storage_path: `${occX.id}/evil.jpg` }).select(), "inserting a photo row for another occurrence");
    const up = await upload(stf, `${occX.id}/evil.jpg`);
    assert(up.error, "uploading into someone else's folder was ALLOWED");
    assert(!(await folderFiles(mgr, occX.id)).includes("evil.jpg"), "the evil file exists");
  });
  await check("staff cannot read, sign or delete files in someone else's folder", async () => {
    assertDenied(await stf.storage.from(BUCKET).list(occX.id), "listing another folder");
    assertDenied(await stf.storage.from(BUCKET).createSignedUrl(otherPath, 60), "signing another file");
    assertDenied(await stf.storage.from(BUCKET).remove([otherPath]), "deleting another file");
    assert((await folderFiles(mgr, occX.id)).includes("other.jpg"), "the other person's file is gone");
    const files = await upload(stf, "not-a-uuid/x.jpg");
    assert(files.error, "uploading into a non-uuid folder was ALLOWED");
  });

  console.log("\n-- staff (what they CAN do)");
  await check("staff can set In Progress + remarks on an own, editable occurrence", async () => {
    assertOk(await stf.from("task_occurrences").update({ status: "In Progress", remarks: "started" }).eq("id", occB.id).select(), "In Progress update");
    assert((await getOcc(occB.id)).status === "In Progress", "status not saved");
  });
  await check("staff can create their own blank Pending occurrence (lazy generation), incl. ignore-duplicates upsert", async () => {
    assertOk(await stf.from("task_occurrences").insert({ task_id: taskOwn.id, due_date: "2099-02-01" }).select(), "own Pending insert");
    const up = await stf.from("task_occurrences")
      .upsert([{ task_id: taskOwn.id, due_date: "2099-02-01" }, { task_id: taskOwn.id, due_date: "2099-02-02" }], { onConflict: "task_id,due_date", ignoreDuplicates: true })
      .select();
    assert(!up.error, `upsert (ignore duplicates) failed: ${up.error?.message}`);
  });
  await check("staff cannot create occurrences that are Completed, pre-reviewed, or for someone else's task", async () => {
    assertDenied(await stf.from("task_occurrences").insert({ task_id: taskOwn.id, due_date: "2099-03-01", status: "Completed" }).select(), "insert as Completed");
    assertDenied(await stf.from("task_occurrences").insert({ task_id: taskOwn.id, due_date: "2099-03-02", reviewed_by: mgrRow.id }).select(), "insert with reviewed_by");
    assertDenied(await stf.from("task_occurrences").insert({ task_id: taskOwn.id, due_date: "2099-03-03", completed_at: new Date().toISOString() }).select(), "insert with completed_at");
    assertDenied(await stf.from("task_occurrences").insert({ task_id: taskOther.id, due_date: "2099-03-04" }).select(), "insert for someone else's task");
  });

  // --- submit flow on occurrence A
  const pathA = `${occA.id}/staff-1.jpg`;
  await check("staff can upload a photo and add its row on an own, editable occurrence", async () => {
    const up = await upload(stf, pathA);
    assert(!up.error, `upload failed: ${up.error?.message}`);
    assertOk(await stf.from("task_photos").insert({ occurrence_id: occA.id, storage_path: pathA }).select(), "photo row insert");
    assert((await stf.storage.from(BUCKET).createSignedUrl(pathA, 60)).data?.signedUrl, "staff cannot get a signed URL for their own photo");
    const { data } = await stf.from("task_photos").select("occurrence_id").eq("occurrence_id", occA.id);
    assert(data?.length === 1, "staff cannot see their own photo row");
  });
  await check("staff can submit for review (Awaiting Review); submitted_at comes from the server", async () => {
    const res = await stf.from("task_occurrences")
      .update({ status: "Awaiting Review", submitted_at: "2000-01-01T00:00:00Z", remarks: "all done" })
      .eq("id", occA.id).select();
    assertOk(res, "submit for review");
    const row = res.data[0];
    assert(row.status === "Awaiting Review", `status is ${row.status}`);
    const ageMs = Math.abs(Date.now() - Date.parse(row.submitted_at));
    assert(ageMs < 10 * 60 * 1000, `submitted_at (${row.submitted_at}) was not set by the server clock`);
  });
  await check("after submitting, staff can no longer edit, add or remove photos, or change status", async () => {
    assertDenied(await stf.from("task_occurrences").update({ remarks: "changed my mind" }).eq("id", occA.id).select(), "editing remarks");
    assertDenied(await stf.from("task_occurrences").update({ status: "In Progress" }).eq("id", occA.id).select(), "going back to In Progress");
    assertDenied(await stf.from("task_photos").insert({ occurrence_id: occA.id, storage_path: `${occA.id}/late.jpg` }).select(), "adding a photo row");
    assert((await upload(stf, `${occA.id}/late.jpg`)).error, "uploading after submit was ALLOWED");
    assertDenied(await stf.from("task_photos").delete().eq("occurrence_id", occA.id).select(), "deleting the photo row");
    assertDenied(await stf.storage.from(BUCKET).remove([pathA]), "deleting the photo file");
    assert((await folderFiles(mgr, occA.id)).includes("staff-1.jpg"), "the photo file is gone");
    const row = await getOcc(occA.id);
    assert(row.remarks === "all done" && row.status === "Awaiting Review", "the submitted occurrence changed");
  });

  // ================= manager
  console.log("\n-- manager");
  await check("manager can read all tasks, occurrences, photos, users and Storage folders", async () => {
    const tasks = (await mgr.from("maintenance_tasks").select("id")).data || [];
    assert(tasks.some((t) => t.id === taskOwn.id) && tasks.some((t) => t.id === taskOther.id), "manager cannot see all tasks");
    const occs = (await mgr.from("task_occurrences").select("id")).data || [];
    for (const o of [occA, occB, occC, occX]) assert(occs.some((x) => x.id === o.id), "manager cannot see all occurrences");
    const photos = (await mgr.from("task_photos").select("id")).data || [];
    assert(photos.some((p) => p.id === otherPhoto.id), "manager cannot see all photo rows");
    const users = (await mgr.from("users").select("id")).data || [];
    assert(users.some((u) => u.id === stfRow.id) && users.some((u) => u.id === mgrRow.id), "manager cannot see all users");
    assert((await folderFiles(mgr, occA.id)).includes("staff-1.jpg"), "manager cannot list the staff photo");
    assert((await mgr.storage.from(BUCKET).createSignedUrl(pathA, 60)).data?.signedUrl, "manager cannot sign the staff photo");
  });
  await check("manager can create, edit and delete equipment and tasks", async () => {
    const e = (await mgr.from("equipment").insert({ equipment_name: `${tag} temp equipment` }).select().single()).data;
    assert(e, "creating equipment failed");
    created.equipment.push(e.id);
    assertOk(await mgr.from("equipment").update({ location: "Lobby" }).eq("id", e.id).select(), "editing equipment");
    const t = (await mgr.from("maintenance_tasks").insert({ equipment_id: e.id, task_name: `${tag} temp task`, assigned_to: stfRow.id }).select().single()).data;
    assert(t, "creating a task failed");
    created.tasks.push(t.id);
    assertOk(await mgr.from("maintenance_tasks").update({ enabled: false }).eq("id", t.id).select(), "editing a task");
    assertOk(await mgr.from("maintenance_tasks").delete().eq("id", t.id).select(), "deleting a task");
    assertOk(await mgr.from("equipment").delete().eq("id", e.id).select(), "deleting equipment");
  });
  await check("manager approves: Completed, and reviewed_by is forced to the manager's own users.id", async () => {
    const now = new Date().toISOString();
    const res = await mgr.from("task_occurrences")
      .update({ status: "Completed", completed_at: now, reviewed_at: now, reviewed_by: stfRow.id }) // a lie on purpose
      .eq("id", occA.id).eq("status", "Awaiting Review").select();
    assertOk(res, "approve");
    assert(res.data[0].status === "Completed", "status is not Completed");
    assert(res.data[0].reviewed_by === mgrRow.id, `reviewed_by is ${res.data[0].reviewed_by}, expected the manager (${mgrRow.id})`);
  });
  await check("after approval staff can see it as Completed but cannot reopen or edit it", async () => {
    const seen = (await stf.from("task_occurrences").select("status").eq("id", occA.id).maybeSingle()).data;
    assert(seen?.status === "Completed", "staff cannot see the completed occurrence");
    assertDenied(await stf.from("task_occurrences").update({ status: "In Progress" }).eq("id", occA.id).select(), "reopening");
    assertDenied(await stf.from("task_occurrences").update({ remarks: "edit" }).eq("id", occA.id).select(), "editing");
    assert((await getOcc(occA.id)).status === "Completed", "the completed occurrence changed");
  });

  // --- reject flow on occurrence C
  const pathC = `${occC.id}/staff-c1.jpg`;
  await check("manager rejects: photos are removed (files + rows), status Rejected with a note", async () => {
    // staff submits C first
    assert(!(await upload(stf, pathC)).error, "setup: staff upload to C failed");
    assertOk(await stf.from("task_photos").insert({ occurrence_id: occC.id, storage_path: pathC }).select(), "setup: photo row for C");
    assertOk(await stf.from("task_occurrences").update({ status: "Awaiting Review", remarks: "C done" }).eq("id", occC.id).select(), "setup: submit C");
    // manager reviews like lib/data.js reviewTask(reject)
    const rows = (await mgr.from("task_photos").select("id, storage_path").eq("occurrence_id", occC.id)).data;
    assert(rows.length === 1, "manager cannot see the photo to reject");
    assertOk(await mgr.storage.from(BUCKET).remove(rows.map((r) => r.storage_path)), "removing rejected files");
    assertOk(await mgr.from("task_photos").delete().in("id", rows.map((r) => r.id)).select(), "removing rejected photo rows");
    created.files.delete(pathC);
    const now = new Date().toISOString();
    assertOk(await mgr.from("task_occurrences")
      .update({ status: "Rejected", review_note: "Please redo", reviewed_at: now, reviewed_by: mgrRow.id, rejection_count: 1, submitted_at: null })
      .eq("id", occC.id).eq("status", "Awaiting Review").select(), "reject");
    assert((await folderFiles(mgr, occC.id)).length === 0, "rejected photo files are still in Storage");
    const row = await getOcc(occC.id);
    assert(row.status === "Rejected" && row.review_note === "Please redo" && row.rejection_count === 1, "rejection not recorded");
  });
  await check("after rejection staff can save remarks (status stays Rejected) but cannot self-complete", async () => {
    const res = await stf.from("task_occurrences").update({ remarks: "fixing it" }).eq("id", occC.id).select();
    assertOk(res, "saving remarks on a Needs Correction task");
    assert(res.data[0].status === "Rejected", "status changed");
    assertDenied(await stf.from("task_occurrences").update({ status: "Completed" }).eq("id", occC.id).select(), "completing a rejected task");
    assertDenied(await stf.from("task_occurrences").update({ review_note: "never mind" }).eq("id", occC.id).select(), "editing the review note");
  });
  await check("staff can add fresh photos to a Rejected occurrence and resubmit; it is locked again", async () => {
    const p = `${occC.id}/staff-c2.jpg`;
    assert(!(await upload(stf, p)).error, "upload to a Rejected occurrence failed");
    assertOk(await stf.from("task_photos").insert({ occurrence_id: occC.id, storage_path: p }).select(), "photo row");
    assertOk(await stf.from("task_occurrences").update({ status: "Awaiting Review", submitted_at: null }).eq("id", occC.id).select(), "resubmit");
    assertDenied(await stf.from("task_occurrences").update({ remarks: "again" }).eq("id", occC.id).select(), "editing after resubmit");
    assert((await getOcc(occC.id)).submitted_at != null, "submitted_at was not set by the server on resubmit");
  });

  // --- signup rules
  console.log("\n-- signup");
  const domain = STAFF.email.split("@")[1];
  await check("signup with a non-company domain is rejected (and creates nothing)", async () => {
    const email = `rls-test-${tag.toLowerCase()}@example.com`;
    const { data, error } = await newClient().auth.signUp({ email, password: "RlsTest-Pass-12345" });
    assert(error, "signup with a non-company address was ALLOWED");
    assert(!data?.session, "a session was issued for a non-company address");
    assert(/company email|database error saving new user/i.test(error.message), `rejected, but with an unexpected message: "${error.message}"`);
    assert(!((await mgr.from("users").select("id").eq("email", email)).data || []).length, "a users row was created for the rejected address");
  });
  await check("signup with a company-domain address creates a staff users row linked to the new login", async () => {
    // One fixed address, re-used on every run (a public-key client can't delete auth users),
    // so repeated runs never pile up accounts.
    const email = `rls-test-signup@${domain}`;
    const password = "RlsTest-Pass-12345";
    const client = newClient();
    let { data, error } = await client.auth.signUp({ email, password });
    if (error && /already (been )?registered|already exists/i.test(error.message)) {
      ({ data, error } = await client.auth.signInWithPassword({ email, password }));
      assert(!error, `${email} exists from an earlier run but can't log in: ${error?.message}`);
    } else {
      assert(!error, `company-domain signup failed: ${error?.message}`);
    }
    assert(data.session, 'no session returned — is "Confirm email" still ON in the TEST project? (Authentication → Sign In / Providers → Email)');
    const row = (await client.from("users").select("id, name, role, email, auth_user_id").eq("auth_user_id", data.user.id).maybeSingle()).data;
    assert(row, "no users row was created for the new account");
    assert(row.role === "staff", `new account has role "${row.role}", expected "staff"`);
    assert(row.auth_user_id === data.user.id, "auth_user_id is not set");
    assert(row.email === email, `email is "${row.email}", expected "${email}"`);
    assert(row.name === "rls-test-signup", `name is "${row.name}", expected the part before @`);
    assert(((await mgr.from("users").select("id").eq("id", row.id)).data || []).length === 1, "manager cannot see the new users row");
    assert(((await mgr.from("users").select("id").eq("email", email)).data || []).length === 1, "more than one users row exists for this email");
    leftoverEmails.push(email);
  });
}

// ---------------------------------------------------------------- cleanup

const leftoverEmails = [];

async function cleanup() {
  if (!mgr) return;
  console.log("\n-- cleanup");
  let ok = true;
  const step = async (label, fn) => {
    try {
      const err = await fn();
      if (err) throw new Error(err);
    } catch (e) {
      ok = false;
      console.log(`FAIL  cleanup: ${label}: ${e.message}`);
    }
  };

  // 1. Storage files: every folder of every test occurrence, plus anything tracked.
  await step("storage files", async () => {
    const occs = created.tasks.length
      ? ((await mgr.from("task_occurrences").select("id").in("task_id", created.tasks)).data || [])
      : [];
    const paths = new Set(created.files);
    for (const o of occs) for (const name of await folderFiles(mgr, o.id)) paths.add(`${o.id}/${name}`);
    if (paths.size) {
      const { error } = await mgr.storage.from(BUCKET).remove([...paths]);
      if (error) return error.message;
    }
  });
  // 2. Tasks (the database cascades their occurrences and photo rows), then equipment.
  await step("tasks", async () => {
    if (created.tasks.length) return (await mgr.from("maintenance_tasks").delete().in("id", created.tasks)).error?.message;
  });
  await step("equipment", async () => {
    if (created.equipment.length) return (await mgr.from("equipment").delete().in("id", created.equipment)).error?.message;
  });
  // 3. Prove it's gone.
  await step("verify nothing is left", async () => {
    const left = [];
    if (created.tasks.length) {
      const t = (await mgr.from("maintenance_tasks").select("id").in("id", created.tasks)).data || [];
      const o = (await mgr.from("task_occurrences").select("id").in("task_id", created.tasks)).data || [];
      if (t.length) left.push(`${t.length} task(s)`);
      if (o.length) left.push(`${o.length} occurrence(s)`);
    }
    if (created.equipment.length) {
      const e = (await mgr.from("equipment").select("id").in("id", created.equipment)).data || [];
      if (e.length) left.push(`${e.length} equipment row(s)`);
    }
    if (left.length) return `still present: ${left.join(", ")}`;
  });
  if (ok) console.log("PASS  everything this script created (tasks, occurrences, photos, Storage files, equipment) was removed");
  else failed++;

  if (leftoverEmails.length) {
    console.log("\nNOTE: the sign-up check uses a real test login, which a public-key script cannot delete:");
    for (const e of leftoverEmails) console.log(`  ${e}  (re-used on every run, so at most one exists)`);
    console.log("To remove it from the TEST project (SQL Editor):");
    for (const e of leftoverEmails) {
      console.log(`  delete from auth.users where email = '${e}';`);
      console.log(`  delete from public.users where email = '${e}';`);
    }
  }
}

// ---------------------------------------------------------------- go

try {
  await main();
} catch (err) {
  failed++;
  console.log(`FAIL  test run aborted: ${err.message}`);
}
try {
  await cleanup();
} catch (err) {
  failed++;
  console.log(`FAIL  cleanup crashed: ${err.message}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
