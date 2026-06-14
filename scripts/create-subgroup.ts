/**
 * Create a named subgroup (nested sub-namespace) under a parent you own, then issue a member under
 * it — validating src/lib/ens/subgroups.ts against live Sepolia BEFORE wiring it into the app.
 *
 * What it does:
 *   1. createSubgroup: deploy + attach a UserRegistry for `eng.democlub.eth`, optionally delegate a
 *      manager (grant ROLE_REGISTRAR on the subgroup registry only).
 *   2. issueUnderSubgroup: mint `alice.eng.democlub.eth` into that subgroup registry.
 *
 * Prereqs in .env.local:
 *   NEXT_PUBLIC_ALCHEMY_RPC_URL=...
 *   DEPLOYER_PRIVATE_KEY=0x...   (must OWN the parent — same wallet that registered it)
 *
 * Usage:
 *   npm run create:subgroup                                   # eng.democlub.eth + alice.eng.democlub.eth
 *   npm run create:subgroup -- eng democlub.eth               # custom subgroup label + parent
 *   npm run create:subgroup -- eng democlub.eth 0xManager     # also delegate a manager wallet
 *   npm run create:subgroup -- eng democlub.eth 0xManager bob # custom test member label
 */

import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { createSubgroup, getStateIn, issueUnderSubgroup } from "../src/lib/ens/subgroups";
import { zeroAddress } from "viem";

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

  const subgroup = (process.argv[2] ?? "eng").trim();
  const parent = (process.argv[3] ?? "democlub.eth").trim();
  const managerArg = process.argv[4]?.trim();
  const memberLabel = (process.argv[5] ?? "alice").trim();
  const manager = managerArg && /^0x[0-9a-fA-F]{40}$/.test(managerArg) ? (managerArg as `0x${string}`) : undefined;

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  const clients = { publicClient, walletClient };

  console.log(`\n▶ Creating subgroup ${subgroup}.${parent} on Sepolia`);
  console.log(`  sender (parent owner): ${account.address}`);
  if (manager) console.log(`  delegated manager:     ${manager}`);
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`  ETH balance:           ${formatEther(ethBalance)} ETH`);
  if (ethBalance === 0n) throw new Error("Sender has 0 Sepolia ETH — fund it from a faucet (gas).");

  // Step 1: create the subgroup (deploy + attach its registry; optional manager delegation).
  console.log("\n… creating subgroup");
  const sg = await createSubgroup(clients, { parent, label: subgroup, manager });
  if (sg.created) {
    console.log(`✓ subgroup ${sg.fqdn} ready`);
    if (sg.txs.deploy) console.log(`  deploy child registry: ${sg.txs.deploy}`);
    if (sg.txs.register) console.log(`  register + attach:     ${sg.txs.register}`);
    if (sg.txs.setSubregistry) console.log(`  attach subregistry:    ${sg.txs.setSubregistry}`);
  } else {
    console.log(`✓ subgroup ${sg.fqdn} already existed`);
  }
  if (sg.txs.grant) console.log(`  grant manager ROLE_REGISTRAR: ${sg.txs.grant}`);
  console.log(`  parent registry: ${sg.parentRegistry}`);
  console.log(`  child  registry: ${sg.childRegistry}`);

  // Step 2: issue a member under the subgroup to prove nested registration works end-to-end.
  // Skip gracefully if this member was already minted (e.g. on a re-run) — register reverts on dupes.
  const memberFqdn = `${memberLabel}.${sg.fqdn}`;
  const memberState = await getStateIn(publicClient, sg.childRegistry, memberLabel);
  if (memberState.latestOwner !== zeroAddress) {
    console.log(`\n✓ ${memberFqdn} already minted (owner ${memberState.latestOwner}) — skipping issue.`);
  } else {
    console.log(`\n… issuing ${memberFqdn}`);
    const issued = await issueUnderSubgroup(clients, {
      parent,
      subgroup,
      label: memberLabel,
      owner: account.address,
    });
    await publicClient.waitForTransactionReceipt({ hash: issued.txHash });
    console.log(`✓ registered ${issued.fqdn} (${issued.txHash})`);
  }

  console.log(`\n🎉 subgroup ${sg.fqdn} ready; members mint into ${sg.childRegistry}`);
  if (manager) console.log(`   ${manager} can now issue under ${sg.fqdn} (ROLE_REGISTRAR), but not the org root.\n`);
}

main().catch((err) => {
  console.error("\n✗ Subgroup creation failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
