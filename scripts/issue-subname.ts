/**
 * Issue an onchain ENSv2 subname under a parent you own (default: alice.democlub.eth).
 *
 * Validates src/lib/ens/issuer.ts + subregistry.ts against live Sepolia. On the first run under a
 * parent it deploys + attaches a UserRegistry subregistry (2 txs), then mints the subname.
 *
 * Prereqs in .env.local:
 *   NEXT_PUBLIC_ALCHEMY_RPC_URL=...
 *   DEPLOYER_PRIVATE_KEY=0x...   (must OWN the parent — same wallet that registered it)
 * (The UserRegistry impl is pinned from ens-cli; override with NEXT_PUBLIC_USER_REGISTRY_IMPL if needed.)
 *
 * Usage:
 *   npm run issue:subname                       # alice.democlub.eth -> sender
 *   npm run issue:subname -- bob democlub.eth   # bob.democlub.eth -> sender
 *   npm run issue:subname -- bob democlub.eth 0xOwner
 */

import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { OnchainIssuer } from "../src/lib/ens/issuer";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}. Set it in .env.local.`);
  return value;
}

async function main() {
  const rpcUrl = requireEnv("NEXT_PUBLIC_ALCHEMY_RPC_URL");
  const privateKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.");
  }

  const label = (process.argv[2] ?? "alice").trim();
  const parent = (process.argv[3] ?? "democlub.eth").trim();
  const ownerArg = process.argv[4]?.trim();

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  const owner = (ownerArg ?? account.address) as `0x${string}`;

  console.log(`\n▶ Issuing ${label}.${parent} on Sepolia`);
  console.log(`  sender (parent owner): ${account.address}`);
  console.log(`  subname owner:         ${owner}`);
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`  ETH balance:           ${formatEther(ethBalance)} ETH`);
  if (ethBalance === 0n) {
    throw new Error("Sender has 0 Sepolia ETH — fund it from a faucet (gas).");
  }

  const issuer = new OnchainIssuer({ publicClient, walletClient });

  // Step 1: ensure the parent has a subregistry (deploy + attach a UserRegistry if missing).
  console.log("… ensuring parent subregistry");
  const sub = await issuer.ensureSubregistry(parent);
  if (sub.created) {
    console.log(`✓ deployed + attached subregistry ${sub.subregistry}`);
    console.log(`  deploy: ${sub.deployHash}`);
    console.log(`  attach: ${sub.setHash}`);
  } else {
    console.log(`✓ parent already has subregistry ${sub.subregistry}`);
  }

  // Step 2: mint the subname.
  console.log("… registering subname");
  const result = await issuer.issue({ parent, label, owner });
  await publicClient.waitForTransactionReceipt({ hash: result.txHash });
  console.log(`✓ registered (${result.txHash})`);

  console.log(`\n🎉 ${result.fqdn} is now owned by ${result.owner}`);
  console.log(`   subregistry: ${result.subregistry}`);
  console.log("   Resolver is unset — set one to hold profile records (text/addr).\n");
}

main().catch((err) => {
  console.error("\n✗ Issuance failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
