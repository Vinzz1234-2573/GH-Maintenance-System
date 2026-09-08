"use client";

import { useState } from "react";
import { FREQUENCIES, WEEKDAYS } from "../lib/schedule";
import { todayStr } from "../lib/dates";

const BLANK = {
  equipment_id: "", task_name: "", description: "", assigned_to: "",
  frequency: "once", weekly_days: [], monthly_day: 1, start_date: "", enabled: true,
};

export default function TaskForm({ initial, equipmentList, staffList, onSubmit, onCancel, submitLabel = "Save Task" }) {
  const [values, setValues] = useState({ ...BLANK, ...initial, start_date: initial?.start_date || todayStr() });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  function toggleWeekday(day) {
    setValues((v) => {
      const has = v.weekly_days.includes(day);
      return { ...v, weekly_days: has ? v.weekly_days.filter((d) => d !== day) : [...v.weekly_days, day].sort() };
    });
  }

  async function handleSubmit() {
    if (!values.equipment_id) return setError("Please select the equipment.");
    if (!values.task_name.trim()) return setError("Task description is required.");
    if (!values.assigned_to) return setError("Please assign this task to a staff member.");
    if (values.frequency === "weekly" && values.weekly_days.length === 0) {
      return setError("Pick at least one day of the week.");
    }
    if (values.frequency === "monthly" && (!values.monthly_day || values.monthly_day < 1 || values.monthly_day > 31)) {
      return setError("Day of month must be between 1 and 31.");
    }
    setError("");
    setSaving(true);
    try {
      await onSubmit({ ...values, monthly_day: values.frequency === "monthly" ? Number(values.monthly_day) : null });
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
      <div className="field" style={{ marginBottom: 10 }}>
        <label>Assign To</label>
        <select value={values.assigned_to} onChange={set("assigned_to")}>
          <option value="">Select staff...</option>
          {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="field" style={{ marginBottom: 10 }}>
        <label>Frequency</label>
        <select value={values.frequency} onChange={set("frequency")}>
          {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {values.frequency === "once" && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Due Date</label>
          <input type="date" value={values.start_date} onChange={set("start_date")} />
        </div>
      )}

      {values.frequency === "weekly" && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Repeats On</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {WEEKDAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                className="btn btn-sm"
                onClick={() => toggleWeekday(d.value)}
                style={{
                  border: "1px solid " + (values.weekly_days.includes(d.value) ? "var(--primary)" : "var(--border)"),
                  background: values.weekly_days.includes(d.value) ? "var(--primary)" : "#fff",
                  color: values.weekly_days.includes(d.value) ? "#fff" : "var(--muted)",
                  fontWeight: 700,
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {values.frequency === "monthly" && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Day of Month</label>
          <input
            type="number" min={1} max={31} value={values.monthly_day}
            onChange={(e) => setValues((v) => ({ ...v, monthly_day: e.target.value }))}
          />
          <div className="note" style={{ margin: "4px 0 0" }}>
            If a month is shorter than this day, it falls on the last day of that month.
          </div>
        </div>
      )}

      {values.frequency !== "once" && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Starts From</label>
          <input type="date" value={values.start_date} onChange={set("start_date")} />
        </div>
      )}

      <div className="field" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          id="enabled-toggle"
          style={{ width: "auto" }}
          checked={values.enabled}
          onChange={(e) => setValues((v) => ({ ...v, enabled: e.target.checked }))}
        />
        <label htmlFor="enabled-toggle" style={{ margin: 0, textTransform: "none", fontSize: 13.5 }}>
          Enabled — visible on the Staff dashboard
        </label>
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
