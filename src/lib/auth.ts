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
  /** Embedded (or linked) wallet address. */
  wallet: string;
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
  const wallet = user.wallet?.address ?? null;
  if (!email || !wallet) throw new HttpError(403, "Account is missing a verified email or wallet.");

  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return { userId, email, domain, wallet };
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
