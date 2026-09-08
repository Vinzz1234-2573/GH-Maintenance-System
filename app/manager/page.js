"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  fetchTasks, fetchEquipment, fetchStaffUsers, fetchOccurrences, ensureOccurrences,
  updateOccurrence, updateTask, setTaskEnabled, deleteTask,
} from "../../lib/data";
import { isSupabaseConfigured } from "../../lib/supabaseClient";
import { useToast } from "../../components/useToast";
import { StatusBadge } from "../../components/Badges";
import ConfirmDialog from "../../components/ConfirmDialog";
import TaskForm from "../../components/TaskForm";
import { formatDate, periodRange, todayStr } from "../../lib/dates";
import { occurrenceDisplayStatus, scheduleSummary } from "../../lib/schedule";

const PRESETS = [
  ["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This Week"],
  ["month", "This Month"], ["custom", "Custom Range"],
];

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

  const { from, to } = preset === "custom" ? { from: customFrom, to: customTo } : periodRange(preset);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function load() {
    setLoading(true);
    setLoadError("");
    const [t, e, s] = await Promise.all([fetchTasks(), fetchEquipment(), fetchStaffUsers()]);
    if (t.error) setLoadError(t.error.message);
    setTasks(t.data || []);
    setEquipment(e.data || []);
    setStaff(s.data || []);

    const today = todayStr();
    const overdueFrom = new Date();
    overdueFrom.setDate(overdueFrom.getDate() - 60);
    const wideFrom = [overdueFrom.toISOString().slice(0, 10), from].sort()[0];
    const wideTo = [to, today].sort()[1];

    const existing = await fetchOccurrences({ from: wideFrom, to: wideTo });
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

  const today = todayStr();
  const rangeOccurrences = occurrences.filter((o) => o.due_date >= from && o.due_date <= to);
  const displayOccurrences =
    statusFilter === "all"
      ? rangeOccurrences
      : rangeOccurrences.filter((o) => occurrenceDisplayStatus(o) === statusFilter);
  const overdueOccurrences = occurrences
    .filter((o) => o.due_date < today && o.status !== "Completed")
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const disabledTasks = tasks.filter((t) => !t.enabled);

  const counts = {
    pending: rangeOccurrences.filter((o) => occurrenceDisplayStatus(o) === "Pending").length,
    completed: rangeOccurrences.filter((o) => occurrenceDisplayStatus(o) === "Completed").length,
    overdue: overdueOccurrences.length,
    disabled: disabledTasks.length,
  };

  async function quickStatus(occurrence, status) {
    const { error, data } = await updateOccurrence(occurrence.id, { status });
    if (error) return showToast(error.message);
    setOccurrences((prev) => prev.map((o) => (o.id === occurrence.id ? data : o)));
    showToast("Task updated.");
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
            {o.status !== "Completed" && (
              <button className="btn btn-success btn-sm" onClick={() => quickStatus(o, "Completed")}>✓ Mark Completed</button>
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
            <option value="Pending">Pending</option>
            <option value="In Progress">In Progress</option>
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
            border: statusFilter === "Pending" ? "2px solid var(--primary)" : "1px solid var(--border)",
          }}
          onClick={() => setStatusFilter(statusFilter === "Pending" ? "all" : "Pending")}
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
                    <button className="btn btn-success btn-sm" onClick={() => quickStatus(o, "Completed")}>✓ Mark Completed</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="panel-row">
            <div className="section-title" style={{ margin: 0 }}>
              Maintenance Tasks — {PRESETS.find((p) => p[0] === preset)?.[1]}
              {statusFilter !== "all" && ` · ${statusFilter}`}
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
                      : `No ${statusFilter} tasks in this range.` +
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete task?"
        message={`Are you sure you want to delete "${deleteTarget?.task_name}"? This also removes its scheduled occurrences. There's no undo.`}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ToastHost />
    </div>
  );
}
