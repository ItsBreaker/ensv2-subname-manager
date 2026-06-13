import { NextResponse } from "next/server";
import { verifyMember, toErrorResponse } from "@/lib/auth";
import { getOrgByDomain, isPublicEmailDomain } from "@/lib/orgs";

export const runtime = "nodejs";

/**
 * GET /api/org — returns the enrolled org (if any) for the authenticated member's verified domain,
 * so the client can show eligibility without touching the (server-only) database. Public-provider
 * domains are flagged so the UI can route them to the self-serve path instead of org enrollment.
 */
export async function GET(req: Request) {
  try {
    const member = await verifyMember(req);
    const org = await getOrgByDomain(member.domain);
    return NextResponse.json({
      ok: true,
      domain: member.domain,
      address: member.wallet,
      isPublicDomain: isPublicEmailDomain(member.domain),
      org: org ? { parent: org.parent, issuance: org.issuance } : null,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
