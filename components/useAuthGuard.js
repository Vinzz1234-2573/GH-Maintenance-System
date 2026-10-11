"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadSession, onSessionChange, signOut, homeFor } from "../lib/session";

// Access control for a role's section of the app (used by the Manager and
// Staff layouts):
//   - not logged in            -> /login
//   - logged in as another role -> that person's own dashboard
//   - signed out in another tab -> /login
// Returns { user, gate, logout }. While `gate` is non-null (checking, or the
// check failed) render it instead of the page; once it is null `user` is set.
export function useAuthGuard(requiredRole) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [problem, setProblem] = useState("");
  const [attempt, setAttempt] = useState(0);
  const authIdRef = useRef(null);
  const leavingRef = useRef(false); // we are signing out on purpose; don't also redirect to /login

  useEffect(() => {
    let active = true;

    async function check() {
      const { user: current, reason, message } = await loadSession();
      if (!active) return;
      if (current) {
        if (current.role !== requiredRole) {
          router.replace(homeFor(current.role));
          return;
        }
        authIdRef.current = current.authId;
        setProblem("");
        setUser(current);
        return;
      }
      if (reason === "error") {
        // Couldn't verify (network / database): don't throw them out, let them retry.
        setProblem(message || "Couldn't check your login.");
        return;
      }
      if (reason === "no-profile") {
        leavingRef.current = true;
        await signOut();
        router.replace("/login?e=no-profile");
        return;
      }
      router.replace("/login");
    }
    check();

    const stopListening = onSessionChange((event, authId) => {
      if (!active || leavingRef.current) return;
      if (event === "SIGNED_OUT") {
        router.replace("/login");
      } else if (event === "SIGNED_IN" && authIdRef.current && authId && authId !== authIdRef.current) {
        // A different person logged in from another tab: start over as them.
        window.location.reload();
      }
    });
    return () => {
      active = false;
      stopListening();
    };
  }, [router, requiredRole, attempt]);

  const logout = useCallback(async () => {
    leavingRef.current = true;
    await signOut();
    router.push("/");
  }, [router]);

  let gate = null;
  if (problem) {
    gate = (
      <div className="page-shell" style={{ maxWidth: 420, paddingTop: 70 }}>
        <div className="card">
          <b style={{ color: "var(--danger)" }}>Couldn't check your login</b>
          <div className="note" style={{ margin: "4px 0 12px" }}>{problem}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={() => { setProblem(""); setAttempt((n) => n + 1); }}>Try again</button>
            <button className="btn btn-secondary" onClick={logout}>Log out</button>
          </div>
        </div>
      </div>
    );
  } else if (!user) {
    gate = <div className="loading">Checking access...</div>;
  }

  return { user, gate, logout };
}
