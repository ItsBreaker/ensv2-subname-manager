import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { OnchainIssuer } from "@/lib/ens/issuer";
import { getOrgByDomain } from "@/lib/orgs";
import { getSupabase } from "@/lib/supabase";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";

// Node runtime: uses the Privy server SDK + viem private-key signing (not edge-compatible).
export const runtime = "nodejs";

/**
 * POST /api/issue — issue an onchain ENSv2 subname to an eligible member.
 *
 * The org auto-issuance path (architecture doc §2/§7): a member can't mint under the org's parent
 * themselves (no ROLE_REGISTRAR), so the platform issues on their behalf after verifying
 * eligibility server-side (Privy token → verified email → enrolled-org domain match). The subname
 * is minted to the member's OWN wallet (from the verified session). The server signs with
 * ISSUER_PRIVATE_KEY — a manager/owner key holding ROLE_REGISTRAR on the org's subregistry.
 * Each issuance is recorded in the `subnames` table; duplicate labels are rejected up front.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);

    // Eligibility: verified domain must match an enrolled, onchain org.
    const org = await getOrgByDomain(member.domain);
    if (!org) throw new HttpError(403, `Email domain "${member.domain}" is not enrolled with any organization.`);
    if (org.issuance !== "onchain") {
      throw new HttpError(400, `Org "${org.parent}" uses ${org.issuance} issuance, which isn't wired here.`);
    }

    // Validate the requested label.
    const body = (await req.json().catch(() => ({}))) as { label?: unknown };
    const rawLabel = typeof body.label === "string" ? body.label : "";
    const label = rawLabel.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!label) throw new HttpError(400, "Provide a valid label (letters, numbers, hyphens).");

    const fqdn = `${label}.${org.parent}`;
    const supabase = getSupabase();

    // Fast duplicate check (the on-chain register is still the source of truth and will revert too).
    const { data: existing } = await supabase
      .from("subnames")
      .select("fqdn")
      .eq("fqdn", fqdn)
      .maybeSingle();
    if (existing) throw new HttpError(409, `${fqdn} is already taken.`);

    // Signing config.
    const issuerKey = process.env.ISSUER_PRIVATE_KEY;
    const rpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL;
    if (!issuerKey || !/^0x[0-9a-fA-F]{64}$/.test(issuerKey)) {
      throw new HttpError(500, "Server not configured: set ISSUER_PRIVATE_KEY (manager key with ROLE_REGISTRAR).");
    }
    if (!rpcUrl) throw new HttpError(500, "Server not configured: set NEXT_PUBLIC_ALCHEMY_RPC_URL.");

    // Issue: the server (manager key) mints the subname to the member's own wallet.
    const account = privateKeyToAccount(issuerKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
    const issuer = new OnchainIssuer({ publicClient, walletClient });
    const issued = await issuer.issue({ parent: org.parent, label, owner: getAddress(member.wallet) });

    // Record it (best-effort; the name is already on-chain regardless).
    await supabase.from("subnames").insert({
      fqdn: issued.fqdn,
      label: issued.label,
      parent: issued.parent,
      owner: issued.owner,
      subregistry: issued.subregistry,
      tx_hash: issued.txHash,
      claimed_by: member.userId,
      domain: member.domain,
    });

    return NextResponse.json({
      ok: true,
      fqdn: issued.fqdn,
      owner: issued.owner,
      txHash: issued.txHash,
      subregistry: issued.subregistry,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
