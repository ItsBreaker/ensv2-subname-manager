import { NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { OnchainIssuer } from "@/lib/ens/issuer";
import { findOrgByDomain } from "@/lib/orgs";

// Node runtime: uses the Privy server SDK + viem private-key signing (not edge-compatible).
export const runtime = "nodejs";

/**
 * POST /api/issue — issue an onchain ENSv2 subname to an eligible member.
 *
 * This is the org auto-issuance path (architecture doc §2/§7): a MEMBER can't mint under the org's
 * parent themselves (they hold no ROLE_REGISTRAR), so the platform issues on their behalf — but
 * ONLY after verifying eligibility server-side: the caller's Privy access token → verified email →
 * domain must match an enrolled org. The subname is minted to the member's OWN embedded wallet
 * (read from the verified session, never trusted from the request body). "Email = eligibility."
 *
 * The server signs with ISSUER_PRIVATE_KEY — a manager/owner key that holds ROLE_REGISTRAR on the
 * org's subregistry (for the demo, the democlub.eth owner). Both ISSUER_PRIVATE_KEY and
 * PRIVY_APP_SECRET are SERVER-ONLY (no NEXT_PUBLIC_ prefix).
 */
function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const issuerKey = process.env.ISSUER_PRIVATE_KEY;
  const rpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL;

  if (!appId || !appSecret) return fail(500, "Server not configured: set PRIVY_APP_SECRET.");
  if (!issuerKey || !/^0x[0-9a-fA-F]{64}$/.test(issuerKey)) {
    return fail(500, "Server not configured: set ISSUER_PRIVATE_KEY (manager key with ROLE_REGISTRAR).");
  }
  if (!rpcUrl) return fail(500, "Server not configured: set NEXT_PUBLIC_ALCHEMY_RPC_URL.");

  // 1. Authenticate the caller via their Privy access token.
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : null;
  if (!token) return fail(401, "Missing access token.");

  const privy = new PrivyClient(appId, appSecret);
  let userId: string;
  try {
    const claims = await privy.verifyAuthToken(token);
    userId = claims.userId;
  } catch {
    return fail(401, "Invalid or expired session.");
  }

  // 2. Resolve the verified email + embedded wallet from the session (not the request).
  const user = await privy.getUser(userId);
  const email = user.email?.address ?? null;
  const wallet = user.wallet?.address ?? null;
  if (!email || !wallet) return fail(403, "Account is missing a verified email or wallet.");
  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  // 3. Eligibility: the verified domain must match an enrolled org.
  const org = findOrgByDomain(domain);
  if (!org) return fail(403, `Email domain "${domain}" is not enrolled with any organization.`);
  if (org.issuance !== "onchain") {
    return fail(400, `Org "${org.parent}" uses ${org.issuance} issuance, which isn't wired here.`);
  }

  // 4. Validate the requested label.
  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const rawLabel = typeof body.label === "string" ? body.label : "";
  const label = rawLabel.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!label) return fail(400, "Provide a valid label (letters, numbers, hyphens).");

  // 5. Issue: the server (manager key) mints the subname to the member's own wallet.
  const account = privateKeyToAccount(issuerKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  const issuer = new OnchainIssuer({ publicClient, walletClient });

  try {
    const issued = await issuer.issue({ parent: org.parent, label, owner: getAddress(wallet) });
    return NextResponse.json({
      ok: true,
      fqdn: issued.fqdn,
      owner: issued.owner,
      txHash: issued.txHash,
      subregistry: issued.subregistry,
    });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Issuance failed.");
  }
}
