import { getSupabase } from "./supabase";
import { DOMAIN_VERIFIER_ADDRESS } from "./contracts";
import { getPublicClient } from "./ens/serverSigner";

/**
 * Domain verifications: an admin proves control of their email DOMAIN (not just one mailbox) via a
 * DNS-TXT challenge. Keyed by domain so it can happen BEFORE an org exists — verification gates
 * provisioning the org's parent name. Server-only.
 *
 * Two sources count as verified, OR'd together:
 *   - the backend DNS-TXT check (`verified_at` in Supabase) — the fallback path, and
 *   - the on-chain CRE result (`DomainVerifier.isVerified`) — the verifiable, decentralized path
 *     written by the Chainlink DON. See ENSv2_subname_manager/.
 */

// Minimal ABI for the on-chain read. Mirrors DomainVerifier.isVerified(string) -> bool, which keys
// on keccak256(bytes(domain)) — so we pass the same lowercased/trimmed domain the workflow hashed.
const DOMAIN_VERIFIER_ABI = [
  {
    type: "function",
    name: "isVerified",
    stateMutability: "view",
    inputs: [{ name: "domain", type: "string" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface DomainVerification {
  token: string | null;
  verifiedAt: string | null;
}

export async function getDomainVerification(domain: string): Promise<DomainVerification | null> {
  const { data, error } = await getSupabase()
    .from("domain_verifications")
    .select("token, verified_at")
    .eq("domain", domain.trim().toLowerCase())
    .limit(1);
  if (error) throw new Error(`verification lookup failed: ${error.message}`);
  const r = data?.[0];
  return r ? { token: r.token, verifiedAt: r.verified_at } : null;
}

/**
 * Read the CRE result on-chain: DomainVerifier.isVerified(domain) on Sepolia. Best-effort — if the
 * RPC is unconfigured or the call fails, returns false so we fall back to the DNS/DB path rather than
 * hard-failing the gate.
 */
export async function isDomainVerifiedOnchain(domain: string): Promise<boolean> {
  try {
    const verified = await getPublicClient().readContract({
      address: DOMAIN_VERIFIER_ADDRESS,
      abi: DOMAIN_VERIFIER_ABI,
      functionName: "isVerified",
      args: [domain.trim().toLowerCase()],
    });
    return verified === true;
  } catch {
    return false;
  }
}

export async function isDomainVerified(domain: string): Promise<boolean> {
  // DB/DNS path first (cheap), then the on-chain CRE result.
  const v = await getDomainVerification(domain);
  if (v?.verifiedAt) return true;
  return isDomainVerifiedOnchain(domain);
}

export async function setDomainVerifyToken(domain: string, token: string): Promise<void> {
  const { error } = await getSupabase()
    .from("domain_verifications")
    .upsert({ domain: domain.trim().toLowerCase(), token }, { onConflict: "domain" });
  if (error) throw new Error(`failed to set verify token: ${error.message}`);
}

export async function setDomainVerified(domain: string): Promise<void> {
  const { error } = await getSupabase()
    .from("domain_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("domain", domain.trim().toLowerCase());
  if (error) throw new Error(`failed to mark verified: ${error.message}`);
}
