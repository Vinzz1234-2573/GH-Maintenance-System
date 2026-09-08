import { todayStr } from "./dates";

export const FREQUENCIES = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// ISO weekday numbering: Monday = 1 ... Sunday = 7.
export const WEEKDAYS = [
  { value: 1, label: "Mon", full: "Monday" }, { value: 2, label: "Tue", full: "Tuesday" },
  { value: 3, label: "Wed", full: "Wednesday" }, { value: 4, label: "Thu", full: "Thursday" },
  { value: 5, label: "Fri", full: "Friday" }, { value: 6, label: "Sat", full: "Saturday" },
  { value: 7, label: "Sun", full: "Sunday" },
];

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Friendly recurrence phrase for staff-facing cards, e.g. "Every Monday,
// Wednesday" or "Every 1st of the month" — distinct from scheduleSummary()
// below, which is the more compact manager-facing table version.
export function friendlyPattern(task) {
  switch (task.frequency) {
    case "daily":
      return "Every day";
    case "weekly": {
      const days = (task.weekly_days || [])
        .slice().sort()
        .map((v) => WEEKDAYS.find((w) => w.value === v)?.full)
        .filter(Boolean);
      return days.length ? `Every ${days.join(", ")}` : "Weekly";
    }
    case "monthly":
      return task.monthly_day ? `Every ${ordinal(task.monthly_day)} of the month` : "Monthly";
    default:
      return "One-time";
  }
}

const EMOJI_RULES = [
  [/clean|lobby|floor|ceiling/i, "🧹"],
  [/air.?con|aircon|a\/c|fan/i, "🔧"],
  [/door/i, "🚪"],
  [/water|pump|drain|kitchen/i, "🚰"],
  [/light|bulb/i, "💡"],
  [/toilet/i, "🚽"],
  [/lift|elevator/i, "🛗"],
];

// A small decorative icon guessed from the task name — purely cosmetic.
export function taskEmoji(taskName) {
  for (const [re, emoji] of EMOJI_RULES) {
    if (re.test(taskName || "")) return emoji;
  }
  return "🛠️";
}

function isoWeekday(dateStr) {
  const day = new Date(dateStr + "T00:00:00").getDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

function daysInMonth(year, month /* 1-12 */) {
  return new Date(year, month, 0).getDate();
}

// Does this task's recurrence rule land on dateStr ('YYYY-MM-DD')?
// Pure — no I/O, no notion of "enabled" (callers check that separately).
export function isDueOn(task, dateStr) {
  if (task.start_date && dateStr < task.start_date) return false;

  switch (task.frequency) {
    case "once":
      return task.start_date === dateStr;
    case "daily":
      return true;
    case "weekly":
      return (task.weekly_days || []).includes(isoWeekday(dateStr));
    case "monthly": {
      const [y, m] = dateStr.split("-").map(Number);
      const day = Number(dateStr.split("-")[2]);
      const clamped = Math.min(task.monthly_day || 1, daysInMonth(y, m));
      return day === clamped;
    }
    default:
      return false;
  }
}

// All calendar dates in [from, to] (inclusive) this task is due on.
export function occurrenceDatesInRange(task, from, to) {
  const dates = [];
  const cursor = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (isDueOn(task, dateStr)) dates.push(dateStr);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

// Short human summary of a task's schedule, for lists/badges.
export function scheduleSummary(task) {
  switch (task.frequency) {
    case "once":
      return task.start_date ? `Once — ${task.start_date}` : "Once";
    case "daily":
      return "Every day";
    case "weekly": {
      const days = (task.weekly_days || [])
        .slice().sort()
        .map((v) => WEEKDAYS.find((w) => w.value === v)?.label)
        .filter(Boolean);
      return days.length ? `Weekly — ${days.join(", ")}` : "Weekly";
    }
    case "monthly":
      return task.monthly_day ? `Monthly — day ${task.monthly_day}` : "Monthly";
    default:
      return task.frequency || "";
  }
}

// Display status for one occurrence: an explicit Completed/In Progress
// status always wins; a still-open occurrence whose due date has passed
// reads as Overdue instead of Pending.
export function occurrenceDisplayStatus(occurrence) {
  if (!occurrence) return "Pending";
  if (occurrence.status === "Completed") return "Completed";
  if (occurrence.status === "In Progress") return "In Progress";
  if (occurrence.due_date && occurrence.due_date < todayStr()) return "Overdue";
  return "Pending";
}
