import { LoginButton } from "@/components/LoginButton";
import { InfoTip } from "@/components/InfoTip";
import { CONTRACTS } from "@/lib/contracts";

/**
 * Phase 0 landing page — a skeleton to confirm the app boots and providers are wired.
 * Intentionally feature-free: just the placeholder login control and a sanity readout of
 * the pinned ENSv2 Sepolia addresses. Real flows land in Phase 1+.
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
        ETHGlobal New York 2026 · Sepolia
      </p>
      <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: "10px 0 12px" }}>
        Onboard-to-ENS Subname Manager
      </h1>
      <p style={{ color: "var(--muted)", maxWidth: "60ch" }}>
        Phase 0 skeleton. Sign in with email, get a wallet, and (soon) receive an ENS subname
        under your organization. Every control will explain itself in plain language.
      </p>

      <div style={{ margin: "28px 0 40px" }}>
        <LoginButton />
      </div>

      <section
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: "18px 20px",
        }}
      >
        <h2 style={{ fontSize: 15, margin: "0 0 12px", display: "flex", alignItems: "center" }}>
          ENSv2 contracts (Sepolia)
          <InfoTip learnMoreHref="https://github.com/gskril/ens-cli">
            The live ENSv2 contract addresses this app builds against, pinned from the
            architecture doc.
          </InfoTip>
        </h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--muted)" }}>
          {Object.entries(CONTRACTS).map(([name, address]) => (
            <li key={name} style={{ margin: "4px 0" }}>
              <strong style={{ color: "var(--ink)" }}>{name}</strong>:{" "}
              <code>{address}</code>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
