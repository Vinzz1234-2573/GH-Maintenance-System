// Simple name-based "session" — no password yet. The signed-in user is
// just kept in localStorage as { id, name, role }. This is intentionally
// not secure (anyone can edit localStorage) — it exists so the app has a
// single, obvious place to swap in real Supabase Auth later without
// touching every page: replace getSession/setSession/clearSession with
// calls to supabase.auth, and the rest of the app (which only ever reads
// getSession()) keeps working.
const KEY = "gh_maintenance_session";

export function getSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(user) {
  window.localStorage.setItem(KEY, JSON.stringify(user));
}

export function clearSession() {
  window.localStorage.removeItem(KEY);
}
