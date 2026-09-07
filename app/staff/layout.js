"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSession, clearSession } from "../../lib/session";

export default function StaffLayout({ children }) {
  const [checked, setChecked] = useState(false);
  const [user, setUser] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== "staff") {
      router.replace("/login/staff");
      return;
    }
    setUser(session);
    setChecked(true);
  }, [router]);

  function handleLogout() {
    clearSession();
    router.push("/");
  }

  if (!checked) return <div className="loading">Checking access...</div>;

  return (
    <div>
      <div style={{ background: "var(--primary-dark)", color: "#fff", padding: "16px 20px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/gentlehill-mark.png" alt="" style={{ width: 34, height: 34, borderRadius: 7 }} />
            <div>
              <h1 style={{ fontSize: 17, fontWeight: 800 }}>My Maintenance Tasks</h1>
              <div style={{ fontSize: 11.5, color: "#c3d3f5" }}>Signed in as {user?.name}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>Back to Website</Link>
            <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </div>
      <div className="page-shell" style={{ maxWidth: 760 }}>{children}</div>
    </div>
  );
}
