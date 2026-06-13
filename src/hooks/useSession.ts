"use client";

import { useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { Address } from "viem";
import { findOrgByDomain, type EnrolledOrg } from "@/lib/orgs";

/**
 * The unified session the whole app converges on (architecture doc §3):
 * always `{ address, verifiedEmailDomain? }`, plus the matched org if the domain is enrolled.
 *
 * Phase 1 sources this entirely from Privy (email login → embedded wallet). The "connect
 * wallet" and "type .eth name → SIWE" doors (§4) feed the same shape in Phase 2.
 */
export interface Session {
  /** Privy has finished initializing. */
  ready: boolean;
  authenticated: boolean;
  /** Verified email address, if the user logged in with email. */
  email: string | null;
  /** Lowercased domain of the verified email — the eligibility key. */
  verifiedEmailDomain: string | null;
  /** Embedded (or linked) wallet address. May be null briefly while Privy provisions it. */
  address: Address | null;
  /** Enrolled org matched by verifiedEmailDomain, or null. */
  org: EnrolledOrg | null;
  login: () => void;
  logout: () => void;
}

export function useSession(): Session {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const email = user?.email?.address ?? null;
  const verifiedEmailDomain = email ? (email.split("@")[1]?.toLowerCase() ?? null) : null;
  const address = (user?.wallet?.address as Address | undefined) ?? null;

  const org = useMemo(
    () => (verifiedEmailDomain ? (findOrgByDomain(verifiedEmailDomain) ?? null) : null),
    [verifiedEmailDomain],
  );

  return { ready, authenticated, email, verifiedEmailDomain, address, org, login, logout };
}
