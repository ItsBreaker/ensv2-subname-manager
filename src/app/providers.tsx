"use client";

import { useState, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sepolia } from "wagmi/chains";
import { config } from "@/lib/wagmi";

/**
 * App-wide providers. Order matters: Privy outermost, then react-query, then wagmi
 * (Privy's wagmi adapter expects to sit inside both the Privy and QueryClient providers).
 *
 * Phase 0: provider wiring only — email login + embedded wallets are enabled here, but
 * no auth/registration/issuance logic is implemented yet (that's Phase 1+).
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Without a Privy app ID the provider throws on mount. Keep the skeleton bootable
  // by rendering children unwrapped and surfacing a clear setup hint in the console.
  if (!appId) {
    if (typeof window !== "undefined") {
      console.warn(
        "[providers] NEXT_PUBLIC_PRIVY_APP_ID is not set. Privy/wagmi are disabled. " +
          "Copy .env.local.example to .env.local and fill it in.",
      );
    }
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        defaultChain: sepolia,
        supportedChains: [sepolia],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
