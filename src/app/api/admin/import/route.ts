import { NextResponse } from "next/server";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";
import { getAdminOrg } from "@/lib/orgs";
import { createReservations } from "@/lib/reservations";
import { getSubgroup } from "@/lib/subgroups";

export const runtime = "nodejs";

/**
 * POST /api/admin/import — bulk-reserve names for an org from a parsed CSV.
 *
 * Body: { rows: [{ email, label? }], subgroup? }. Label defaults to the email local part. An optional
 * subgroup label assigns every invite to that subgroup, so claims land under `subgroup.org.eth`.
 * Reservations are an eligibility path: when an invited person signs in, they can claim their reserved
 * name. Each row is sanitized; invalid rows are skipped. Only the org's admin may import.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);
    const org = await getAdminOrg(member.email);
    if (!org) throw new HttpError(403, "You don't administer an organization.");

    const body = (await req.json().catch(() => ({}))) as { rows?: unknown; subgroup?: unknown };
    const raw = Array.isArray(body.rows) ? body.rows : [];

    // Optional: assign the whole batch to a subgroup (must already exist).
    const subgroupLabel = (typeof body.subgroup === "string" ? body.subgroup : "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    if (subgroupLabel) {
      const sg = await getSubgroup(`${subgroupLabel}.${org.parent}`);
      if (!sg) throw new HttpError(400, `Subgroup "${subgroupLabel}.${org.parent}" doesn't exist. Create it first.`);
    }

    const seenLabels = new Set<string>();
    const seenEmails = new Set<string>();
    const rows: { email: string; label: string }[] = [];
    for (const item of raw) {
      const r = item as { email?: unknown; label?: unknown };
      const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
      if (!email.includes("@")) continue;
      const rawLabel = typeof r.label === "string" && r.label.trim() ? r.label : email.split("@")[0]!;
      const label = rawLabel.toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (!label) continue;
      if (seenEmails.has(email) || seenLabels.has(label)) continue; // de-dupe within the batch
      seenEmails.add(email);
      seenLabels.add(label);
      rows.push({ email, label });
    }

    if (rows.length === 0) throw new HttpError(400, "No valid rows found (need an email per row).");

    const count = await createReservations(org.parent, rows, subgroupLabel || null);
    return NextResponse.json({ ok: true, count, parent: org.parent, subgroup: subgroupLabel || null });
  } catch (e) {
    return toErrorResponse(e);
  }
}
