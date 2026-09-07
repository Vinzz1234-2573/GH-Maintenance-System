"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchTasks, fetchEquipment, fetchStaffUsers, updateTask, deleteTask } from "../../lib/data";
import { isSupabaseConfigured } from "../../lib/supabaseClient";
import { useToast } from "../../components/useToast";
import { StatusBadge } from "../../components/Badges";
import ConfirmDialog from "../../components/ConfirmDialog";
import TaskForm from "../../components/TaskForm";
import { formatDate } from "../../lib/dates";

export default function ManagerDashboard() {
  const { showToast, ToastHost } = useToast();
  const [tasks, setTasks] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setLoadError("");
    const [t, e, s] = await Promise.all([fetchTasks(), fetchEquipment(), fetchStaffUsers()]);
    if (t.error) setLoadError(t.error.message);
    setTasks(t.data || []);
    setEquipment(e.data || []);
    setStaff(s.data || []);
    setLoading(false);
  }

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

  const counts = {
    total: tasks.length,
    Pending: tasks.filter((t) => t.status === "Pending").length,
    "In Progress": tasks.filter((t) => t.status === "In Progress").length,
    Completed: tasks.filter((t) => t.status === "Completed").length,
  };

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
            Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
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

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-value">{counts.total}</div><div className="kpi-label">Total Tasks</div></div>
        <div className="kpi-card"><div className="kpi-value">{counts.Pending}</div><div className="kpi-label">Pending</div></div>
        <div className="kpi-card"><div className="kpi-value">{counts["In Progress"]}</div><div className="kpi-label">In Progress</div></div>
        <div className="kpi-card"><div className="kpi-value">{counts.Completed}</div><div className="kpi-label">Completed</div></div>
      </div>

      <div className="section-title">Maintenance Tasks</div>

      {loading ? (
        <div className="loading">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            No maintenance tasks have been created yet.
          </div>
          <div className="note" style={{ margin: "0 0 18px" }}>
            Create the first task to get your maintenance checklist started.
          </div>
          <Link href="/manager/tasks/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
            + Add New Maintenance Task
          </Link>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Equipment</th><th>Assigned Staff</th><th>Status</th><th>Due Date</th><th>Actions</th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td data-label="Equipment">{equipmentById[t.equipment_id]?.equipment_name || "—"}</td>
                  <td data-label="Assigned Staff">{staffById[t.assigned_to]?.name || "Unassigned"}</td>
                  <td data-label="Status"><StatusBadge status={t.status} /></td>
                  <td data-label="Due Date">{t.date ? formatDate(t.date) : "—"}</td>
                  <td data-label="Actions">
                    <div className="table-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setViewing(t)}>View</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => setDeleteTarget(t)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <div className="dialog-backdrop" onClick={() => setViewing(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{equipmentById[viewing.equipment_id]?.equipment_name || "Task"}</h3>
            <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
              <div><b>Task:</b> {viewing.task_name}</div>
              {viewing.description && <div><b>Details:</b> {viewing.description}</div>}
              <div><b>Assigned To:</b> {staffById[viewing.assigned_to]?.name || "Unassigned"}</div>
              <div><b>Status:</b> <StatusBadge status={viewing.status} /></div>
              <div><b>Due Date:</b> {viewing.date ? formatDate(viewing.date) : "—"}</div>
              {viewing.remarks && <div><b>Remarks:</b> {viewing.remarks}</div>}
            </div>
            <div className="dialog-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setViewing(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete task?"
        message={`Are you sure you want to delete "${deleteTarget?.task_name}"?`}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ToastHost />
    </div>
  );
}
