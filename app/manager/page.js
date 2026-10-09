"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  fetchTasks, fetchEquipment, fetchStaffUsers, fetchUsers, fetchOccurrences, fetchAwaitingReview,
  ensureOccurrences, reviewTask, updateTask, setTaskEnabled, deleteTask,
} from "../../lib/data";
import { maybePurgeOldPhotos } from "../../lib/retention";
import { getSession } from "../../lib/session";
import { isSupabaseConfigured } from "../../lib/supabaseClient";
import { useToast } from "../../components/useToast";
import { StatusBadge } from "../../components/Badges";
import ConfirmDialog from "../../components/ConfirmDialog";
import PhotoThumbs from "../../components/PhotoThumbs";
import TaskForm from "../../components/TaskForm";
import { formatDate, formatDateTime, periodRange, todayStr, addDays } from "../../lib/dates";
import { occurrenceDisplayStatus, scheduleSummary, PENDING_GROUP } from "../../lib/schedule";

const PRESETS = [
  ["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This Week"],
  ["month", "This Month"], ["custom", "Custom Range"],
];

// Status filter value used by the Pending KPI card: everything still open
// (Pending + Awaiting Review + Needs Correction), so the list matches the count.
const OPEN_FILTER = "open";
const FILTER_LABEL = { [OPEN_FILTER]: "Pending (all open)" };

