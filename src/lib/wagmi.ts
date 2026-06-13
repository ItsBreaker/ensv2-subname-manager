import { http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { createConfig } from "@privy-io/wagmi";

/**
 * wagmi config — Sepolia only (see docs/architecture.html: we build & demo on testnet).
 *
 * RPC comes from an Alchemy URL in NEXT_PUBLIC_ALCHEMY_RPC_URL. We use Privy's wagmi
 * adapter (`@privy-io/wagmi`) so Privy embedded wallets flow through wagmi/viem hooks.
 * Falls back to the public Sepolia RPC if the env var is unset (keeps `npm run dev` booting).
 */
export const config = createConfig({
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
