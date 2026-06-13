import { NextResponse } from "next/server";
import { toErrorResponse, verifyMember } from "@/lib/auth";
import { getOrgByDomain, getProvisioning, isPublicEmailDomain } from "@/lib/orgs";
import { isDomainVerified } from "@/lib/verifications";
import { getPublicClient } from "@/lib/ens/serverSigner";
import { suggestNames } from "@/lib/ens/availability";

export const runtime = "nodejs";

/**
 * GET /api/provision — for the authenticated member's verified domain, report its state: already
 * enrolled, a public provider (self-serve), mid-provisioning (so the UI can resume the wait), or an
 * unprovisioned org domain (with registerable name suggestions).
 *
 * Read-only. Registering a parent is the separate start/finish flow.
 */
export async function GET(req: Request) {
  try {
    const member = await verifyMember(req);

    if (isPublicEmailDomain(member.domain)) {
      return NextResponse.json({ ok: true, kind: "public", domain: member.domain });
    }

    const org = await getOrgByDomain(member.domain);
    if (org) {
      return NextResponse.json({ ok: true, kind: "enrolled", domain: member.domain, parent: org.parent });
    }

    // Mid-provisioning? Let the client resume waiting for the commitment to mature.
    const pending = await getProvisioning(member.domain);
    if (pending && pending.status === "pending") {
      return NextResponse.json({
        ok: true,
        kind: "pending",
        domain: member.domain,
        parent: pending.parent,
        readyAt: pending.readyAt,
      });
    }

    // Provisioning requires domain verification. Skip the on-chain availability lookups until then.
    if (!(await isDomainVerified(member.domain))) {
      return NextResponse.json({ ok: true, kind: "unverified", domain: member.domain });
    }

    const { base, options } = await suggestNames(getPublicClient(), member.domain);
    return NextResponse.json({ ok: true, kind: "unprovisioned", domain: member.domain, base, options });
  } catch (e) {
    return toErrorResponse(e);
  }
}
