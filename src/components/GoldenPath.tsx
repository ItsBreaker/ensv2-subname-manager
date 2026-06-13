"use client";

import { useSession } from "@/hooks/useSession";
import { LoginButton } from "./LoginButton";
import { Manager } from "./Manager";

/**
 * The golden-path gate: routes between the login CTA and the manager based on session state.
 *
 * When Privy isn't configured (no NEXT_PUBLIC_PRIVY_APP_ID), the Providers tree skips
 * PrivyProvider, so we must NOT call usePrivy here — render the (disabled) LoginButton, which
 * handles that case itself. The session-aware inner component only mounts when configured.
 */
export function GoldenPath() {
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  if (!configured) return <LoginButton />;
  return <GoldenPathInner />;
}

function GoldenPathInner() {
  const session = useSession();

  if (!session.ready) {
    return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  }
  if (!session.authenticated) {
    return <LoginButton />;
  }
  return <Manager session={session} />;
}

export default GoldenPath;
