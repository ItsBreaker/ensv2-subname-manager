import { NextResponse } from "next/server";
import { verifyMember, toErrorResponse } from "@/lib/auth";
import { getOrgByDomain, isPublicEmailDomain } from "@/lib/orgs";
import { getReservation } from "@/lib/reservations";
import { getSubgroups } from "@/lib/subgroups";
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

    // ALL names this user has claimed (across orgs) — they may have signed into multiple with the
    // same email. Keyed by Privy userId, so it follows the person, not a single org.
    const { data: claimed } = await getSupabase()
      .from("subnames")
      .select("fqdn, parent, created_at")
      .eq("claimed_by", member.userId)
      .order("created_at", { ascending: false });
    const names = (claimed ?? []).map((r) => ({ fqdn: r.fqdn, parent: r.parent }));
    const sub = names[0] ?? null;

    const reservation = await getReservation(member.email);
    // The org's subgroups (named sub-namespaces) the member may claim under, e.g. eng.acme.eth.
    const subgroups = org ? await getSubgroups(org.parent) : [];

    return NextResponse.json({
      ok: true,
      domain: member.domain,
      address: member.wallet,
      isPublicDomain: isPublicEmailDomain(member.domain),
      org: org ? { parent: org.parent, issuance: org.issuance } : null,
      subgroups: subgroups.map((s) => ({ label: s.label, fqdn: s.fqdn })),
      subname: sub?.fqdn ?? null,
      names,
      reservation: reservation ? { parent: reservation.parent, label: reservation.label } : null,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
