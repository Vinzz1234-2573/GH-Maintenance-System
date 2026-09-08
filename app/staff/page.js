"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchTasks, fetchOccurrences, ensureOccurrences, updateOccurrence, uploadOccurrencePhoto, STATUSES } from "../../lib/data";
import { getSession } from "../../lib/session";
import { useToast } from "../../components/useToast";
import { StatusBadge } from "../../components/Badges";
import { relativeDateLabel, formatHHMM, todayStr } from "../../lib/dates";
import { occurrenceDisplayStatus, friendlyPattern, taskEmoji, FREQUENCIES } from "../../lib/schedule";

const UPCOMING_DAYS = 13;
const TABS = [
  ["today", "📋 Today's Tasks"], ["pending", "⏳ Pending"],
  ["upcoming", "📅 Upcoming"], ["completed", "✅ Completed"],
];
const FREQ_FILTERS = [["all", "All"], ...FREQUENCIES.filter((f) => f.value !== "once").map((f) => [f.value, f.label])];

const FREQ_BADGE_STYLE = {
  daily: { background: "var(--primary-light)", color: "var(--primary)" },
  weekly: { background: "var(--warning-bg)", color: "var(--warning)" },
  monthly: { background: "#f1e8fb", color: "#7c3aed" },
  once: { background: "#eef1f4", color: "var(--muted)" },
};
const FREQ_TITLE = { daily: "Daily Task", weekly: "Weekly Task", monthly: "Monthly Task", once: "One-Time Task" };

