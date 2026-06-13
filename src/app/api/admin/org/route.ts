import { NextResponse } from "next/server";
import { toErrorResponse, verifyMember } from "@/lib/auth";
import { getAdminOrg, getMembers } from "@/lib/orgs";
import { isDomainVerified } from "@/lib/verifications";
import { getReservations } from "@/lib/reservations";

export const runtime = "nodejs";

/**
 * GET /api/admin/org — the org the authenticated user administers (bootstrap: matched by the
 * admin_email recorded at provisioning) plus its members (issued subnames). Returns org=null if the
 * caller doesn't administer one. Admin authority is bootstrap-only here; the DNS/CRE proof layer
 * hardens it later.
 */
export async function GET(req: Request) {
  try {
    const member = await verifyMember(req);
    const org = await getAdminOrg(member.email);
    if (!org) return NextResponse.json({ ok: true, org: null, members: [], invites: [] });
    const [members, invites, verified] = await Promise.all([
      getMembers(org.parent),
      getReservations(org.parent),
      org.domain ? isDomainVerified(org.domain) : Promise.resolve(false),
    ]);
    return NextResponse.json({
      ok: true,
      org: { parent: org.parent, subregistry: org.subregistry },
      members,
      invites: invites.filter((i) => !i.claimed).map((i) => ({ email: i.email, label: i.label })),
      verification: { domain: org.domain, verified },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
