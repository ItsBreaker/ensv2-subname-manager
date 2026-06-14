import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { getServerSigner } from "@/lib/ens/serverSigner";
import { createSubgroup } from "@/lib/ens/subgroups";
import { getAdminOrg } from "@/lib/orgs";
import { getSubgroups, upsertSubgroup } from "@/lib/subgroups";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";

export const runtime = "nodejs";
// Creating a subgroup is multiple on-chain txs (deploy registry + register + optional grant), ~30-60s.
export const maxDuration = 60;

/** GET /api/admin/subgroup — list the subgroups under the caller's org. */
export async function GET(req: Request) {
  try {
    const member = await verifyMember(req);
    const org = await getAdminOrg(member.email);
    if (!org) return NextResponse.json({ ok: true, parent: null, subgroups: [] });
    const subgroups = await getSubgroups(org.parent);
    return NextResponse.json({ ok: true, parent: org.parent, subgroups });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/**
 * POST /api/admin/subgroup — create a named subgroup (eng.acme.eth) under the caller's org, with its
 * own UserRegistry and an optional delegated manager (holds ROLE_REGISTRAR on the subgroup only).
 * The platform key (which owns the org parent) signs. Admin-gated: the caller must administer the org.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);
    const org = await getAdminOrg(member.email);
    if (!org) {
      throw new HttpError(403, "You don't administer an organization. Set one up first.");
    }

    const body = (await req.json().catch(() => ({}))) as { label?: unknown; manager?: unknown };
    const label = (typeof body.label === "string" ? body.label : "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!label) throw new HttpError(400, "Provide a valid subgroup label (letters, numbers, hyphens).");

    let manager: `0x${string}` | undefined;
    if (typeof body.manager === "string" && body.manager.trim()) {
      if (!isAddress(body.manager.trim())) throw new HttpError(400, "Manager must be a valid wallet address.");
      manager = getAddress(body.manager.trim());
    }

    const clients = getServerSigner();
    const result = await createSubgroup(clients, { parent: org.parent, label, manager });

    await upsertSubgroup({
      fqdn: result.fqdn,
      parent: result.parent,
      label: result.subgroupLabel,
      childRegistry: result.childRegistry,
      manager: result.manager ?? null,
      adminEmail: member.email,
    });

    return NextResponse.json({
      ok: true,
      subgroup: {
        fqdn: result.fqdn,
        parent: result.parent,
        label: result.subgroupLabel,
        childRegistry: result.childRegistry,
        manager: result.manager ?? null,
      },
      created: result.created,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
