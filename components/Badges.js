const STATUS_CLASS = {
  Pending: "badge-pending",
  "In Progress": "badge-inprogress",
  Completed: "badge-completed",
  Overdue: "badge-overdue",
  Disabled: "badge-disabled",
};

export function StatusBadge({ status }) {
  return <span className={`badge ${STATUS_CLASS[status] || "badge-pending"}`}>{status}</span>;
}