export default function StaffDashboard() {
  const { showToast, ToastHost } = useToast();
  const [user, setUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [occurrences, setOccurrences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("today");
  const [freqFilter, setFreqFilter] = useState("all");
  const [updating, setUpdating] = useState(null); // the occurrence being updated

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

    const t = await fetchTasks();
    const myTasks = (t.data || []).filter((task) => task.assigned_to === user.id && task.enabled);
    setTasks(myTasks);

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

  const today = todayStr();
  const matchesFreq = (o) => freqFilter === "all" || taskById[o.task_id]?.frequency === freqFilter;

  const todaysTasks = occurrences.filter((o) => o.due_date === today && o.status !== "Completed" && matchesFreq(o));
  const pendingTasks = occurrences
    .filter((o) => o.due_date <= today && o.status !== "Completed" && matchesFreq(o))
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const upcomingTasks = occurrences
    .filter((o) => o.due_date >= today && matchesFreq(o))
    .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  const completedTasks = occurrences.filter((o) => o.due_date === today && o.status === "Completed" && matchesFreq(o));

  async function handleSaveUpdate(occurrence, { status, remarks, photoFile }) {
    const { error, data } = await updateOccurrence(occurrence.id, { status, remarks });
    if (error) {
      showToast(error.message);
      return;
    }
    let nextRow = data;
    if (photoFile) {
      const photoResult = await uploadOccurrencePhoto(occurrence.id, photoFile);
      if (photoResult.error) showToast("Saved, but photo upload failed: " + photoResult.error.message);
      else nextRow = photoResult.data;
    }
    setOccurrences((prev) => prev.map((o) => (o.id === occurrence.id ? nextRow : o)));
    showToast("Task updated.");
    setUpdating(null);
  }

  if (!user) return <div className="loading">Checking access...</div>;

  const activeList = { today: todaysTasks, pending: pendingTasks, upcoming: upcomingTasks, completed: completedTasks }[tab];

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Welcome, {user.name}</h2>

      {tasks.length === 0 && !loading ? (
        <div className="empty">
          No maintenance tasks are assigned to you yet.
          <br />
          Check back later, or ask your manager to assign you a task.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
            {FREQ_FILTERS.map(([val, label]) => (
              <button
                key={val}
                className={"btn btn-sm " + (freqFilter === val ? "btn-primary" : "btn-secondary")}
                onClick={() => setFreqFilter(val)}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 18 }}>
            {TABS.map(([val, label]) => (
              <button
                key={val}
                className={"btn " + (tab === val ? "btn-primary" : "btn-secondary")}
                onClick={() => setTab(val)}
                style={{ fontSize: 13 }}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="loading">Loading your tasks...</div>
          ) : tab === "upcoming" ? (
            <UpcomingList list={upcomingTasks} taskById={taskById} />
          ) : activeList.length === 0 ? (
            <div className="note">
              {tab === "today" && "Nothing left for today — nice work."}
              {tab === "pending" && "Nothing pending. You're all caught up."}
              {tab === "completed" && "Nothing completed yet today."}
            </div>
          ) : (
            activeList.map((o) => {
              const task = taskById[o.task_id];
              if (!task) return null;
              return (
                <TaskCard
                  key={o.id}
                  occurrence={o}
                  task={task}
                  userName={user.name}
                  onUpdate={() => setUpdating(o)}
                />
              );
            })
          )}
        </>
      )}

      {updating && (
        <UpdateTaskModal
          occurrence={updating}
          task={taskById[updating.task_id]}
          onCancel={() => setUpdating(null)}
          onSave={(values) => handleSaveUpdate(updating, values)}
        />
      )}

      <ToastHost />
    </div>
  );
}

function TaskCard({ occurrence: o, task, userName, onUpdate }) {
  const freq = task.frequency;
  const dateLine =
    freq === "daily" || freq === "once"
      ? relativeDateLabel(o.due_date)
      : `Next: ${relativeDateLabel(o.due_date)}`;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <span className="badge" style={FREQ_BADGE_STYLE[freq] || FREQ_BADGE_STYLE.once}>{FREQ_TITLE[freq] || "Task"}</span>
        <StatusBadge status={occurrenceDisplayStatus(o)} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
        {taskEmoji(task.task_name)} {task.task_name}
      </div>
      {task.description && <div className="note" style={{ margin: "0 0 8px" }}>{task.description}</div>}

      <div className="note" style={{ margin: "2px 0" }}>📅 {dateLine}</div>
      {(freq === "weekly" || freq === "monthly") && (
        <div className="note" style={{ margin: "2px 0" }}>🔁 {friendlyPattern(task)}</div>
      )}
      {task.due_time && <div className="note" style={{ margin: "2px 0" }}>⏰ Due: {formatHHMM(task.due_time)}</div>}
      <div className="note" style={{ margin: "2px 0 10px" }}>👤 Assigned to: {userName}</div>

      {o.remarks && <div className="note" style={{ margin: "0 0 6px" }}><b>Remarks:</b> {o.remarks}</div>}
      {o.photo_url && (
        <a href={o.photo_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", margin: "0 0 10px" }}>
          <img src={o.photo_url} alt="Evidence" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
        </a>
      )}

      <button className="btn btn-primary btn-block" onClick={onUpdate}>Update Task</button>
    </div>
  );
}

function UpcomingList({ list, taskById }) {
  if (list.length === 0) return <div className="note">Nothing scheduled.</div>;
  return (
    <div className="card" style={{ padding: 0 }}>
      {list.map((o, i) => {
        const task = taskById[o.task_id];
        if (!task) return null;
        return (
          <div
            key={o.id}
            style={{
              display: "flex", justifyContent: "space-between", gap: 10, padding: "12px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--border)", fontSize: 13.5,
            }}
          >
            <span>
              <b>{relativeDateLabel(o.due_date)}</b> — {task.task_name}
            </span>
            <span className="note" style={{ margin: 0, textTransform: "capitalize" }}>{task.frequency}</span>
          </div>
        );
      })}
    </div>
  );
}

function UpdateTaskModal({ occurrence, task, onCancel, onSave }) {
  const [status, setStatus] = useState(occurrence.status);
  const [remarks, setRemarks] = useState(occurrence.remarks || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({ status, remarks, photoFile });
    setSaving(false);
  }

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{taskEmoji(task?.task_name)} {task?.task_name}</h3>

        <button
          type="button"
          className="btn btn-secondary btn-block"
          style={{ marginBottom: 14, color: status === "Completed" ? "#fff" : undefined, background: status === "Completed" ? "var(--success)" : undefined }}
          onClick={() => setStatus("Completed")}
        >
          ✅ Mark as Completed
        </button>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>Remarks</label>
          <textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional notes" />
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label>Photo Evidence (optional)</label>
          {occurrence.photo_url && !photoFile && (
            <div className="note" style={{ margin: "0 0 6px" }}>A photo is already attached — choose a file to replace it.</div>
          )}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Update"}
          </button>
        </div>
      </div>
    </div>
  );
}
