"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { Address } from "viem";

/**
 * The unified session the whole app converges on (architecture doc §3): always
 * `{ address, verifiedEmailDomain? }`, sourced from Privy (email login → embedded wallet).
 *
 * Org eligibility is NO LONGER derived here — that lookup hits Supabase with the secret key, which
 * is server-only. Components fetch `/api/org` for the matched org instead (see Manager).
 */
export interface Session {
  ready: boolean;
  authenticated: boolean;
  email: string | null;
  verifiedEmailDomain: string | null;
  address: Address | null;
  login: () => void;
  logout: () => void;
}

export function useSession(): Session {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const email = user?.email?.address ?? null;
  const verifiedEmailDomain = email ? (email.split("@")[1]?.toLowerCase() ?? null) : null;
  const address = (user?.wallet?.address as Address | undefined) ?? null;

  return { ready, authenticated, email, verifiedEmailDomain, address, login, logout };
}
