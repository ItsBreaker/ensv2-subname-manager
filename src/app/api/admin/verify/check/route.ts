import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";
import { getDomainVerification, setDomainVerified } from "@/lib/verifications";

export const runtime = "nodejs";

const TXT_PREFIX = "ens-subname-verify";

/** Whether the domain publishes a TXT record exactly matching `value`. */
async function hasTxtRecord(domain: string, value: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(domain);
    // resolveTxt returns string[][] (a record can be split into chunks); join then compare.
    return records.some((chunks) => chunks.join("").trim() === value);
  } catch {
    return false; // ENOTFOUND / no TXT / lookup error => not verified yet
  }
}

/**
 * POST /api/admin/verify/check — look up the caller's email-domain TXT record and, if it matches the
 * challenge, mark the domain verified. DNS can take a few minutes to propagate.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);

    const v = await getDomainVerification(member.domain);
    if (!v?.token) throw new HttpError(400, "Start verification first.");
    if (v.verifiedAt) return NextResponse.json({ ok: true, verified: true });

    const verified = await hasTxtRecord(member.domain, `${TXT_PREFIX}=${v.token}`);
    if (verified) await setDomainVerified(member.domain);

    return NextResponse.json({ ok: true, verified });
  } catch (e) {
    return toErrorResponse(e);
  }
}
