"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchTasks, fetchEquipment, fetchStaffUsers, updateTask, deleteTask, effectiveStatus, STATUSES } from "../../../lib/data";
import { useToast } from "../../../components/useToast";
import { StatusBadge } from "../../../components/Badges";
import ConfirmDialog from "../../../components/ConfirmDialog";
import TaskForm from "../../../components/TaskForm";
import { formatDate } from "../../../lib/dates";

const EMPTY_FILTERS = { status: "all", assignedTo: "all", equipmentId: "all" };

export default function MaintenanceTasksPage() {
  const { showToast, ToastHost } = useToast();
  const [tasks, setTasks] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [t, e, s] = await Promise.all([fetchTasks(), fetchEquipment(), fetchStaffUsers()]);
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

  const filtered = tasks.filter((t) => {
    if (filters.status !== "all" && effectiveStatus(t) !== filters.status) return false;
    if (filters.assignedTo !== "all" && t.assigned_to !== filters.assignedTo) return false;
    if (filters.equipmentId !== "all" && t.equipment_id !== filters.equipmentId) return false;
    return true;
  });
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

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
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>Maintenance Tasks</h2>
        <Link href="/manager/tasks/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
          + Add New Task
        </Link>
      </div>

      {tasks.length > 0 && (
        <div className="filter-bar">
          <div className="field">
            <label>Status</label>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="all">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Assigned Staff</label>
            <select value={filters.assignedTo} onChange={(e) => setFilters((f) => ({ ...f, assignedTo: e.target.value }))}>
              <option value="all">All</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Equipment</label>
            <select value={filters.equipmentId} onChange={(e) => setFilters((f) => ({ ...f, equipmentId: e.target.value }))}>
              <option value="all">All</option>
              {equipment.map((e) => <option key={e.id} value={e.id}>{e.equipment_name}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" disabled={!hasFilters} onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear Filters
          </button>
        </div>
      )}

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
            <thead><tr><th>Equipment</th><th>Task</th><th>Assigned Staff</th><th>Status</th><th>Due Date</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6}><div className="empty">No tasks match these filters.</div></td></tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Equipment">{equipmentById[t.equipment_id]?.equipment_name || "—"}{t.is_daily && <span className="note"> · Daily</span>}</td>
                    <td data-label="Task">{t.task_name}</td>
                    <td data-label="Assigned Staff">{staffById[t.assigned_to]?.name || "Unassigned"}</td>
                    <td data-label="Status"><StatusBadge status={effectiveStatus(t)} /></td>
                    <td data-label="Due Date">{t.date ? formatDate(t.date) : "—"}</td>
                    <td data-label="Actions">
                      <div className="table-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => setDeleteTarget(t)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
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
