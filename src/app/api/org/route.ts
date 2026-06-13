import { NextResponse } from "next/server";
import { verifyMember, toErrorResponse } from "@/lib/auth";
import { getOrgByDomain, isPublicEmailDomain } from "@/lib/orgs";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/org — returns the enrolled org (if any) for the authenticated member's verified domain,
 * plus any name they've already claimed, so the client can show eligibility / the profile editor
 * without touching the (server-only) database. Public-provider domains are flagged so the UI can
 * route them to self-serve instead of org enrollment.
 */
export async function GET(req: Request) {
  try {
    const member = await verifyMember(req);
    const org = await getOrgByDomain(member.domain);

    const { data: sub } = await getSupabase()
      .from("subnames")
      .select("fqdn")
      .eq("claimed_by", member.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      domain: member.domain,
      address: member.wallet,
      isPublicDomain: isPublicEmailDomain(member.domain),
      org: org ? { parent: org.parent, issuance: org.issuance } : null,
      subname: sub?.fqdn ?? null,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
