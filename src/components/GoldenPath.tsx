"use client";

import { useState } from "react";
import { useSession } from "@/hooks/useSession";
import { InfoTip } from "./InfoTip";
import { LoginButton } from "./LoginButton";
import { Manager } from "./Manager";

export type Mode = "member" | "admin";

/**
 * Entry gate. When Privy isn't configured we fall back to the (disabled) LoginButton. Otherwise we
 * offer two doors — member vs admin — which set the post-login surface (architecture doc: members
 * claim names; admins set up + manage the org). Both use the same Privy email login.
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
  if (!session.authenticated) {
    return (
      <EntryButtons
        onPick={(m) => {
          setMode(m);
          session.login();
        }}
      />
    );
  }
  return <Manager session={session} mode={mode} setMode={setMode} />;
}

const buttonBase: React.CSSProperties = {
  appearance: "none",
  font: "600 15px/1 inherit",
  padding: "12px 20px",
  borderRadius: 10,
  cursor: "pointer",
};

function EntryButtons({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <button
          style={{ ...buttonBase, border: "1px solid #2c3a5e", background: "var(--accent)", color: "#0f1117" }}
          onClick={() => onPick("member")}
        >
          I&apos;m a member
        </button>
        <InfoTip>Get your own name under your organization. Just sign in with your email.</InfoTip>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <button
          style={{ ...buttonBase, border: "1px solid var(--line)", background: "transparent", color: "var(--ink)" }}
          onClick={() => onPick("admin")}
        >
          I&apos;m an admin
        </button>
        <InfoTip>
          Set up and manage your organization: register its name, add and remove members, and more.
        </InfoTip>
      </span>
    </div>
  );
}

export default GoldenPath;
