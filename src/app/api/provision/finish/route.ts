import { NextResponse } from "next/server";
import { erc20Abi, getAddress } from "viem";
import { labelhash } from "viem/ens";
import { HttpError, toErrorResponse, verifyMember } from "@/lib/auth";
import { getProvisioning } from "@/lib/orgs";
import { getServerSigner } from "@/lib/ens/serverSigner";
import { getSupabase } from "@/lib/supabase";
import { mintableErc20Abi, permissionedRegistryAbi } from "@/lib/ens/abis";
import { CONTRACTS } from "@/lib/contracts";
import {
  approvePaymentToken,
  extractLabel,
  getRegisterPrice,
  normalizeRegistration,
  register,
} from "@/lib/ens/registration";

export const runtime = "nodejs";
// Mint (maybe) + approve + register, each with a confirmation.
export const maxDuration = 60;

/**
 * POST /api/provision/finish — step 2 of auto-provisioning: reveal/register the committed name.
 *
 * Reuses the stored commit secret, ensures the platform holds enough test paymentToken (open mint),
 * approves, and registers `<parent>` to the platform. Idempotent against retries: if the name is
 * already registered to the platform (e.g. a prior call timed out after the tx mined), it just marks
 * the org active. Subregistry deploys lazily on the first member claim.
 */
export async function POST(req: Request) {
  try {
    const member = await verifyMember(req);

    const row = await getProvisioning(member.domain);
    if (!row || row.status !== "pending") {
      throw new HttpError(400, "No pending provisioning for this domain — start it first.");
    }
    if (!row.commitSecret) throw new HttpError(400, "Missing commit secret — restart provisioning.");
    if (row.readyAt && Date.now() < new Date(row.readyAt).getTime()) {
      throw new HttpError(425, "The commitment isn't mature yet — wait a few more seconds.");
    }

    const parent = row.parent;
    const label = extractLabel(parent);
    const { account, publicClient, walletClient } = getServerSigner();

    // If a prior attempt already registered it to us, just activate (idempotent retry).
    const state = await publicClient.readContract({
      address: CONTRACTS.PermissionedRegistry,
      abi: permissionedRegistryAbi,
      functionName: "getState",
      args: [BigInt(labelhash(label))],
    });
    const alreadyOurs = state.status === 2 && getAddress(state.latestOwner) === getAddress(account.address);

    if (!alreadyOurs) {
      const reg = normalizeRegistration({
        name: parent,
        owner: account.address,
        secret: row.commitSecret as `0x${string}`,
      });
      const price = await getRegisterPrice(publicClient, { label: reg.label, duration: reg.duration });

      // Fund the platform key with the test token if short (open mint).
      const balance = await publicClient.readContract({
        address: reg.paymentToken,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      if (balance < price.total) {
        const { request } = await publicClient.simulateContract({
          account,
          address: reg.paymentToken,
          abi: mintableErc20Abi,
          functionName: "mint",
          args: [account.address, price.total],
        });
        await publicClient.waitForTransactionReceipt({ hash: await walletClient.writeContract(request) });
      }

      const approveHash = await approvePaymentToken(publicClient, walletClient, {
        amount: price.total,
        paymentToken: reg.paymentToken,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      const registerHash = await register(publicClient, walletClient, reg);
      await publicClient.waitForTransactionReceipt({ hash: registerHash });
    }

    const { error } = await getSupabase()
      .from("orgs")
      .update({ status: "active", commit_secret: null, ready_at: null, updated_at: new Date().toISOString() })
      .eq("domain", member.domain);
    if (error) throw new HttpError(500, `Registered, but failed to activate the org: ${error.message}`);

    return NextResponse.json({ ok: true, parent });
  } catch (e) {
    return toErrorResponse(e);
  }
}
