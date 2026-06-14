import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { zeroAddress } from "viem";
import { getPublicClient } from "@/lib/ens/serverSigner";
import { extractLabel } from "@/lib/ens/registration";
import { getParentState, getParentSubregistry } from "@/lib/ens/subregistry";
import { hasRolesIn } from "@/lib/ens/subgroups";
import { ROLE_REGISTRAR } from "@/lib/ens/roles";
import { isPublicEmailDomain, normalizeParentName } from "@/lib/orgs";
import { getSupabase } from "@/lib/supabase";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/admin/adopt — register an org around a parent the admin ALREADY OWNS (purchased outside
 * the platform). The client first has the owner's wallet attach a UserRegistry subregistry + grant the
 * platform issuer ROLE_REGISTRAR; this route then re-verifies everything server-side before recording
 * the org, so the DB never trusts the client's word:
 *   1. the parent is owned by one of the caller's Privy-verified wallets (wallet = administration),
 *   2. the parent has a subregistry attached, and
 *   3. the platform issuer holds ROLE_REGISTRAR on it (so member issuance will actually work).
 * Authority traces to wallet control of the name, never email — email only sets the membership domain.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);
    if (isPublicEmailDomain(member.domain)) {
      throw new HttpError(400, "Use your organization email — a personal email can't key an org's membership.");
    }

    const body = (await req.json().catch(() => ({}))) as { parent?: unknown };
    const parent = normalizeParentName(typeof body.parent === "string" ? body.parent : "");
    if (!parent) throw new HttpError(400, "Provide your organization's ENS name (e.g. acme.eth).");
    const parentLabel = extractLabel(parent); // validates a 2LD .eth name

    const pub = getPublicClient();

    // 1. The parent must be registered and owned by one of the caller's verified wallets.
    const state = await getParentState(pub, parentLabel);
    const owner = state.latestOwner;
    if (!owner || owner === zeroAddress) {
      throw new HttpError(404, `${parent} isn't registered. Register it first, or auto-provision a name.`);
    }
    if (!member.wallets.includes(owner.toLowerCase())) {
      throw new HttpError(403, `${parent} is owned by ${owner}, which isn't one of your connected wallets. Connect the owning wallet.`);
    }

    // 2. A subregistry must be attached (the client step does this).
    const subregistry = await getParentSubregistry(pub, parentLabel);
    if (!subregistry || subregistry === zeroAddress) {
      throw new HttpError(400, "No subregistry is attached yet — finish the on-chain set-up step first.");
    }

    // 3. The platform issuer must hold ROLE_REGISTRAR on it, or member issuance would revert.
    const issuerKey = process.env.ISSUER_PRIVATE_KEY;
    if (!issuerKey || !/^0x[0-9a-fA-F]{64}$/.test(issuerKey)) {
      throw new HttpError(500, "Server not configured: set ISSUER_PRIVATE_KEY.");
    }
    const issuer = privateKeyToAccount(issuerKey as `0x${string}`).address;
    const delegated = await hasRolesIn(pub, { registry: subregistry, account: issuer, roleBitmap: ROLE_REGISTRAR });
    if (!delegated) {
      throw new HttpError(400, "The platform issuer hasn't been granted issuance rights yet — finish the on-chain set-up step.");
    }

    // All checks pass: record (or update) the org. owner_model = 'user' (admin holds the parent).
    const { error } = await getSupabase()
      .from("orgs")
      .upsert(
        {
          domain: member.domain,
          parent,
          subregistry,
          issuance: "onchain",
          owner_model: "user",
          parent_owner: owner,
          status: "active",
          admin_email: member.email,
        },
        { onConflict: "domain" },
      );
    if (error) throw new Error(`failed to record org: ${error.message}`);

    return NextResponse.json({ ok: true, parent, subregistry, owner });
  } catch (e) {
    return toErrorResponse(e);
  }
}
