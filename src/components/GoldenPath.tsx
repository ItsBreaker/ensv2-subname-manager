"use client";

import { useState } from "react";
import { useSession } from "@/hooks/useSession";
import { LoginButton } from "./LoginButton";
import { Manager } from "./Manager";
import { ButtonWithInfo } from "./ui";

export type Mode = "member" | "admin";

/**
 * Entry gate. When Privy isn't configured we fall back to the (disabled) LoginButton. Otherwise we
 * offer two doors, member vs admin, which set the post-login surface (members claim names; admins set
 * up and manage the org). Both use the same Privy email login.
 */
export function GoldenPath() {
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  if (!configured) return <LoginButton />;
  return <GoldenPathInner />;
}

function GoldenPathInner() {
  const session = useSession();
  const [mode, setMode] = useState<Mode>("member");

  if (!session.ready) {
    return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  }
  if (session.authenticated) {
    return <Manager session={session} mode={mode} setMode={setMode} />;
  }
  return (
    <Landing
      onPick={(m) => {
        setMode(m);
        session.login();
      }}
    />
  );
}

const buttonBase: React.CSSProperties = {
  appearance: "none",
  font: "600 15px/1 inherit",
  padding: "13px 22px",
  borderRadius: 11,
  cursor: "pointer",
};

const EXAMPLES = [
  {
    title: "One name, paid everywhere",
    body: "Share you.org.eth instead of a 42-character address. Friends, clients, or your DAO can send you funds without copying a hex string.",
  },
  {
    title: "Proof you belong",
    body: "A subname under your org is a verifiable badge: dev.ethglobal.eth shows you are part of that community, issued by the org itself.",
  },
  {
    title: "Your profile, your wallet",
    body: "Your name carries a public profile (avatar, links) and points at the wallet you choose, so it works across wallets, apps, and marketplaces.",
  },
];

function Landing({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <section
        style={{
          display: "flex",
          gap: 28,
          alignItems: "stretch",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 300px", minWidth: 240 }}>
          <p
            style={{
              font: "600 12px/1 ui-monospace, monospace",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--accent)",
              margin: 0,
            }}
          >
            Onboard to ENS
          </p>
          <h1 style={{ fontSize: 40, lineHeight: 1.1, margin: "14px 0 14px", maxWidth: "18ch" }}>
            ENSv2 Subname Manager
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 17, maxWidth: "52ch", margin: 0 }}>
            Issue, manage, and revoke ENS subnames for your organization&apos;s members at scale. They
            sign in with just their email and get a real name like{" "}
            <strong style={{ color: "var(--ink)" }}>you.org.eth</strong>, with no seed phrases or crypto
            knowledge.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
            <ButtonWithInfo
              onClick={() => onPick("member")}
              info="Get your own name under your organization. Just sign in with your email."
              style={{ ...buttonBase, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff" }}
            >
              I&apos;m a member
            </ButtonWithInfo>
            <ButtonWithInfo
              onClick={() => onPick("admin")}
              info="Set up and manage your organization: register or connect its name, add and remove members, create groups."
              style={{ ...buttonBase, border: "1px solid var(--line)", background: "transparent", color: "var(--ink)" }}
            >
              I&apos;m an admin
            </ButtonWithInfo>
          </div>
        </div>

        {/* Banner fills a column that stretches to the text height, so it never grows taller than
            the title/description/buttons. minHeight is the fallback when it wraps below on mobile. */}
        <div
          style={{
            flex: "2 1 300px",
            minWidth: 280,
            minHeight: 200,
            position: "relative",
            overflow: "hidden",
            borderRadius: 16,
            border: "1px solid var(--line)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ensv2_subname_manager_banner.png"
            alt="ENS Subname Manager"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 14px", color: "var(--ink)" }}>
          Where a name like this helps
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          {EXAMPLES.map((e) => (
            <div
              key={e.title}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 14,
                padding: "16px 18px",
                background: "#fff",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{e.title}</div>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>{e.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default GoldenPath;
