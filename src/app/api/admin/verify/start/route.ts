import { NextResponse } from "next/server";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";
import { isPublicEmailDomain } from "@/lib/orgs";
import { setDomainVerifyToken } from "@/lib/verifications";

export const runtime = "nodejs";

const TXT_PREFIX = "ens-subname-verify";

/**
 * POST /api/admin/verify/start — begin DNS-TXT verification of the caller's email DOMAIN.
 *
 * Controlling the domain's DNS proves org authority (not just one mailbox) — the doc's §2
 * distinction — and is required before provisioning the org's parent name. Returns the TXT record
 * to add. Personal email providers can't be verified as an org.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);
    if (isPublicEmailDomain(member.domain)) {
      throw new HttpError(400, "Personal email domains can't be verified as an organization.");
    }

    const token = crypto.randomUUID().replace(/-/g, "");
    await setDomainVerifyToken(member.domain, token);

    return NextResponse.json({
      ok: true,
      domain: member.domain,
      recordType: "TXT",
      host: member.domain,
      value: `${TXT_PREFIX}=${token}`,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
