import { NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";

/**
 * Server-side member authentication for API routes. Verifies the caller's Privy access token and
 * resolves the verified email + embedded wallet from the session (never trusted from the request
 * body). This is the "email = eligibility" gate — the verified domain drives org matching.
 */

/** An error carrying an HTTP status, so routes can translate failures into clean JSON responses. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface Member {
  userId: string;
  email: string;
  /** Lowercased email domain — the eligibility key. */
  domain: string;
  /** Primary (embedded) wallet address — the default recipient. */
  wallet: string;
  /** All of the user's Privy-verified ethereum wallets (embedded + linked external), lowercased.
   *  Each was proven via signature when linked, so the server can safely issue to / act on any. */
  wallets: string[];
}

export async function verifyMember(req: Request): Promise<Member> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new HttpError(500, "Server not configured: set PRIVY_APP_SECRET.");

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new HttpError(401, "Missing access token.");

  const privy = new PrivyClient(appId, appSecret);
  let userId: string;
  try {
    userId = (await privy.verifyAuthToken(token)).userId;
  } catch {
    throw new HttpError(401, "Invalid or expired session.");
  }

  const user = await privy.getUser(userId);
  const email = user.email?.address ?? null;
  // Email is the eligibility key and is required. The wallet is only the recipient/admin signer; a
  // brand-new user's embedded wallet can lag a moment behind server-side getUser, so DON'T fail the
  // whole session on it — routes that actually need a wallet (issuance) validate it themselves.
  if (!email) throw new HttpError(403, "Account is missing a verified email.");
  const wallet = user.wallet?.address ?? "";

  // Every linked ethereum wallet (embedded + external) the user has proven control of via Privy.
  const wallets = (user.linkedAccounts ?? [])
    .filter((a): a is typeof a & { address: string } =>
      a.type === "wallet" && (a as { chainType?: string }).chainType === "ethereum" && typeof (a as { address?: string }).address === "string",
    )
    .map((a) => a.address.toLowerCase());
  const allWallets = Array.from(new Set([wallet, ...wallets].filter(Boolean).map((w) => w.toLowerCase())));

  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return { userId, email, domain, wallet, wallets: allWallets };
}

/** Translate a thrown error (HttpError or otherwise) into a JSON error response. */
export function toErrorResponse(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  }
  return NextResponse.json(
    { ok: false, error: e instanceof Error ? e.message : "Server error" },
    { status: 500 },
  );
}
