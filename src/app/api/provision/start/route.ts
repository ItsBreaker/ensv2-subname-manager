import { NextResponse } from "next/server";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";
import { getOrgByDomain, isPublicEmailDomain } from "@/lib/orgs";
import { isDomainVerified } from "@/lib/verifications";
import { getServerSigner } from "@/lib/ens/serverSigner";
import { getSupabase } from "@/lib/supabase";
import { commit, isAvailable, MIN_COMMITMENT_AGE_SECONDS, normalizeRegistration } from "@/lib/ens/registration";

export const runtime = "nodejs";
// One commit tx + confirmation.
export const maxDuration = 60;

/**
 * POST /api/provision/start — step 1 of auto-provisioning a platform-owned parent for an org.
 *
 * Commits to registering `<label>.eth` (owned by the platform), stores a pending org row with the
 * commit secret, and returns when the commitment will be mature. The client then waits and calls
 * /api/provision/finish. Only the verified domain's own member can provision it; public domains are
 * rejected (they're self-serve).
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);
    if (isPublicEmailDomain(member.domain)) {
      throw new HttpError(400, "Personal email domains use self-serve, not org provisioning.");
    }

    if (!(await isDomainVerified(member.domain))) {
      throw new HttpError(403, "Verify control of your domain before registering your organization's name.");
    }

    const active = await getOrgByDomain(member.domain);
    if (active) throw new HttpError(409, `${member.domain} is already set up as ${active.parent}.`);

    const body = (await req.json().catch(() => ({}))) as { label?: unknown };
    const label = (typeof body.label === "string" ? body.label : "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (label.length < 3) throw new HttpError(400, "Choose a name of at least 3 characters.");
    const parent = `${label}.eth`;

    const { account, publicClient, walletClient } = getServerSigner();
    if (!(await isAvailable(publicClient, label))) {
      throw new HttpError(409, `${parent} is no longer available — pick another.`);
    }

    // Commit (platform is the owner). The secret must be reused at reveal, so persist it.
    const reg = normalizeRegistration({ name: parent, owner: account.address });
    const committed = await commit(publicClient, walletClient, reg);
    await publicClient.waitForTransactionReceipt({ hash: committed.hash });

    const readyAt = new Date(Date.now() + Number(MIN_COMMITMENT_AGE_SECONDS) * 1000 + 10_000).toISOString();
    const { error } = await getSupabase().from("orgs").upsert(
      {
        domain: member.domain,
        parent,
        subregistry: null,
        issuance: "onchain",
        owner_model: "platform",
        parent_owner: account.address,
        admin_email: member.email.toLowerCase(),
        status: "pending",
        commit_secret: committed.secret,
        ready_at: readyAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "domain" },
    );
    if (error) throw new HttpError(500, `Failed to record provisioning: ${error.message}`);

    return NextResponse.json({ ok: true, parent, label, readyAt });
  } catch (e) {
    return toErrorResponse(e);
  }
}
