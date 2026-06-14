import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";

/**
 * GET /api/platform — the platform's public issuer ADDRESS (derived from ISSUER_PRIVATE_KEY, never
 * the key itself). Public info: an org admin who brings their own parent grants this address
 * ROLE_REGISTRAR on their name's subregistry so the platform can mint member subnames on their behalf.
 */
export async function GET() {
  const key = process.env.ISSUER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    return NextResponse.json({ ok: false, error: "Issuer not configured." }, { status: 500 });
  }
  const account = privateKeyToAccount(key as `0x${string}`);
  return NextResponse.json({ ok: true, issuer: account.address });
}
