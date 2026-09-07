"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchEquipment, fetchStaffUsers, addTask } from "../../../../lib/data";
import { isSupabaseConfigured } from "../../../../lib/supabaseClient";
import { useToast } from "../../../../components/useToast";
import TaskForm from "../../../../components/TaskForm";

export default function AddNewTaskPage() {
  const router = useRouter();
  const { showToast, ToastHost } = useToast();
  const [equipment, setEquipment] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchEquipment(), fetchStaffUsers()]).then(([e, s]) => {
      setEquipment(e.data || []);
      setStaff(s.data || []);
      setLoading(false);
    });
  }, []);

  async function handleSubmit(values) {
    const { error } = await addTask(values);
    if (error) throw new Error(error.message);
    showToast("Maintenance task created successfully.");
    router.push("/manager/tasks");
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>Add New Maintenance Task</h2>

      {!isSupabaseConfigured && (
        <div className="card" style={{ background: "var(--warning-bg)", borderColor: "#f0d9ac" }}>
          <b style={{ color: "var(--warning)" }}>Supabase isn't connected yet.</b>
          <div className="note" style={{ margin: "2px 0 0" }}>
            Add your Supabase credentials to <code>.env.local</code> before tasks can be saved — see the README.
          </div>
        </div>
      )}

      <div className="card" style={{ maxWidth: 480 }}>
        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <TaskForm
            equipmentList={equipment}
            staffList={staff}
            onSubmit={handleSubmit}
            submitLabel="Save Task"
          />
        )}
      </div>

      <ToastHost />
    </div>
  );
}
