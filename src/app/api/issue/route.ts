import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { OnchainIssuer } from "@/lib/ens/issuer";
import { ensurePlatformResolver, setNameAddr } from "@/lib/ens/records";
import { getServerSigner } from "@/lib/ens/serverSigner";
import { getActiveOrgByParent, getOpenOrgByParent, getOrgByDomain, normalizeParentName } from "@/lib/orgs";
import { getReservation, markReservationClaimed } from "@/lib/reservations";
import { getSupabase } from "@/lib/supabase";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";

// Node runtime: uses the Privy server SDK + viem private-key signing (not edge-compatible).
export const runtime = "nodejs";
// Claims do multiple on-chain txs + confirmations (~20-40s) — raise the serverless timeout.
export const maxDuration = 60;

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

    const body = (await req.json().catch(() => ({}))) as { label?: unknown; parent?: unknown };
    let label = (typeof body.label === "string" ? body.label : "").toLowerCase().replace(/[^a-z0-9-]/g, "");

    // Resolve the target org. Precedence: verified domain match → typed open org → CSV reservation.
    let org = await getOrgByDomain(member.domain);
    if (!org) {
      const typedParent = normalizeParentName(typeof body.parent === "string" ? body.parent : "");
      if (typedParent) org = await getOpenOrgByParent(typedParent);
    }
    if (!org) {
      const reservation = await getReservation(member.email);
      if (reservation) {
        org = await getActiveOrgByParent(reservation.parent);
        label = reservation.label; // an invite fixes the reserved label
      }
    }
    if (!org) {
      throw new HttpError(403, `Your email "${member.email}" isn't linked to an organization. Enter your organization's name, or ask your admin to invite you.`);
    }
    if (org.issuance !== "onchain") {
      throw new HttpError(400, `Org "${org.parent}" uses ${org.issuance} issuance, which isn't wired here.`);
    }
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
    await markReservationClaimed(org.parent, member.email); // no-op unless this was an invite

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
