export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function nowHHMM() {
  return new Date().toTimeString().slice(0, 5);
}

export function isPastHHMM(hhmm) {
  if (!hhmm) return false;
  return nowHHMM() > hhmm;
}

function toStr(d) {
  return d.toISOString().slice(0, 10);
}

// Returns an inclusive [from, to] date-string range for a named preset,
// anchored on today. "week" is Mon-Sun (matching lib/schedule.js's ISO
// weekday numbering); "custom" is handled by the caller, not here.
export function periodRange(period) {
  const today = new Date();
  switch (period) {
    case "today":
      return { from: toStr(today), to: toStr(today) };
    case "tomorrow": {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return { from: toStr(d), to: toStr(d) };
    }
    case "week": {
      const isoDay = today.getDay() === 0 ? 7 : today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (isoDay - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: toStr(monday), to: toStr(sunday) };
    }
    case "month": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: toStr(first), to: toStr(last) };
    }
    default:
      return { from: toStr(today), to: toStr(today) };
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
