import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { normalizeEmail } from "./authHelpers";

// The single seam between the app and Supabase Auth. Pages never touch
// supabase.auth directly: they call these functions and get back
//
//   { id, authId, name, email, role }
//
// where `id` is the public.users row id (what maintenance_tasks.assigned_to
// and task_occurrences.reviewed_by point at) and `authId` is the Supabase
// Auth user id (auth.uid()). The role comes from the DATABASE (the users row
// linked to the login), never from anything the browser can edit — and the
// database enforces it too (see sql/auth/02-lockdown.sql).

export const HOME_BY_ROLE = { manager: "/manager", staff: "/staff" };

export function homeFor(role) {
  return HOME_BY_ROLE[role] || "/login";
}

const NOT_CONFIGURED = {
  message: "Supabase is not connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.",
};

// In-memory only (gone on reload): saves the layout + page each repeating
// the same two requests. Cleared on sign-in/out and when the login changes.
let cached = null; // { authId, user }
let watching = false;

function watchAuthChanges() {
  if (watching || !supabase || typeof window === "undefined") return;
  watching = true;
  supabase.auth.onAuthStateChange((event, session) => {
    if (!session || cached?.authId !== session.user?.id) cached = null;
  });
}

function isNetworkError(error) {
  return error?.name === "AuthRetryableFetchError" || error?.status === 0 || /failed to fetch|fetch failed|network/i.test(error?.message || "");
}

// Who is logged in right now?
//   { user, reason }
//   user   — the object above, or null
//   reason — null when signed in, otherwise one of:
//     "not-configured"  Supabase env vars missing
//     "signed-out"      no (valid) login
//     "no-profile"      logged in, but no users row is linked to the login
//                       (the signup trigger failed) — callers should sign out
//     "error"           couldn't check (network / database); `message` says why
export async function loadSession() {
  if (!isSupabaseConfigured) return { user: null, reason: "not-configured" };
  watchAuthChanges();

  // getUser() asks the server, so a deleted/disabled account is noticed.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    cached = null;
    if (error && isNetworkError(error)) return { user: null, reason: "error", message: error.message };
    // A stale token the server rejects: clear it so we don't keep tripping over it.
    if (error && error.name !== "AuthSessionMissingError") {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    }
    return { user: null, reason: "signed-out" };
  }

  const authUser = data.user;
  if (cached?.authId === authUser.id) return { user: cached.user, reason: null };

  const { data: row, error: rowError } = await supabase
    .from("users")
    .select("id, name, email, role")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();
  if (rowError) return { user: null, reason: "error", message: rowError.message };
  if (!row || !HOME_BY_ROLE[row.role]) return { user: null, reason: "no-profile" };

  const user = { id: row.id, authId: authUser.id, name: row.name, email: row.email || authUser.email || "", role: row.role };
  cached = { authId: authUser.id, user };
  return { user, reason: null };
}

// Just the user (or null) — for pages that only need to know who it is.
export async function getSession() {
  return (await loadSession()).user;
}

// Each returns { error } (a Supabase auth error, or null).
export async function signIn(email, password) {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED };
  cached = null;
  const { error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
  return { error };
}

// With "Confirm email" OFF the new account is logged in straight away. If
// confirmation is ever turned ON there is no session yet: needsConfirmation.
export async function signUp(email, password) {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED, needsConfirmation: false };
  cached = null;
  const { data, error } = await supabase.auth.signUp({ email: normalizeEmail(email), password });
  if (error) return { error, needsConfirmation: false };
  return { error: null, needsConfirmation: !data?.session };
}

// Ends this browser's session (not the person's logins on other devices).
export async function signOut() {
  cached = null;
  if (!supabase) return;
  await supabase.auth.signOut({ scope: "local" });
}

// Calls back with (event, authId) on every auth change, including a
// sign-out in another tab. Returns an unsubscribe function.
export function onSessionChange(callback) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // Supabase can deadlock if its own methods are awaited inside this
    // callback, so hand off to the next tick first.
    setTimeout(() => callback(event, session?.user?.id ?? null), 0);
  });
  return () => data.subscription.unsubscribe();
}
