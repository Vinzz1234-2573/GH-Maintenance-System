import Link from "next/link";

export default function LandingPage() {
  return (
    <div>
      <section
        style={{
          position: "relative",
          minHeight: "78vh",
          display: "flex",
          alignItems: "center",
          backgroundImage: `linear-gradient(rgba(15,23,42,0.62), rgba(15,23,42,0.72)), url('/gentlehill-hero.jpg')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          color: "#fff",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center", padding: "40px 20px" }}>
          <img
            src="/gentlehill-logo.png"
            alt="Gentle Hill Elder Care"
            style={{ width: "min(320px, 80vw)", marginBottom: 22 }}
          />
          <h1 style={{ fontSize: "clamp(22px, 4vw, 32px)", fontWeight: 800, margin: "0 0 8px", lineHeight: 1.3 }}>
            Gentle Hill Elder Care Centre
          </h1>
          <div style={{ fontSize: "clamp(15px, 2.4vw, 19px)", fontWeight: 600, color: "#dce8fb", marginBottom: 34 }}>
            Daily Equipment Maintenance System
          </div>

          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/login/manager" className="btn btn-primary" style={{ minWidth: 190, textDecoration: "none", fontSize: 15 }}>
              Manager Login
            </Link>
            <Link
              href="/login/staff"
              className="btn"
              style={{
                minWidth: 190, textDecoration: "none", fontSize: 15,
                background: "#fff", color: "var(--primary-dark)", fontWeight: 700,
              }}
            >
              Staff Login
            </Link>
          </div>
        </div>
      </section>

      <section className="page-shell" style={{ maxWidth: 720, textAlign: "center", paddingTop: 36 }}>
        <div className="note" style={{ fontSize: 13 }}>
          A simple daily checklist for Gentle Hill's maintenance equipment —
          track tasks, assign staff, and keep a record of what's been done.
        </div>
      </section>
    </div>
  );
}
