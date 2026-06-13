/**
 * ENS resolver records for issued subnames.
 *
 * Names are minted pointing at a single platform-operated resolver (the issuer's OwnedResolver,
 * deployed via the VerifiableFactory). The platform (resolver admin) writes records on the member's
 * behalf — server-mediated, since members hold no gas or roles. Records are keyed by namehash(name)
 * and use the standard resolver interface, which is identical across ENS v1/v2.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  encodeFunctionData,
  getAddress,
} from "viem";
import { namehash } from "viem/ens";
import { publicResolverAbi } from "./abis";
import { deployResolver } from "./registration";

function requireAccount(walletClient: WalletClient) {
  const account = walletClient.account;
  if (!account) throw new Error("walletClient has no account.");
  return account;
}

/** Get (deploying if needed) the platform resolver — the issuer's OwnedResolver. */
export async function ensurePlatformResolver(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<Address> {
  const { resolver, hash } = await deployResolver(publicClient, walletClient, {});
  if (hash) await publicClient.waitForTransactionReceipt({ hash });
  return resolver;
}

/** Point a name's ETH address record at `address` so it resolves. */
export async function setNameAddr(
  publicClient: PublicClient,
  walletClient: WalletClient,
  args: { resolver: Address; name: string; address: Address },
): Promise<Hex> {
  const account = requireAccount(walletClient);
  const { request } = await publicClient.simulateContract({
    account,
    address: getAddress(args.resolver),
    abi: publicResolverAbi,
    functionName: "setAddr",
    args: [namehash(args.name), getAddress(args.address)],
  });
  return walletClient.writeContract(request);
}

export interface TextRecord {
  key: string;
  value: string;
}

/** Set multiple text records (display name, avatar, url, …) in one multicall. */
export async function setNameTexts(
  publicClient: PublicClient,
  walletClient: WalletClient,
  args: { resolver: Address; name: string; texts: TextRecord[] },
): Promise<Hex> {
  const account = requireAccount(walletClient);
  const node = namehash(args.name);
  const calls = args.texts.map((t) =>
    encodeFunctionData({ abi: publicResolverAbi, functionName: "setText", args: [node, t.key, t.value] }),
  );
  const { request } = await publicClient.simulateContract({
    account,
    address: getAddress(args.resolver),
    abi: publicResolverAbi,
    functionName: "multicall",
    args: [calls],
  });
  return walletClient.writeContract(request);
}
