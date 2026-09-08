import { todayStr } from "./dates";

export const FREQUENCIES = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// ISO weekday numbering: Monday = 1 ... Sunday = 7.
export const WEEKDAYS = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" },
  { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

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
