import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { OnchainIssuer } from "@/lib/ens/issuer";
import { ensurePlatformResolver, setNameAddr } from "@/lib/ens/records";
import { getServerSigner } from "@/lib/ens/serverSigner";
import { getOrgByDomain } from "@/lib/orgs";
import { getSupabase } from "@/lib/supabase";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";

// Node runtime: uses the Privy server SDK + viem private-key signing (not edge-compatible).
export const runtime = "nodejs";

/**
 * POST /api/issue — issue an onchain ENSv2 subname to an eligible member, set so it resolves.
 *
 * Eligibility is verified server-side (Privy token → verified email → enrolled-org domain match).
 * The platform (ISSUER_PRIVATE_KEY, holds ROLE_REGISTRAR) mints the subname to the member's wallet
 * pointing at the platform resolver, then sets the addr record so the name resolves to the member.
 * Each issuance is recorded in `subnames`; duplicate labels are rejected up front.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);

    const org = await getOrgByDomain(member.domain);
    if (!org) throw new HttpError(403, `Email domain "${member.domain}" is not enrolled with any organization.`);
    if (org.issuance !== "onchain") {
      throw new HttpError(400, `Org "${org.parent}" uses ${org.issuance} issuance, which isn't wired here.`);
    }

    const body = (await req.json().catch(() => ({}))) as { label?: unknown };
    const rawLabel = typeof body.label === "string" ? body.label : "";
    const label = rawLabel.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!label) throw new HttpError(400, "Provide a valid label (letters, numbers, hyphens).");

    const fqdn = `${label}.${org.parent}`;
    const supabase = getSupabase();

    const { data: existing } = await supabase.from("subnames").select("fqdn").eq("fqdn", fqdn).maybeSingle();
    if (existing) throw new HttpError(409, `${fqdn} is already taken.`);

    const owner = getAddress(member.wallet);
    const { publicClient, walletClient } = getServerSigner();

    // Deploy/reuse the platform resolver, mint with it set, then make the name resolve to the owner.
    const resolver = await ensurePlatformResolver(publicClient, walletClient);
    const issuer = new OnchainIssuer({ publicClient, walletClient });
    const issued = await issuer.issue({ parent: org.parent, label, owner, resolver });
    await publicClient.waitForTransactionReceipt({ hash: issued.txHash });
    const addrHash = await setNameAddr(publicClient, walletClient, { resolver, name: issued.fqdn, address: owner });
    await publicClient.waitForTransactionReceipt({ hash: addrHash });

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
      resolver,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
