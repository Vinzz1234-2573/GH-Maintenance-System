"use client";

import { useEffect, useState } from "react";
import { fetchEquipment, addEquipment, updateEquipment, deleteEquipment } from "../../../lib/data";
import { useToast } from "../../../components/useToast";
import ConfirmDialog from "../../../components/ConfirmDialog";

const BLANK = { equipment_name: "", location: "" };

export default function EquipmentPage() {
  const { showToast, ToastHost } = useToast();
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(BLANK);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await fetchEquipment();
    setEquipment(data || []);
    setLoading(false);
  }

  function openNew() {
    setEditing({ ...BLANK });
    setFormOpen(true);
  }
  function openEdit(item) {
    setEditing({ ...item });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!editing.equipment_name.trim()) return showToast("Equipment name is required.");
    const isNew = !editing.id;
    const payload = { equipment_name: editing.equipment_name.trim(), location: editing.location || "" };
    const { error } = isNew ? await addEquipment(payload) : await updateEquipment(editing.id, payload);
    if (error) return showToast(error.message);
    showToast(isNew ? "Equipment added." : "Equipment updated.");
    setFormOpen(false);
    load();
  }

  async function confirmDelete() {
    const item = deleteTarget;
    setDeleteTarget(null);
    const { error } = await deleteEquipment(item.id);
    if (error) return showToast(error.message);
    showToast("Equipment deleted.");
    load();
  }

  return (
    <div>
      <div className="panel-row">
        <h2 style={{ fontSize: 18, fontWeight: 800 }}>Equipment</h2>
        <button className="btn btn-primary" onClick={openNew}>+ Add Equipment</button>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : equipment.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>No equipment added yet.</div>
          <div className="note" style={{ margin: "0 0 18px" }}>Add equipment here before creating maintenance tasks for it.</div>
          <button className="btn btn-primary" onClick={openNew}>+ Add Equipment</button>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Equipment Name</th><th>Location</th><th>Actions</th></tr></thead>
            <tbody>
              {equipment.map((e) => (
                <tr key={e.id}>
                  <td data-label="Equipment Name"><b>{e.equipment_name}</b></td>
                  <td data-label="Location">{e.location || "—"}</td>
                  <td data-label="Actions">
                    <div className="table-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(e)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={() => setDeleteTarget(e)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <div className="dialog-backdrop" onClick={() => setFormOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{editing.id ? "Edit Equipment" : "Add Equipment"}</h3>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Equipment Name</label>
              <input
                type="text" autoFocus value={editing.equipment_name}
                onChange={(e) => setEditing((v) => ({ ...v, equipment_name: e.target.value }))}
                placeholder="e.g. Water Pump"
              />
            </div>
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Location</label>
              <input
                type="text" value={editing.location}
                onChange={(e) => setEditing((v) => ({ ...v, location: e.target.value }))}
                placeholder="e.g. Basement"
              />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete equipment?"
        message={`Are you sure you want to delete "${deleteTarget?.equipment_name}"? Maintenance tasks referencing it will keep their history but show no equipment name.`}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ToastHost />
    </div>
  );
}
