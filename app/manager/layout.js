"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSession, clearSession } from "../../lib/session";

const NAV = [
  { href: "/manager", label: "Dashboard" },
  { href: "/manager/equipment", label: "Equipment" },
  { href: "/manager/tasks", label: "Maintenance Tasks" },
  { href: "/manager/tasks/new", label: "+ Add New Task" },
];

const ECMS_URL = "https://ecms.gentlehill.my/login";

export default function ManagerLayout({ children }) {
  const [checked, setChecked] = useState(false);
  const [user, setUser] = useState(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== "manager") {
      router.replace("/login/manager");
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
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/gentlehill-mark.png" alt="" style={{ width: 34, height: 34, borderRadius: 7 }} />
            <div>
              <h1 style={{ fontSize: 17, fontWeight: 800 }}>Maintenance Manager</h1>
              <div style={{ fontSize: 11.5, color: "#c3d3f5" }}>Signed in as {user?.name}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>Back to Website</Link>
            <a href={ECMS_URL} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
              Login to ECMS
            </a>
            <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </div>
      <div style={{ background: "var(--primary-dark)", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", overflowX: "auto", padding: "0 20px" }}>
          {NAV.map((item) => {
            const active = item.href === "/manager" ? pathname === "/manager" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: "11px 16px", fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap",
                  color: active ? "#fff" : "#aebde0", textDecoration: "none",
                  borderBottom: "3px solid " + (active ? "#fff" : "transparent"),
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="page-shell" style={{ maxWidth: 1000 }}>{children}</div>
    </div>
  );
}
