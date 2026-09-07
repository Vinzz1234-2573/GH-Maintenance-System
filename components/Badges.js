const STATUS_CLASS = {
  Pending: "badge-pending",
  "In Progress": "badge-inprogress",
  Completed: "badge-completed",
};

export function StatusBadge({ status }) {
  return <span className={`badge ${STATUS_CLASS[status] || "badge-pending"}`}>{status}</span>;
}