export default function ManagerDashboard() {
  const { showToast, ToastHost } = useToast();
  const [tasks, setTasks] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [staff, setStaff] = useState([]);
  const [occurrences, setOccurrences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [preset, setPreset] = useState("today");
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [users, setUsers] = useState([]); // staff + managers, for "reviewed by"
  const [reviewQueue, setReviewQueue] = useState([]);
  const [viewing, setViewing] = useState(null); // occurrence shown in the detail dialog
  const [rejectTarget, setRejectTarget] = useState(null);

  const { from, to } = preset === "custom" ? { from: customFrom, to: customTo } : periodRange(preset);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // 6-month photo retention: background, at most once per 24h, never blocks.
  useEffect(() => {
    maybePurgeOldPhotos();
  }, []);

  async function load() {
    setLoading(true);
    setLoadError("");
    const [t, e, s, u, q] = await Promise.all([
      fetchTasks(), fetchEquipment(), fetchStaffUsers(), fetchUsers(), fetchAwaitingReview(),
    ]);
    if (t.error) setLoadError(t.error.message);
    else if (q.error) setLoadError(q.error.message);
    setTasks(t.data || []);
    setEquipment(e.data || []);
    setStaff(s.data || []);
    setUsers(u.data || []);
    setReviewQueue(q.data || []);

    const today = todayStr();
    const wideFrom = [addDays(today, -60), from].sort()[0];
    const wideTo = [to, today].sort()[1];

    const existing = await fetchOccurrences({ from: wideFrom, to: wideTo });
    if (existing.error) setLoadError(existing.error.message);
    const enabledTasks = (t.data || []).filter((task) => task.enabled);
    const ensured = await ensureOccurrences(enabledTasks, existing.data || [], from, to);
    setOccurrences(ensured.data || []);
    setLoading(false);
  }

  const taskById = useMemo(() => {
    const map = {};
    for (const t of tasks) map[t.id] = t;
    return map;
  }, [tasks]);
  const equipmentById = useMemo(() => {
    const map = {};
    for (const e of equipment) map[e.id] = e;
    return map;
  }, [equipment]);
  const staffById = useMemo(() => {
    const map = {};
    for (const s of staff) map[s.id] = s;
    return map;
  }, [staff]);
  const usersById = useMemo(() => {
    const map = {};
    for (const u of users) map[u.id] = u;
    return map;
  }, [users]);

  const today = todayStr();
  // Disabled tasks' occurrences stay in the DB as history but are hidden here.
  const activeOccurrences = occurrences.filter((o) => taskById[o.task_id]?.enabled);
  const rangeOccurrences = activeOccurrences.filter((o) => o.due_date >= from && o.due_date <= to);
  const matchesFilter = (o) => {
    const s = occurrenceDisplayStatus(o);
    return statusFilter === OPEN_FILTER ? PENDING_GROUP.includes(s) : s === statusFilter;
  };
  const displayOccurrences = statusFilter === "all" ? rangeOccurrences : rangeOccurrences.filter(matchesFilter);
  // Past due and still with staff (Awaiting Review is never overdue — staff did their part).
  const overdueOccurrences = activeOccurrences
    .filter((o) => o.due_date < today && o.status !== "Completed" && o.status !== "Awaiting Review")
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const disabledTasks = tasks.filter((t) => !t.enabled);

  const counts = {
    pending: rangeOccurrences.filter((o) => PENDING_GROUP.includes(occurrenceDisplayStatus(o))).length,
    completed: rangeOccurrences.filter((o) => occurrenceDisplayStatus(o) === "Completed").length,
    overdue: overdueOccurrences.length,
    disabled: disabledTasks.length,
  };

  // Manager-only: approve, or reject with a note. Returns an error message or null.
  async function handleReview(occurrence, decision, note) {
    const reviewerId = getSession()?.id;
    let res;
    try {
      res = await reviewTask(occurrence.id, { decision, note, reviewerId });
    } catch (err) {
      return err.message;
    }
    if (res.error) return res.error.message;
    setOccurrences((prev) => prev.map((o) => (o.id === occurrence.id ? res.data : o)));
    setReviewQueue((prev) => prev.filter((o) => o.id !== occurrence.id));
    setViewing((v) => (v?.id === occurrence.id ? res.data : v));
    showToast(decision === "approve" ? "Approved — task completed." : "Sent back to staff for correction.");
    return null;
  }

  async function approve(occurrence) {
    const err = await handleReview(occurrence, "approve");
    if (err) showToast(err);
  }

  async function toggleEnabled(task) {
    const { error } = await setTaskEnabled(task.id, !task.enabled);
    if (error) return showToast(error.message);
    showToast(task.enabled ? "Task disabled." : "Task enabled.");
    load();
  }

  async function handleSaveEdit(values) {
    const { error } = await updateTask(editing.id, values);
    if (error) throw new Error(error.message);
    showToast("Maintenance task updated successfully.");
    setEditing(null);
    load();
  }

  async function confirmDelete() {
    const task = deleteTarget;
    setDeleteTarget(null);
    const { error } = await deleteTask(task.id);
    if (error) return showToast(error.message);
    showToast("Task deleted.");
    load();
  }

  function occurrenceRow(o) {
    const task = taskById[o.task_id];
    if (!task) return null;
    return (
      <tr key={o.id}>
        <td data-label="Equipment">{equipmentById[task.equipment_id]?.equipment_name || "—"}</td>
        <td data-label="Task">{task.task_name}</td>
        <td data-label="Assigned Staff">{staffById[task.assigned_to]?.name || "Unassigned"}</td>
        <td data-label="Due Date">{formatDate(o.due_date)}</td>
        <td data-label="Frequency">{scheduleSummary(task)}</td>
        <td data-label="Status"><StatusBadge status={occurrenceDisplayStatus(o)} /></td>
        <td data-label="Actions">
          <div className="table-actions">
            {o.status === "Awaiting Review" ? (
              <button className="btn btn-success btn-sm" onClick={() => setViewing(o)}>Review</button>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => setViewing(o)}>
                {o.status === "Completed" && o.task_photos?.length ? "View photos" : "View"}
              </button>
            )}
            {o.photos_purged_at && !o.task_photos?.length && (
              <span className="note" style={{ margin: 0, fontSize: 11.5 }}>Photos removed after 6 months</span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(task)}>Edit</button>
            <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => setDeleteTarget(task)}>Delete</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div>
      <div className="panel-row">
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>Dashboard</h2>
        <Link href="/manager/tasks/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
          + Add New Task
        </Link>
      </div>

      {!isSupabaseConfigured && (
        <div className="card" style={{ background: "var(--warning-bg)", borderColor: "#f0d9ac" }}>
          <b style={{ color: "var(--warning)" }}>Supabase isn't connected yet.</b>
          <div className="note" style={{ margin: "2px 0 0" }}>
            Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to
            <code> .env.local</code> and run <code>sql/schema.sql</code> in your Supabase project — see the README.
          </div>
        </div>
      )}
      {isSupabaseConfigured && loadError && (
        <div className="card" style={{ background: "var(--danger-bg)", borderColor: "#f0b9b9" }}>
          <b style={{ color: "var(--danger)" }}>Could not load data</b>
          <div className="note" style={{ margin: "2px 0 0" }}>{loadError}</div>
        </div>
      )}

      <div className="filter-bar">
        {PRESETS.map(([val, label]) => (
          <button
            key={val}
            className={"btn btn-sm " + (preset === val ? "btn-primary" : "btn-secondary")}
            onClick={() => setPreset(val)}
          >
            {label}
          </button>
        ))}
        {preset === "custom" && (
          <>
            <div className="field">
              <label>From</label>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </>
        )}
        <div className="field">
          <label>Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value={OPEN_FILTER}>{FILTER_LABEL[OPEN_FILTER]}</option>
            <option value="Pending">Pending</option>
            <option value="In Progress">In Progress</option>
            <option value="Awaiting Review">Awaiting Review</option>
            <option value="Needs Correction">Needs Correction</option>
            <option value="Completed">Completed</option>
            <option value="Overdue">Overdue</option>
          </select>
        </div>
        {statusFilter !== "all" && (
          <button className="btn btn-secondary" onClick={() => setStatusFilter("all")}>Clear Filter</button>
        )}
      </div>

      <div className="kpi-grid">
        <button
          className="kpi-card"
          style={{
            textAlign: "left", cursor: "pointer", width: "100%", background: "var(--info-bg)",
            border: statusFilter === OPEN_FILTER ? "2px solid var(--primary)" : "1px solid var(--border)",
          }}
          onClick={() => setStatusFilter(statusFilter === OPEN_FILTER ? "all" : OPEN_FILTER)}
          title="Pending + Awaiting Review + Needs Correction"
        >
          <div className="kpi-icon">⏳</div>
          <div className="kpi-value">{counts.pending}</div><div className="kpi-label">Pending (range)</div>
        </button>
        <button
          className="kpi-card"
          style={{
            textAlign: "left", cursor: "pointer", width: "100%", background: "var(--success-bg)",
            border: statusFilter === "Completed" ? "2px solid var(--primary)" : "1px solid var(--border)",
          }}
          onClick={() => setStatusFilter(statusFilter === "Completed" ? "all" : "Completed")}
        >
          <div className="kpi-icon">✅</div>
          <div className="kpi-value" style={{ color: "var(--success)" }}>{counts.completed}</div>
          <div className="kpi-label">Completed (range)</div>
        </button>
        <button
          className="kpi-card"
          style={{
            textAlign: "left", cursor: "pointer", width: "100%", background: "var(--danger-bg)",
            border: statusFilter === "Overdue" ? "2px solid var(--primary)" : "1px solid var(--border)",
          }}
          onClick={() => setStatusFilter(statusFilter === "Overdue" ? "all" : "Overdue")}
        >
          <div className="kpi-icon">⚠️</div>
          <div className="kpi-value" style={{ color: "var(--danger)" }}>{counts.overdue}</div>
          <div className="kpi-label">Overdue</div>
        </button>
        <div className="kpi-card" style={{ background: "#f4f5f7" }}>
          <div className="kpi-icon">🚫</div>
          <div className="kpi-value" style={{ color: "var(--muted)" }}>{counts.disabled}</div>
          <div className="kpi-label">Disabled Tasks</div>
        </div>
      </div>
      <div className="note" style={{ margin: "-10px 0 18px" }}>Tap a card to filter the list below.</div>

      {loading ? (
        <div className="loading">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>No maintenance tasks have been created yet.</div>
          <div className="note" style={{ margin: "0 0 18px" }}>Create the first task to get your maintenance checklist started.</div>
          <Link href="/manager/tasks/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
            + Add New Maintenance Task
          </Link>
        </div>
      ) : (
        <>
          {reviewQueue.length > 0 && (
            <div className="card" style={{ background: "#f7f2fd", borderColor: "#dccaf5", marginBottom: 18 }}>
              <div className="section-title" style={{ margin: "0 0 8px", color: "#7c3aed" }}>
                📥 Review Queue ({reviewQueue.length})
              </div>
              {reviewQueue.map((o) => {
                const task = taskById[o.task_id];
                return (
                  <div key={o.id} style={{ padding: "10px 0", borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 13.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span>
                        <b>{task?.task_name || "Deleted task"}</b>
                        {task && ` — ${equipmentById[task.equipment_id]?.equipment_name || "No equipment"}`}
                        {" · "}{staffById[task?.assigned_to]?.name || "Unassigned"}
                      </span>
                      <span className="note" style={{ margin: 0 }}>
                        Due {formatDate(o.due_date)} · Submitted {formatDateTime(o.submitted_at)}
                        {o.rejection_count > 0 && ` · resubmission #${o.rejection_count}`}
                      </span>
                    </div>
                    {o.remarks && <div className="note" style={{ margin: "4px 0 0" }}><b>Remarks:</b> {o.remarks}</div>}
                    <PhotoThumbs photos={o.task_photos} />
                    <div className="table-actions">
                      <button className="btn btn-success btn-sm" onClick={() => approve(o)}>✓ Approve</button>
                      <button className="btn btn-secondary btn-sm" style={{ color: "var(--danger)" }} onClick={() => setRejectTarget(o)}>
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {overdueOccurrences.length > 0 && (
            <div className="card" style={{ background: "var(--danger-bg)", borderColor: "#f0b9b9", marginBottom: 18 }}>
              <div className="panel-row" style={{ marginBottom: 8 }}>
                <div className="section-title" style={{ margin: 0, color: "var(--danger)" }}>
                  ⚠️ Overdue ({overdueOccurrences.length})
                </div>
              </div>
              {overdueOccurrences.map((o) => {
                const task = taskById[o.task_id];
                if (!task) return null;
                return (
                  <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 13.5 }}>
                    <span><b>{task.task_name}</b> — {staffById[task.assigned_to]?.name || "Unassigned"} · Due {formatDate(o.due_date)}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => setViewing(o)}>View</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="panel-row">
            <div className="section-title" style={{ margin: 0 }}>
              Maintenance Tasks — {PRESETS.find((p) => p[0] === preset)?.[1]}
              {statusFilter !== "all" && ` · ${FILTER_LABEL[statusFilter] || statusFilter}`}
            </div>
            <div className="note" style={{ margin: 0 }}>{displayOccurrences.length} shown</div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Equipment</th><th>Task</th><th>Assigned Staff</th><th>Due Date</th><th>Frequency</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {displayOccurrences.length === 0 ? (
                  <tr><td colSpan={7}><div className="empty">
                    {statusFilter === "all"
                      ? "Nothing scheduled in this range."
                      : `No ${FILTER_LABEL[statusFilter] || statusFilter} tasks in this range.` +
                        (statusFilter === "Overdue" ? " (Overdue items outside this date range still show in the panel above.)" : "")}
                  </div></td></tr>
                ) : (
                  displayOccurrences.map(occurrenceRow)
                )}
              </tbody>
            </table>
          </div>

          {disabledTasks.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 22 }}>🚫 Disabled Tasks ({disabledTasks.length})</div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Task</th><th>Equipment</th><th>Assigned Staff</th><th>Actions</th></tr></thead>
                  <tbody>
                    {disabledTasks.map((t) => (
                      <tr key={t.id}>
                        <td data-label="Task">{t.task_name}</td>
                        <td data-label="Equipment">{equipmentById[t.equipment_id]?.equipment_name || "—"}</td>
                        <td data-label="Assigned Staff">{staffById[t.assigned_to]?.name || "Unassigned"}</td>
                        <td data-label="Actions">
                          <div className="table-actions">
                            <button className="btn btn-ghost btn-sm" onClick={() => toggleEnabled(t)}>Enable</button>
                            <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => setDeleteTarget(t)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {editing && (
        <div className="dialog-backdrop" onClick={() => setEditing(null)}>
          <div className="dialog" style={{ maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3>Edit Task</h3>
            <TaskForm
              initial={editing}
              equipmentList={equipment}
              staffList={staff}
              onCancel={() => setEditing(null)}
              onSubmit={handleSaveEdit}
              submitLabel="Save Changes"
            />
          </div>
        </div>
      )}

      {viewing && (
        <OccurrenceDetailDialog
          occurrence={viewing}
          task={taskById[viewing.task_id]}
          staffName={staffById[taskById[viewing.task_id]?.assigned_to]?.name}
          reviewerName={usersById[viewing.reviewed_by]?.name}
          onApprove={() => approve(viewing)}
          onReject={() => setRejectTarget(viewing)}
          onClose={() => setViewing(null)}
        />
      )}

      {rejectTarget && (
        <RejectDialog
          task={taskById[rejectTarget.task_id]}
          onCancel={() => setRejectTarget(null)}
          onConfirm={async (note) => {
            const err = await handleReview(rejectTarget, "reject", note);
            if (!err) setRejectTarget(null);
            return err;
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete task?"
        message={`Are you sure you want to delete "${deleteTarget?.task_name}"? This also removes its scheduled occurrences and photos. There's no undo.`}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ToastHost />
    </div>
  );
}

// One occurrence in detail: status, remarks, review record and photos.
// Approve / Reject are offered only while it's Awaiting Review.
function OccurrenceDetailDialog({ occurrence: o, task, staffName, reviewerName, onApprove, onReject, onClose }) {
  const [busy, setBusy] = useState(false);
  const photos = o.task_photos || [];
  const awaiting = o.status === "Awaiting Review";

  async function handleApprove() {
    setBusy(true);
    await onApprove();
    setBusy(false);
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" style={{ maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
          <h3>{task?.task_name || "Task"}</h3>
          <StatusBadge status={occurrenceDisplayStatus(o)} />
        </div>
        <div className="note" style={{ margin: "0 0 10px" }}>
          {staffName || "Unassigned"} · Due {formatDate(o.due_date)}
          {o.submitted_at && <> · Submitted {formatDateTime(o.submitted_at)}</>}
          {o.completed_at && <> · Completed {formatDateTime(o.completed_at)}</>}
        </div>

        {o.remarks && <div className="note" style={{ margin: "0 0 10px" }}><b>Staff remarks:</b> {o.remarks}</div>}

        {o.status === "Rejected" && o.review_note && (
          <div className="review-note"><b>Your note to staff:</b> {o.review_note}</div>
        )}
        {o.reviewed_at && (
          <div className="note" style={{ margin: "0 0 10px" }}>
            {o.status === "Completed" ? "Approved" : "Last reviewed"} by {reviewerName || "unknown"} on {formatDateTime(o.reviewed_at)}
            {o.rejection_count > 0 && ` · returned for correction ${o.rejection_count}×`}
          </div>
        )}

        {photos.length > 0 ? (
          <PhotoThumbs photos={photos} />
        ) : o.photos_purged_at ? (
          <div className="note" style={{ margin: "0 0 10px" }}>Photos removed after 6 months.</div>
        ) : (
          <div className="note" style={{ margin: "0 0 10px" }}>No photos.</div>
        )}

        <div className="dialog-actions" style={{ marginTop: 10 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
          {awaiting && (
            <>
              <button className="btn btn-secondary" style={{ color: "var(--danger)" }} onClick={onReject} disabled={busy}>✕ Reject</button>
              <button className="btn btn-success" onClick={handleApprove} disabled={busy}>{busy ? "Approving..." : "✓ Approve"}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Rejection requires a note — it's what staff see as "Needs Correction".
function RejectDialog({ task, onCancel, onConfirm }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!note.trim()) {
      setError("Please write what needs to be corrected.");
      return;
    }
    setBusy(true);
    setError("");
    const err = await onConfirm(note.trim());
    if (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" style={{ zIndex: 350 }} onClick={busy ? undefined : onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Reject “{task?.task_name || "task"}”?</h3>
        <p>The task goes back to staff as <b>Needs Correction</b> with your note. The submitted photos are deleted; staff must take new ones.</p>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Note to staff (required)</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Basin tap still leaking — please re-tighten and re-photograph" autoFocus disabled={busy} />
        </div>
        {error && <div className="note" style={{ color: "var(--danger)", margin: "0 0 10px" }}>{error}</div>}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-danger" onClick={handleConfirm} disabled={busy || !note.trim()}>
            {busy ? "Rejecting..." : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}
