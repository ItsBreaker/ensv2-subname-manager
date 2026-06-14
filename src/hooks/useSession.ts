"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";

/**
 * The unified session the whole app converges on (architecture doc §3): always
 * `{ address, verifiedEmailDomain? }`, sourced from Privy (email login → embedded wallet).
 *
 * Now also surfaces any EXTERNAL wallets the user has linked (MetaMask, etc.). Login stays
 * email-first (email = eligibility); linking a wallet is additive — used to receive names at a
 * wallet you control, or (as an org admin) to prove control of a parent you already own.
 *
 * Org eligibility is NOT derived here — that lookup hits Supabase with the secret key, which is
 * server-only. Components fetch `/api/org` for the matched org instead (see Manager).
 */
export interface LinkedWallet {
  address: Address;
  /** "privy" = the embedded wallet we created; anything else = an external wallet (metamask, …). */
  walletClientType: string;
  embedded: boolean;
}

export interface Session {
  ready: boolean;
  authenticated: boolean;
  email: string | null;
  verifiedEmailDomain: string | null;
  /** Primary (embedded) wallet address — the default recipient. */
  address: Address | null;
  /** All connected wallets (embedded + linked external). */
  wallets: LinkedWallet[];
  login: () => void;
  logout: () => void;
  /** Open Privy's modal to connect/link an external wallet. */
  linkWallet: () => void;
}

export function useSession(): Session {
  const { ready, authenticated, user, login, logout, linkWallet } = usePrivy();
  const { wallets: connected } = useWallets();

  const email = user?.email?.address ?? null;
  const verifiedEmailDomain = email ? (email.split("@")[1]?.toLowerCase() ?? null) : null;
  const address = (user?.wallet?.address as Address | undefined) ?? null;

  const wallets: LinkedWallet[] = connected.map((w) => ({
    address: w.address as Address,
    walletClientType: w.walletClientType,
    embedded: w.walletClientType === "privy",
  }));

  return { ready, authenticated, email, verifiedEmailDomain, address, wallets, login, logout, linkWallet };
}
