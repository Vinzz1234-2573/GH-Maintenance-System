"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchTasks, fetchOccurrences, ensureOccurrences, saveProgress, submitForReview, STAFF_STATUSES,
} from "../../lib/data";
import { compressImage, MIN_PHOTOS, MAX_PHOTOS } from "../../lib/photos";
import PhotoThumbs from "../../components/PhotoThumbs";
import { getSession } from "../../lib/session";
import { useToast } from "../../components/useToast";
import { StatusBadge } from "../../components/Badges";
import { relativeDateLabel, formatHHMM, formatDateTime, todayStr, addDays } from "../../lib/dates";
import { occurrenceDisplayStatus, friendlyPattern, taskEmoji, FREQUENCIES } from "../../lib/schedule";

const UPCOMING_DAYS = 13;
const HISTORY_DAYS = 30; // how far back staff can see overdue work and completions
// Statuses a staff member can still act on (Awaiting Review and Completed are read-only).
const STAFF_EDITABLE = ["Pending", "In Progress", "Rejected"];
const TABS = [
  ["today", "📋 Today's Tasks"], ["pending", "⏳ Pending"],
  ["upcoming", "📅 Upcoming"], ["completed", "✅ Completed"],
];
// "All" first, then every frequency in the order Daily/Weekly/Monthly/Once.
const FREQ_FILTERS = [
  ["all", "All"],
  ...FREQUENCIES.filter((f) => f.value !== "once").map((f) => [f.value, f.label]),
  ["once", "Once"],
];

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
    let active = true;
    getSession().then((u) => { if (active) setUser(u); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function load() {
    setLoading(true);
    setFreqFilter("all"); // never carry a stale filter across loads
    const today = todayStr();
    const from = addDays(today, -HISTORY_DAYS);
    const to = addDays(today, UPCOMING_DAYS);

    const t = await fetchTasks();
    const myTasks = (t.data || []).filter((task) => task.assigned_to === user.id && task.enabled);
    setTasks(myTasks);

    // Read existing rows (incl. overdue + recent history) for the wide
    // window, but only generate new rows from today forward.
    const taskIds = myTasks.map((task) => task.id);
    const existing = taskIds.length ? await fetchOccurrences({ from, to, taskIds }) : { data: [] };
    const ensured = await ensureOccurrences(myTasks, existing.data || [], today, to);
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
  const completedTasks = occurrences
    .filter((o) => o.status === "Completed" && matchesFreq(o))
    .sort((a, b) => (a.due_date > b.due_date ? -1 : a.due_date < b.due_date ? 1 : 0));

  // Returns an error message (kept in the modal, e.g. to offer Retry) or null.
  async function handleSaveUpdate(occurrence, { action, status, remarks, blobs }) {
    let res;
    try {
      res = action === "submit"
        ? await submitForReview(occurrence.id, { remarks, blobs })
        : await saveProgress(occurrence.id, { status, remarks });
    } catch (err) {
      return err.message;
    }
    if (res.error) return res.error.message;
    setOccurrences((prev) => prev.map((o) => (o.id === occurrence.id ? res.data : o)));
    showToast(action === "submit" ? "Submitted for review." : "Task updated.");
    setUpdating(null);
    return null;
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
              {tab === "completed" && `Nothing completed in the last ${HISTORY_DAYS} days.`}
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

      {o.status === "Completed" && o.completed_at && (
        <div className="note" style={{ margin: "-6px 0 10px" }}>✅ Completed {formatDateTime(o.completed_at)}</div>
      )}
      {o.status === "Awaiting Review" && o.submitted_at && (
        <div className="note" style={{ margin: "-6px 0 10px" }}>📤 Submitted {formatDateTime(o.submitted_at)} — waiting for the Manager to review</div>
      )}

      {o.status === "Rejected" && <ReviewNote occurrence={o} />}

      {o.remarks && <div className="note" style={{ margin: "0 0 10px" }}><b>Remarks:</b> {o.remarks}</div>}

      {(o.status === "Awaiting Review" || o.status === "Completed") && <PhotoThumbs photos={o.task_photos} />}

      {STAFF_EDITABLE.includes(o.status) && (
        <button className="btn btn-primary btn-block" onClick={onUpdate}>
          {o.status === "Rejected" ? "Fix & Resubmit" : "Update Task"}
        </button>
      )}
    </div>
  );
}

// The Manager's rejection note, shown prominently on Needs Correction work.
function ReviewNote({ occurrence: o }) {
  return (
    <div className="review-note">
      <b>⚠️ Needs correction{o.rejection_count > 1 ? ` (returned ${o.rejection_count}×)` : ""}:</b>{" "}
      {o.review_note || "The Manager asked for this task to be redone."}
      <div style={{ fontSize: 12, marginTop: 4 }}>Fix it, take new photos, and submit again.</div>
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

function formatKB(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

let photoKey = 0;

// Staff can: change status between Pending / In Progress, add remarks, and
// Submit for Review with 1-5 photos. Only the Manager can complete a task.
function UpdateTaskModal({ occurrence, task, onCancel, onSave }) {
  const isRejected = occurrence.status === "Rejected";
  const [status, setStatus] = useState(STAFF_STATUSES.includes(occurrence.status) ? occurrence.status : "Pending");
  const [remarks, setRemarks] = useState(occurrence.remarks || "");
  // [{ key, name, state: "compressing" | "ready", blob, url, size }]
  const [photos, setPhotos] = useState([]);
  const [photoError, setPhotoError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(""); // "", "saving", "submitting"
  const urlsRef = useRef([]);

  // Free preview object URLs when the modal closes.
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const readyPhotos = photos.filter((p) => p.state === "ready");
  const compressing = photos.some((p) => p.state === "compressing");
  const canSubmit = readyPhotos.length >= MIN_PHOTOS && !compressing && !busy;

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow picking the same file again later
    if (!files.length) return;
    setPhotoError("");
    setSubmitError("");

    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setPhotoError(`You can attach at most ${MAX_PHOTOS} photos. Remove one to add another.`);
      return;
    }
    if (files.length > room) {
      setPhotoError(`Only ${MAX_PHOTOS} photos allowed — added the first ${room}, skipped ${files.length - room}.`);
    }
    const batch = files.slice(0, room).map((file) => ({ key: ++photoKey, name: file.name, state: "compressing", file }));
    setPhotos((prev) => [...prev, ...batch]);

    for (const item of batch) {
      try {
        const blob = await compressImage(item.file);
        const url = URL.createObjectURL(blob);
        urlsRef.current.push(url);
        setPhotos((prev) => prev.map((p) => (p.key === item.key ? { key: p.key, name: p.name, state: "ready", blob, url, size: blob.size } : p)));
      } catch (err) {
        setPhotos((prev) => prev.filter((p) => p.key !== item.key));
        setPhotoError(`${item.name}: ${err.message}`);
      }
    }
  }

  function removePhoto(key) {
    setPhotos((prev) => prev.filter((p) => p.key !== key));
    setPhotoError("");
  }

  async function run(action) {
    setBusy(action === "submit" ? "submitting" : "saving");
    setSubmitError("");
    const err = await onSave(
      action === "submit"
        ? { action, remarks, blobs: readyPhotos.map((p) => p.blob) }
        : { action, remarks, status: isRejected ? undefined : status },
    );
    if (err) setSubmitError(err);
    setBusy("");
  }

  return (
    <div className="dialog-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="dialog" style={{ maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3>{taskEmoji(task?.task_name)} {task?.task_name}</h3>

        {isRejected && <ReviewNote occurrence={occurrence} />}

        {!isRejected && (
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!!busy}>
              {STAFF_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        <div className="field" style={{ marginBottom: 12 }}>
          <label>Remarks</label>
          <textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional notes" disabled={!!busy} />
        </div>

        <div className="field" style={{ marginBottom: 6 }}>
          <label>Photo evidence ({photos.length}/{MAX_PHOTOS})</label>
          <div className="note" style={{ margin: "0 0 6px" }}>
            {isRejected ? "Take new photos of the corrected work." : `Add ${MIN_PHOTOS}–${MAX_PHOTOS} photos to submit for review.`}
          </div>
          <div className="photo-grid">
            {photos.map((p) => (
              <div key={p.key} className="photo-thumb" style={{ cursor: "default" }}>
                {p.state === "ready" ? (
                  <>
                    <img src={p.url} alt={p.name} />
                    <span className="photo-thumb-caption">{formatKB(p.size)}</span>
                  </>
                ) : (
                  <span className="photo-thumb-caption" style={{ top: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    compressing…
                  </span>
                )}
                {!busy && (
                  <button type="button" className="photo-thumb-remove" onClick={() => removePhoto(p.key)} aria-label={`Remove ${p.name}`}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {photos.length < MAX_PHOTOS && !busy && (
            <label className="btn btn-secondary btn-block" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13.5, cursor: "pointer" }}>
              📷 Add photos
              {/* No `capture` attribute, so phones offer both camera and gallery. */}
              <input type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: "none" }} />
            </label>
          )}
          {photoError && <div className="note" style={{ color: "var(--danger)", margin: "6px 0 0" }}>{photoError}</div>}
        </div>

        {submitError && (
          <div className="review-note" style={{ marginTop: 10, background: "var(--danger-bg)", borderColor: "#f0b9b9", color: "var(--danger)" }}>
            {submitError}
            {readyPhotos.length >= MIN_PHOTOS && (
              <div style={{ marginTop: 6 }}>
                <button className="btn btn-sm btn-secondary" onClick={() => run("submit")} disabled={!canSubmit}>↻ Retry submit</button>
              </div>
            )}
          </div>
        )}

        <div className="dialog-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={!!busy}>Cancel</button>
          <button className="btn btn-secondary" onClick={() => run("save")} disabled={!!busy || compressing}>
            {busy === "saving" ? "Saving..." : "Save Progress"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => run("submit")}
            disabled={!canSubmit}
            title={readyPhotos.length < MIN_PHOTOS ? "Attach at least one photo first" : undefined}
          >
            {busy === "submitting" ? "Uploading..." : "Submit for Review"}
          </button>
        </div>
      </div>
    </div>
  );
}
