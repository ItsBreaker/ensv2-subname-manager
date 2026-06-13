import { GoldenPath } from "@/components/GoldenPath";

/**
 * Landing page: the app title and the golden-path entry (login, then the manager).
 */
export default function Home() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "64px 24px 96px",
      }}
    >
      <p
        style={{
          font: "600 12px/1 ui-monospace, monospace",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--accent)",
        }}
      >
        Subname Manager
      </p>
      <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: "10px 0 12px" }}>
        Your name, under your organization
      </h1>
      <p style={{ color: "var(--muted)", maxWidth: "60ch" }}>
        Sign in with your email, get a secure wallet, and claim your own ENS name under your
        organization. Every control explains itself in plain language.
      </p>

      <div style={{ margin: "28px 0 40px" }}>
        <GoldenPath />
      </div>
    </main>
  );
}
