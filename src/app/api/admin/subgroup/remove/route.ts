import { NextResponse } from "next/server";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";
import { getAdminOrg } from "@/lib/orgs";
import { deleteSubgroup, getSubgroup } from "@/lib/subgroups";
import { resetSubgroupReservations } from "@/lib/reservations";

export const runtime = "nodejs";

/**
 * POST /api/admin/subgroup/remove — delete a subgroup from the caller's org.
 *
 * Body: { label }. Removes the subgroup's DB record (so it disappears from the UI and can no longer be
 * claimed under) and moves any pending invites that targeted it back to the org root, so those claims
 * don't break. The on-chain registry is left in place (harmless; recreating the subgroup reattaches to
 * it). Names already claimed under the subgroup are unaffected. Admin-gated.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);
    const org = await getAdminOrg(member.email);
    if (!org) throw new HttpError(403, "You don't administer an organization.");

    const body = (await req.json().catch(() => ({}))) as { label?: unknown };
    const label = (typeof body.label === "string" ? body.label : "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!label) throw new HttpError(400, "Provide the subgroup label to delete.");

    const fqdn = `${label}.${org.parent}`;
    const sg = await getSubgroup(fqdn);
    if (!sg) throw new HttpError(404, `Subgroup "${fqdn}" not found.`);

    await resetSubgroupReservations(org.parent, label);
    await deleteSubgroup(fqdn);

    return NextResponse.json({ ok: true, removed: fqdn });
  } catch (e) {
    return toErrorResponse(e);
  }
}
