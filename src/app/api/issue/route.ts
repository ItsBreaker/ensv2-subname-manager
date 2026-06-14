import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { OnchainIssuer } from "@/lib/ens/issuer";
import { issueUnderSubgroup } from "@/lib/ens/subgroups";
import { ensurePlatformResolver, setNameAddr } from "@/lib/ens/records";
import { getServerSigner } from "@/lib/ens/serverSigner";
import { getActiveOrgByParent, getOpenOrgByParent, getOrgByDomain, normalizeParentName } from "@/lib/orgs";
import { getSubgroup } from "@/lib/subgroups";
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

    const body = (await req.json().catch(() => ({}))) as { label?: unknown; parent?: unknown; subgroup?: unknown; owner?: unknown };
    let label = (typeof body.label === "string" ? body.label : "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    const subgroupLabel = (typeof body.subgroup === "string" ? body.subgroup : "").toLowerCase().replace(/[^a-z0-9-]/g, "");

    // Load any CSV invite for this email up front — it can fix the label, the org, AND the subgroup.
    const reservation = await getReservation(member.email);

    // Resolve the target org. Precedence: verified domain match → typed open org → CSV reservation.
    let org = await getOrgByDomain(member.domain);
    if (!org) {
      const typedParent = normalizeParentName(typeof body.parent === "string" ? body.parent : "");
      if (typedParent) org = await getOpenOrgByParent(typedParent);
    }
    if (!org && reservation) {
      org = await getActiveOrgByParent(reservation.parent);
      label = reservation.label; // a reservation-only claim uses the reserved label
    }
    if (!org) {
      throw new HttpError(403, `Your email "${member.email}" isn't linked to an organization. Enter your organization's name, or ask your admin to invite you.`);
    }
    if (org.issuance !== "onchain") {
      throw new HttpError(400, `Org "${org.parent}" uses ${org.issuance} issuance, which isn't wired here.`);
    }
    if (!label) throw new HttpError(400, "Provide a valid label (letters, numbers, hyphens).");

    // Subgroup: an explicit pick in the request wins; otherwise honor the subgroup the invite assigned
    // (so a CSV import into "student" lands claims as alice.student.org.eth automatically).
    const effectiveSubgroup =
      subgroupLabel || (reservation && reservation.parent === org.parent ? (reservation.subgroup ?? "") : "");
    const subgroup = effectiveSubgroup ? await getSubgroup(`${effectiveSubgroup}.${org.parent}`) : null;
    if (effectiveSubgroup && !subgroup) {
      throw new HttpError(400, `Subgroup "${effectiveSubgroup}.${org.parent}" doesn't exist.`);
    }

    const issueParent = subgroup ? subgroup.fqdn : org.parent; // eng.org.eth or org.eth
    const fqdn = `${label}.${issueParent}`;
    const supabase = getSupabase();

    const { data: existing } = await supabase.from("subnames").select("fqdn").eq("fqdn", fqdn).maybeSingle();
    if (existing) throw new HttpError(409, `${fqdn} is already taken.`);

    // Recipient: the embedded wallet by default, or another wallet the member has linked (proven via
    // Privy signature). We never trust an arbitrary body address — it must be one of THEIR wallets.
    let owner: `0x${string}`;
    if (typeof body.owner === "string" && body.owner.trim()) {
      const requested = body.owner.trim();
      if (!isAddress(requested) || !member.wallets.includes(requested.toLowerCase())) {
        throw new HttpError(400, "That wallet isn't linked to your account — connect it first, then claim.");
      }
      owner = getAddress(requested);
    } else if (member.wallet && isAddress(member.wallet)) {
      owner = getAddress(member.wallet);
    } else {
      throw new HttpError(400, "Your wallet is still being set up. Refresh in a moment, or connect a wallet to receive the name.");
    }
    const { publicClient, walletClient } = getServerSigner();

    // Deploy/reuse the platform resolver, mint with it set, then make the name resolve to the owner.
    const resolver = await ensurePlatformResolver(publicClient, walletClient);
    const clients = { publicClient, walletClient };

    // Mint under the subgroup's registry, or the org root, depending on the request.
    const issued = subgroup
      ? await issueUnderSubgroup(clients, { parent: org.parent, subgroup: subgroup.label, label, owner, resolver })
          .then((r) => ({ fqdn: r.fqdn, label, parent: subgroup.fqdn, owner, subregistry: r.childRegistry, txHash: r.txHash }))
      : await new OnchainIssuer(clients).issue({ parent: org.parent, label, owner, resolver });

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
    if (reservation) await markReservationClaimed(reservation.parent, member.email); // clear the invite

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
