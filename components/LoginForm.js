"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { findUser } from "../lib/data";
import { setSession } from "../lib/session";

export default function LoginForm({ role, dashboardHref, title }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { data: user, error: err } = await findUser(name, role);
      if (err) throw new Error(err.message);
      if (!user) {
        setError("User not found. Please check your name and try again.");
        return;
      }
      if (user.role !== role) {
        setError(`This account does not have ${role === "manager" ? "Manager" : "Staff"} access.`);
        return;
      }
      setSession(user);
      router.push(dashboardHref);
    } catch (e) {
      setError(e.message || "Login failed — please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="page-shell" style={{ maxWidth: 380, paddingTop: 70 }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <img src="/gentlehill-mark.png" alt="Gentle Hill Elder Care" style={{ width: 56, height: 56, borderRadius: 10 }} />
      </div>
      <div className="card">
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>{title}</h2>
        <div className="note" style={{ margin: "0 0 14px" }}>
          Enter your name to continue. No password is required yet.
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Username</label>
            <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Username" />
          </div>
          {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
          <button className="btn btn-primary btn-block" disabled={loading || !name.trim()}>
            {loading ? "Checking..." : "Login"}
          </button>
        </form>
      </div>
      <Link href="/" className="btn btn-secondary btn-block" style={{ textDecoration: "none" }}>
        ← Back to Website
      </Link>
    </div>
  );
}
