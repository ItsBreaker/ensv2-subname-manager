import { NextResponse } from "next/server";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";
import { getAdminOrg } from "@/lib/orgs";
import { clearUnclaimedReservations, deleteReservation } from "@/lib/reservations";

export const runtime = "nodejs";

/**
 * POST /api/admin/invite/remove — delete pending CSV invites (reservations) for the caller's org.
 *
 * Body: { email } to remove one invite, or { all: true } to clear all unclaimed invites. Invites are
 * just DB rows (no name minted yet), so this is a plain delete with no on-chain action. Admin-gated.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);
    const org = await getAdminOrg(member.email);
    if (!org) throw new HttpError(403, "You don't administer an organization.");

    const body = (await req.json().catch(() => ({}))) as { email?: unknown; all?: unknown };

    if (body.all === true) {
      const count = await clearUnclaimedReservations(org.parent);
      return NextResponse.json({ ok: true, cleared: count });
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) throw new HttpError(400, "Provide an email to remove, or { all: true }.");
    await deleteReservation(org.parent, email);
    return NextResponse.json({ ok: true, removed: email });
  } catch (e) {
    return toErrorResponse(e);
  }
}
