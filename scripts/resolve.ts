/**
 * Verify a subname resolves: walks the parent's subregistry → the name's resolver → reads its
 * addr + text records directly (doesn't depend on viem's v2 Universal Resolver support).
 *
 * Usage: npm run resolve -- jayden.democlub.eth
 */

import { createPublicClient, http, zeroAddress } from "viem";
import { sepolia } from "viem/chains";
import { namehash } from "viem/ens";
import { permissionedRegistryAbi, publicResolverAbi } from "../src/lib/ens/abis";
import { getParentSubregistry } from "../src/lib/ens/subregistry";
import { extractLabel } from "../src/lib/ens/registration";

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL;
  if (!rpcUrl) throw new Error("Set NEXT_PUBLIC_ALCHEMY_RPC_URL in .env.local");

  const fqdn = (process.argv[2] ?? "").trim().toLowerCase();
  const parts = fqdn.split(".");
  if (parts.length < 3) throw new Error("Usage: npm run resolve -- jayden.democlub.eth");
  const label = parts[0]!;
  const parent = parts.slice(1).join("."); // democlub.eth
  const parentLabel = extractLabel(parent); // democlub

  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  console.log(`\n▶ Resolving ${fqdn}`);
  const subregistry = await getParentSubregistry(publicClient, parentLabel);
  console.log(`  parent subregistry: ${subregistry}`);
  if (subregistry === zeroAddress) throw new Error(`${parent} has no subregistry.`);

  const resolver = await publicClient.readContract({
    address: subregistry,
    abi: permissionedRegistryAbi,
    functionName: "getResolver",
    args: [label],
  });
  console.log(`  resolver:           ${resolver}`);
  if (resolver === zeroAddress) {
    console.log("  ⚠ no resolver set — this name won't resolve.\n");
    return;
  }

  const node = namehash(fqdn);
  const addr = await publicClient.readContract({
    address: resolver,
    abi: publicResolverAbi,
    functionName: "addr",
    args: [node],
  });
  console.log(`  addr  → ${addr}`);

  for (const key of ["name", "description", "url", "avatar", "com.twitter"]) {
    const value = await publicClient.readContract({
      address: resolver,
      abi: publicResolverAbi,
      functionName: "text",
      args: [node, key],
    });
    if (value) console.log(`  text[${key}] → ${value}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("\n✗ Resolve failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
