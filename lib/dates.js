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

// Returns an inclusive [from, to] date-string range for a named period,
// anchored on today. Shared by the dashboard filter bar and the reports page
// so "Last 7 Days" etc. mean the same thing everywhere.
export function periodRange(period) {
  const to = new Date();
  const from = new Date();
  switch (period) {
    case "today":
      break;
    case "7d":
      from.setDate(from.getDate() - 6);
      break;
    case "30d":
      from.setDate(from.getDate() - 29);
      break;
    case "month":
      from.setDate(1);
      break;
    default:
      break;
  }
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
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
