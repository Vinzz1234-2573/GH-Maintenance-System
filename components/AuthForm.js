"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isSupabaseConfigured } from "../lib/supabaseClient";
import { loadSession, signIn, signUp, signOut, homeFor } from "../lib/session";
import { validateLogin, validateSignup, friendlyAuthError } from "../lib/authHelpers";

const PROFILE_MISSING =
  "Your login worked, but no profile is linked to it, so you've been signed out. Please contact your administrator.";

// Eye icon for the show/hide password button (eye = "click to show",
// eye with a slash = "click to hide").
function EyeIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

// One form for both pages: /login (mode="login") and /signup (mode="signup").
// After a successful login/signup the person is sent to the dashboard for the
// role stored in the database (manager -> /manager, staff -> /staff).
export default function AuthForm({ mode }) {
  const isSignup = mode === "signup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false); // eye button: show the typed password(s)
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Already logged in? Skip the form. Also shows the "no profile" message
  // when a dashboard layout bounced a profile-less login back here.
  useEffect(() => {
    let active = true;
    if (new URLSearchParams(window.location.search).get("e") === "no-profile") setError(PROFILE_MISSING);
    loadSession().then(async ({ user, reason }) => {
      if (!active) return;
      if (user) router.replace(homeFor(user.role));
      else if (reason === "no-profile") {
        await signOut();
        if (active) setError(PROFILE_MISSING);
      }
    });
    return () => { active = false; };
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    const problem = isSignup
      ? validateSignup({ email, password, confirm })
      : validateLogin({ email, password });
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    try {
      if (isSignup) {
        const res = await signUp(email, password);
        if (res.error) {
          setError(friendlyAuthError(res.error));
          return;
        }
        if (res.needsConfirmation) {
          // Only happens if "Confirm email" is switched ON in Supabase.
          setNotice("Check your email to confirm your account, then come back and log in.");
          setPassword("");
          setConfirm("");
          return;
        }
      } else {
        const res = await signIn(email, password);
        if (res.error) {
          setError(friendlyAuthError(res.error));
          return;
        }
      }

      // Logged in. Where they go depends on the role in the database.
      const { user, reason, message } = await loadSession();
      if (user) {
        router.replace(homeFor(user.role));
        return;
      }
      if (reason === "no-profile") {
        await signOut();
        setError(PROFILE_MISSING);
      } else {
        setError(message ? `Couldn't load your profile: ${message}` : "Couldn't load your profile. Please try again.");
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell" style={{ maxWidth: 380, paddingTop: 70 }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <img src="/gentlehill-mark.png" alt="Gentle Hill Elder Care" style={{ width: 56, height: 56, borderRadius: 10 }} />
      </div>
      <div className="card">
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>{isSignup ? "Sign up" : "Login"}</h2>
        <div className="note" style={{ margin: "0 0 14px" }}>
          {isSignup
            ? "Create your account with your company email address."
            : "Log in with your email and password."}
        </div>

        {!isSupabaseConfigured && (
          <div className="card" style={{ background: "var(--warning-bg)", borderColor: "#f0d9ac", padding: 12 }}>
            <b style={{ color: "var(--warning)" }}>Supabase isn't connected yet.</b>
            <div className="note" style={{ margin: "2px 0 0" }}>
              Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> — see the README.
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email" type="email" autoFocus autoComplete="email" inputMode="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="auth-password">Password</label>
            <div className="pw-wrap">
              <input
                id="auth-password" type={showPassword ? "text" : "password"} autoComplete={isSignup ? "new-password" : "current-password"}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? "At least 8 characters" : "Password"}
              />
              <button
                type="button" className="pw-toggle" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>
          </div>
          {isSignup && (
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="auth-confirm">Confirm password</label>
              <div className="pw-wrap">
                <input
                  id="auth-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again"
                />
                <button
                  type="button" className="pw-toggle" onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
            </div>
          )}
          {error && <div className="error-text" style={{ marginBottom: 10 }} role="alert">{error}</div>}
          {notice && (
            <div className="review-note" style={{ marginBottom: 10, background: "var(--success-bg)", borderColor: "#b7e0c3", color: "var(--success)" }} role="status">
              {notice}
            </div>
          )}
          <button className="btn btn-primary btn-block" disabled={loading || !isSupabaseConfigured}>
            {isSignup ? (loading ? "Creating account..." : "Sign up") : (loading ? "Logging in..." : "Login")}
          </button>
        </form>

        <div className="note" style={{ margin: "14px 0 0", textAlign: "center", fontSize: 13.5 }}>
          {isSignup ? (
            <>Already have an account? <Link href="/login" style={{ fontWeight: 700 }}>Log in</Link></>
          ) : (
            <>Don't have an account? <Link href="/signup" style={{ fontWeight: 700 }}>Sign up</Link></>
          )}
        </div>
        {!isSignup && (
          <div className="note" style={{ margin: "6px 0 0", textAlign: "center" }}>
            Forgot your password? Ask your manager or administrator.
          </div>
        )}
      </div>
      <Link href="/" className="btn btn-secondary btn-block" style={{ textDecoration: "none" }}>
        ← Back to Website
      </Link>
    </div>
  );
}
