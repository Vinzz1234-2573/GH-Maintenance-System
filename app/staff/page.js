"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchTasks, fetchEquipment, updateTask, markTaskStatus, effectiveStatus, STATUSES } from "../../lib/data";
import { getSession } from "../../lib/session";
import { useToast } from "../../components/useToast";
import { StatusBadge } from "../../components/Badges";
import { formatDate } from "../../lib/dates";

export default function StaffDashboard() {
  const { showToast, ToastHost } = useToast();
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [remarksDraft, setRemarksDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    const session = getSession();
    setUser(session);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function load() {
    setLoading(true);
    const [t, e] = await Promise.all([fetchTasks(), fetchEquipment()]);
    setTasks((t.data || []).filter((task) => task.assigned_to === user.id));
    setEquipment(e.data || []);
    setLoading(false);
  }

  const equipmentById = useMemo(() => {
    const map = {};
    for (const e of equipment) map[e.id] = e;
    return map;
  }, [equipment]);

  const groups = {
    Pending: tasks.filter((t) => effectiveStatus(t) === "Pending"),
    "In Progress": tasks.filter((t) => effectiveStatus(t) === "In Progress"),
    Completed: tasks.filter((t) => effectiveStatus(t) === "Completed"),
  };

  async function saveStatus(task, status) {
    setSavingId(task.id);
    const { error } = await markTaskStatus(task.id, status);
    if (error) showToast(error.message);
    else showToast("Task updated.");
    await load();
    setSavingId(null);
  }

  async function saveRemarks(task) {
    const remarks = remarksDraft[task.id];
    if (remarks === undefined || remarks === task.remarks) return;
    setSavingId(task.id);
    const { error } = await updateTask(task.id, { remarks });
    if (error) showToast(error.message);
    await load();
    setSavingId(null);
  }

  if (!user) return <div className="loading">Checking access...</div>;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>Welcome, {user.name}</h2>

      {loading ? (
        <div className="loading">Loading your tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="empty">
          No maintenance tasks are assigned to you yet.
          <br />
          Check back later, or ask your manager to assign you a task.
        </div>
      ) : (
        Object.entries(groups).map(([status, list]) => (
          <div key={status} style={{ marginBottom: 24 }}>
            <div className="section-title">
              My {status === "Pending" ? "Pending Tasks" : status === "In Progress" ? "Tasks In Progress" : "Completed Tasks"} ({list.length})
            </div>
            {list.length === 0 ? (
              <div className="note">None right now.</div>
            ) : (
              list.map((t) => {
                const eq = equipmentById[t.equipment_id];
                const draft = remarksDraft[t.id] ?? t.remarks ?? "";
                const status = effectiveStatus(t);
                return (
                  <div className="card" key={t.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                        {eq?.equipment_name || "Equipment removed"}
                        {t.is_daily && <span className="note" style={{ marginLeft: 6 }}>· Daily</span>}
                      </div>
                      <StatusBadge status={status} />
                    </div>
                    <div className="note" style={{ margin: "0 0 8px" }}>
                      {eq?.location ? eq.location + " · " : ""}Due: {t.date ? formatDate(t.date) : "No due date"}
                    </div>
                    <div style={{ fontSize: 13.5, marginBottom: 4 }}>{t.task_name}</div>
                    {t.description && <div className="note" style={{ margin: "0 0 10px" }}>{t.description}</div>}

                    <div className="field-row" style={{ alignItems: "flex-end" }}>
                      <div className="field">
                        <label>Status</label>
                        <select value={status} disabled={savingId === t.id} onChange={(e) => saveStatus(t, e.target.value)}>
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      {status !== "Completed" && (
                        <button className="btn btn-secondary" disabled={savingId === t.id} onClick={() => saveStatus(t, "Completed")}>
                          Mark Completed
                        </button>
                      )}
                    </div>
                    <div className="field" style={{ marginTop: 10 }}>
                      <label>Remarks</label>
                      <textarea
                        rows={2}
                        value={draft}
                        onChange={(e) => setRemarksDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                        onBlur={() => saveRemarks(t)}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ))
      )}

      <ToastHost />
    </div>
  );
}
