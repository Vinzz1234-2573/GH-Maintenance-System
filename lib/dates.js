// Every "YYYY-MM-DD" string in this app is a LOCAL calendar date. Never
// build one with toISOString() — that converts to UTC first, which shifts
// the date a day early east of Greenwich (e.g. Malaysia, UTC+8, before
// 08:00) and a day late west of it. Date-string arithmetic below goes
// through Date.UTC + getUTC* so it is timezone-independent.

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Local calendar date of a Date object.
export function toDateStr(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayStr(now = new Date()) {
  return toDateStr(now);
}

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

// "2026-10-31", 1 -> "2026-11-01". Pure string-in/string-out.
export function addDays(dateStr, n) {
  const { y, m, d } = parseDateStr(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

// ISO weekday numbering: Monday = 1 ... Sunday = 7.
export function isoWeekday(dateStr) {
  const { y, m, d } = parseDateStr(dateStr);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

export function daysInMonth(year, month /* 1-12 */) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function nowHHMM() {
  return new Date().toTimeString().slice(0, 5);
}

export function isPastHHMM(hhmm) {
  if (!hhmm) return false;
  return nowHHMM() > hhmm;
}

// Returns an inclusive [from, to] date-string range for a named preset,
// anchored on today. "week" is Mon-Sun (matching lib/schedule.js's ISO
// weekday numbering); "custom" is handled by the caller, not here.
// `now` is injectable for scripts/test-dates.mjs.
export function periodRange(period, now = new Date()) {
  const today = todayStr(now);
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "tomorrow": {
      const d = addDays(today, 1);
      return { from: d, to: d };
    }
    case "week": {
      const monday = addDays(today, -(isoWeekday(today) - 1));
      return { from: monday, to: addDays(monday, 6) };
    }
    case "month": {
      const { y, m } = parseDateStr(today);
      return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}` };
    }
    default:
      return { from: today, to: today };
  }
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// Compact "8 Sept" style, no year — for mobile task cards where space is tight.
export function formatDayMonth(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// "Today" / "Tomorrow" / "Monday" (for the next few days) / falls back to
// "8 Sept" further out — used on staff task cards and the Upcoming list.
export function relativeDateLabel(dateStr) {
  if (!dateStr) return "";
  const today = todayStr();
  if (dateStr === today) return "Today";
  const diffDays = Math.round((new Date(dateStr + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000);
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 1 && diffDays <= 6) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" });
  }
  return formatDayMonth(dateStr);
}

// "14:00" -> "2:00 PM"
export function formatHHMM(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
