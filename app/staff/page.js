"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchTasks, fetchEquipment, fetchOccurrences, ensureOccurrences, updateOccurrence, STATUSES } from "../../lib/data";
import { getSession } from "../../lib/session";
import { useToast } from "../../components/useToast";
import { StatusBadge } from "../../components/Badges";
import { formatDate, todayStr } from "../../lib/dates";
import { occurrenceDisplayStatus } from "../../lib/schedule";

const UPCOMING_DAYS = 13; // "upcoming" horizon shown to staff, beyond today

export default function StaffDashboard() {
  const { showToast, ToastHost } = useToast();
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [occurrences, setOccurrences] = useState([]);
  const [remarksDraft, setRemarksDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    setUser(getSession());
  }, []);

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function load() {
    setLoading(true);
    const today = todayStr();
    const to = new Date();
    to.setDate(to.getDate() + UPCOMING_DAYS);
    const toStr = to.toISOString().slice(0, 10);

    const [t, e] = await Promise.all([fetchTasks(), fetchEquipment()]);
    const myTasks = (t.data || []).filter((task) => task.assigned_to === user.id && task.enabled);
    setTasks(myTasks);
    setEquipment(e.data || []);

    const taskIds = myTasks.map((task) => task.id);
    const existing = taskIds.length ? await fetchOccurrences({ from: today, to: toStr, taskIds }) : { data: [] };
    const ensured = await ensureOccurrences(myTasks, existing.data || [], today, toStr);
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

  const today = todayStr();
  const todaysTasks = occurrences.filter((o) => o.due_date === today && o.status !== "Completed");
  const completedToday = occurrences.filter((o) => o.due_date === today && o.status === "Completed");
  const upcoming = occurrences
    .filter((o) => o.due_date > today)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));

  async function saveStatus(occurrence, status) {
    setSavingId(occurrence.id);
    const { error, data } = await updateOccurrence(occurrence.id, { status });
    if (error) showToast(error.message);
    else {
      showToast("Task updated.");
      setOccurrences((prev) => prev.map((o) => (o.id === occurrence.id ? data : o)));
    }
    setSavingId(null);
  }

  async function saveRemarks(occurrence) {
    const remarks = remarksDraft[occurrence.id];
    if (remarks === undefined || remarks === occurrence.remarks) return;
    setSavingId(occurrence.id);
    const { error, data } = await updateOccurrence(occurrence.id, { remarks });
    if (error) showToast(error.message);
    else setOccurrences((prev) => prev.map((o) => (o.id === occurrence.id ? data : o)));
    setSavingId(null);
  }

  function OccurrenceCard({ o, showStatusControls, dateLabel }) {
    const task = taskById[o.task_id];
    const eq = task ? equipmentById[task.equipment_id] : null;
    const draft = remarksDraft[o.id] ?? o.remarks ?? "";
    if (!task) return null;
    return (
      <div className="card" key={o.id}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{eq?.equipment_name || "Equipment removed"}</div>
          <StatusBadge status={occurrenceDisplayStatus(o)} />
        </div>
        <div className="note" style={{ margin: "0 0 8px" }}>
          {eq?.location ? eq.location + " · " : ""}{dateLabel || "Due: " + formatDate(o.due_date)}
        </div>
        <div style={{ fontSize: 13.5, marginBottom: 4 }}>{task.task_name}</div>
        {task.description && <div className="note" style={{ margin: "0 0 10px" }}>{task.description}</div>}

        {showStatusControls ? (
          <>
            <div className="field-row" style={{ alignItems: "flex-end" }}>
              <div className="field">
                <label>Status</label>
                <select value={o.status} disabled={savingId === o.id} onChange={(e) => saveStatus(o, e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {o.status !== "Completed" && (
                <button className="btn btn-secondary" disabled={savingId === o.id} onClick={() => saveStatus(o, "Completed")}>
                  Mark Completed
                </button>
              )}
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Remarks</label>
              <textarea
                rows={2}
                value={draft}
                onChange={(e) => setRemarksDraft((d) => ({ ...d, [o.id]: e.target.value }))}
                onBlur={() => saveRemarks(o)}
              />
            </div>
          </>
        ) : (
          o.remarks && <div className="note" style={{ margin: 0 }}><b>Remarks:</b> {o.remarks}</div>
        )}
      </div>
    );
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
        <>
          <div className="section-title">Today's Tasks ({todaysTasks.length})</div>
          {todaysTasks.length === 0 ? (
            <div className="note" style={{ marginBottom: 22 }}>Nothing left for today — nice work.</div>
          ) : (
            <div style={{ marginBottom: 24 }}>
              {todaysTasks.map((o) => <OccurrenceCard key={o.id} o={o} showStatusControls />)}
            </div>
          )}

          <div className="section-title">Completed Today ({completedToday.length})</div>
          {completedToday.length === 0 ? (
            <div className="note" style={{ marginBottom: 22 }}>None yet.</div>
          ) : (
            <div style={{ marginBottom: 24 }}>
              {completedToday.map((o) => <OccurrenceCard key={o.id} o={o} showStatusControls />)}
            </div>
          )}

          <div className="section-title">Upcoming Tasks ({upcoming.length})</div>
          {upcoming.length === 0 ? (
            <div className="note">Nothing scheduled in the next {UPCOMING_DAYS} days.</div>
          ) : (
            <div>
              {upcoming.map((o) => (
                <OccurrenceCard key={o.id} o={o} showStatusControls={false} dateLabel={"Due: " + formatDate(o.due_date)} />
              ))}
            </div>
          )}
        </>
      )}

      <ToastHost />
    </div>
  );
}
