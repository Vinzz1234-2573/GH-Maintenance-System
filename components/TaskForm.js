"use client";

import { useState } from "react";
import { STATUSES } from "../lib/data";

const BLANK = {
  equipment_id: "", task_name: "", description: "",
  assigned_to: "", status: "Pending", date: "", remarks: "", is_daily: false,
};

export default function TaskForm({ initial, equipmentList, staffList, onSubmit, onCancel, submitLabel = "Save Task" }) {
  const [values, setValues] = useState({ ...BLANK, ...initial });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  async function handleSubmit() {
    if (!values.equipment_id) return setError("Please select the equipment.");
    if (!values.task_name.trim()) return setError("Task description is required.");
    if (!values.assigned_to) return setError("Please assign this task to a staff member.");
    setError("");
    setSaving(true);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e.message || "Could not save this task.");
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>Equipment Name</label>
        <select value={values.equipment_id} onChange={set("equipment_id")}>
          <option value="">Select equipment...</option>
          {equipmentList.map((e) => (
            <option key={e.id} value={e.id}>{e.equipment_name}{e.location ? ` (${e.location})` : ""}</option>
          ))}
        </select>
        {equipmentList.length === 0 && (
          <div className="note" style={{ margin: "4px 0 0" }}>
            No equipment yet — add some on the Equipment page first.
          </div>
        )}
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>Maintenance Task / Description</label>
        <textarea rows={2} value={values.task_name} onChange={set("task_name")} placeholder="e.g. Check water pump pressure" />
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>Additional Details (optional)</label>
        <textarea rows={2} value={values.description} onChange={set("description")} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Assign To</label>
          <select value={values.assigned_to} onChange={set("assigned_to")}>
            <option value="">Select staff...</option>
            {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select value={values.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>Due Date</label>
        <input type="date" value={values.date || ""} onChange={set("date")} />
      </div>
      <div className="field" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          id="is-daily-toggle"
          style={{ width: "auto" }}
          checked={values.is_daily}
          onChange={(e) => setValues((v) => ({ ...v, is_daily: e.target.checked }))}
        />
        <label htmlFor="is-daily-toggle" style={{ margin: 0, textTransform: "none", fontSize: 13.5 }}>
          Repeats daily — resets to Pending every day, for staff to check off each shift
        </label>
      </div>
      <div className="field" style={{ marginBottom: 16 }}>
        <label>Remarks</label>
        <textarea rows={2} value={values.remarks} onChange={set("remarks")} placeholder="Optional" />
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="dialog-actions">
        {onCancel && <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>
          {saving ? "Saving..." : submitLabel}
        </button>
      </div>
    </div>
  );
}
