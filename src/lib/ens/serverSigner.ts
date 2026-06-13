import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { HttpError } from "../auth";

/**
 * Server-side signer for platform-mediated transactions (issuance, record writes). Uses
 * ISSUER_PRIVATE_KEY — the manager/owner key holding ROLE_REGISTRAR on the org's subregistry and
 * admin on the platform resolver. Server-only; throws an HttpError if env is missing.
 */
export function getServerSigner() {
  const issuerKey = process.env.ISSUER_PRIVATE_KEY;
  const rpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL;
  if (!issuerKey || !/^0x[0-9a-fA-F]{64}$/.test(issuerKey)) {
    throw new HttpError(500, "Server not configured: set ISSUER_PRIVATE_KEY (manager key).");
  }
  if (!rpcUrl) throw new HttpError(500, "Server not configured: set NEXT_PUBLIC_ALCHEMY_RPC_URL.");

  const account = privateKeyToAccount(issuerKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  return { account, publicClient, walletClient };
}

/** Read-only public client (no signing key needed) for availability checks etc. */
export function getPublicClient() {
  const rpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL;
  if (!rpcUrl) throw new HttpError(500, "Server not configured: set NEXT_PUBLIC_ALCHEMY_RPC_URL.");
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}
