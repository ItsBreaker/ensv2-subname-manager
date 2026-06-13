import { NextResponse } from "next/server";
import { labelhash } from "viem/ens";
import { zeroAddress } from "viem";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";
import { getAdminOrg } from "@/lib/orgs";
import { getSupabase } from "@/lib/supabase";
import { getServerSigner } from "@/lib/ens/serverSigner";
import { getParentSubregistry } from "@/lib/ens/subregistry";
import { extractLabel } from "@/lib/ens/registration";
import { permissionedRegistryAbi } from "@/lib/ens/abis";

export const runtime = "nodejs";
// On-chain unregister + confirmation.
export const maxDuration = 60;

const V2_STATUS_REGISTERED = 2;

/**
 * POST /api/admin/remove — revoke a member's subname.
 *
 * The platform holds ROLE_UNREGISTER on the org's subregistry (it deployed it with ALL_ROLES on the
 * root resource, which the EAC ORs into every token's resource), so it can unregister the subname
 * on-chain. Then the roster row is removed. Subnames are therefore revocable by the org admin.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);
    const org = await getAdminOrg(member.email);
    if (!org) throw new HttpError(403, "You don't administer an organization.");

    const body = (await req.json().catch(() => ({}))) as { fqdn?: unknown };
    const fqdn = typeof body.fqdn === "string" ? body.fqdn.trim().toLowerCase() : "";
    if (!fqdn || !fqdn.endsWith(`.${org.parent}`)) {
      throw new HttpError(400, "That name isn't part of your organization.");
    }
    const label = fqdn.slice(0, fqdn.length - org.parent.length - 1); // strip ".democlub.eth"
    if (!label || label.includes(".")) throw new HttpError(400, "Unsupported name.");

    const { account, publicClient, walletClient } = getServerSigner();
    const subregistry = await getParentSubregistry(publicClient, extractLabel(org.parent));

    let revoked = false;
    if (subregistry !== zeroAddress) {
      const anyId = BigInt(labelhash(label));
      const state = await publicClient.readContract({
        address: subregistry,
        abi: permissionedRegistryAbi,
        functionName: "getState",
        args: [anyId],
      });
      // Only unregister if it's actually still registered on-chain.
      if (state.status === V2_STATUS_REGISTERED) {
        const { request } = await publicClient.simulateContract({
          account,
          address: subregistry,
          abi: permissionedRegistryAbi,
          functionName: "unregister",
          args: [anyId],
        });
        await publicClient.waitForTransactionReceipt({ hash: await walletClient.writeContract(request) });
        revoked = true;
      }
    }

    const { error } = await getSupabase().from("subnames").delete().eq("fqdn", fqdn);
    if (error) throw new HttpError(500, `Removed on-chain but failed to update roster: ${error.message}`);

    return NextResponse.json({ ok: true, fqdn, revoked });
  } catch (e) {
    return toErrorResponse(e);
  }
}
