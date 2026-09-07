"use client";

export default function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className={"btn " + (danger ? "btn-danger" : "btn-primary")} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
