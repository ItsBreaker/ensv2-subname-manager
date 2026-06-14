/**
 * Name availability + suggestions for org auto-provisioning (architecture doc §5B/§5C).
 *
 * When an unenrolled org domain signs in, we derive a candidate label from the domain and check
 * what's registerable on the v2 ETHRegistrar — offering alternatives when the obvious name is taken.
 * Read-only (no signing), so it's fast and safe to run on every check.
 */

import type { PublicClient } from "viem";
import { CONTRACTS } from "../contracts";
import { ethRegistrarAbi } from "./abis";

export interface NameOption {
  label: string;
  fqdn: string;
  available: boolean;
}

/** Derive a base ENS label from an email domain: "org.com" -> "org". */
export function labelFromDomain(domain: string): string {
  const base = domain.trim().toLowerCase().split(".")[0] ?? "";
  return base.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
}

/** Candidate labels: the base plus a few common variations (doc §5C examples). */
export function candidateLabels(base: string): string[] {
  if (!base) return [];
  const candidates = [base, `${base}hq`, `${base}-dao`, `${base}club`, `get${base}`, `${base}app`];
  // Registrar requires 3-63 char labels.
  return [...new Set(candidates)].filter((l) => l.length >= 3 && l.length <= 63);
}

/** Check availability of the base name + alternatives in a single multicall. */
export async function suggestNames(
  publicClient: PublicClient,
  domain: string,
): Promise<{ base: string; options: NameOption[] }> {
  const base = labelFromDomain(domain);
  const labels = candidateLabels(base);
  if (labels.length === 0) return { base, options: [] };

  // One batched RPC (via Multicall3) instead of N round-trips.
  const results = await publicClient.multicall({
    contracts: labels.map((label) => ({
      address: CONTRACTS.ETHRegistrar,
      abi: ethRegistrarAbi,
      functionName: "isAvailable" as const,
      args: [label] as const,
    })),
  });

  const options = labels.map((label, i) => ({
    label,
    fqdn: `${label}.eth`,
    available: results[i]?.status === "success" ? Boolean(results[i]!.result) : false,
  }));
  return { base, options };
}
