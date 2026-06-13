import { NextResponse } from "next/server";
import { ensurePlatformResolver, setNameTexts, type TextRecord } from "@/lib/ens/records";
import { getServerSigner } from "@/lib/ens/serverSigner";
import { getSupabase } from "@/lib/supabase";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";

export const runtime = "nodejs";
// Writing records waits for a tx confirmation — raise the serverless timeout.
export const maxDuration = 60;

/** Text-record keys a member may set on their profile. */
const ALLOWED_KEYS = new Set(["name", "description", "url", "avatar", "com.twitter", "com.github"]);

/**
 * POST /api/records — set profile text records on the authenticated member's subname.
 *
 * Server-mediated: the member has no gas/role, so the platform resolver admin (ISSUER_PRIVATE_KEY)
 * writes the records. The member's name is resolved from the `subnames` table (by Privy user id),
 * so a caller can only edit their own name's records.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);

    const body = (await req.json().catch(() => ({}))) as { texts?: Record<string, unknown> };
    const texts: TextRecord[] = Object.entries(body.texts ?? {})
      .filter(([key, value]) => ALLOWED_KEYS.has(key) && typeof value === "string")
      .map(([key, value]) => ({ key, value: value as string }));
    if (texts.length === 0) throw new HttpError(400, "No valid records to set.");

    // The member can only edit a name they own (looked up by their session, not the request).
    const supabase = getSupabase();
    const { data: sub } = await supabase
      .from("subnames")
      .select("fqdn")
      .eq("claimed_by", member.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) throw new HttpError(404, "You don't have a name yet — claim one first.");

    const { publicClient, walletClient } = getServerSigner();
    const resolver = await ensurePlatformResolver(publicClient, walletClient);
    const hash = await setNameTexts(publicClient, walletClient, { resolver, name: sub.fqdn, texts });
    await publicClient.waitForTransactionReceipt({ hash });

    return NextResponse.json({ ok: true, fqdn: sub.fqdn, txHash: hash, keys: texts.map((t) => t.key) });
  } catch (e) {
    return toErrorResponse(e);
  }
}
