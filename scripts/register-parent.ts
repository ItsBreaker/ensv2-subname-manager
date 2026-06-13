/**
 * One-off: register the demo org parent (default: democlub.eth) on the ENSv2
 * ETHRegistrar on Sepolia. Run this ONCE, up front — not live on stage (the doc's
 * Phase 0 guidance). It exercises the full commit/reveal + ERC-20 approval path and
 * validates src/lib/ens/registration.ts against the live chain.
 *
 * Usage (from the project root):
 *   1. Put a FUNDED Sepolia test key + RPC in .env.local:
 *        NEXT_PUBLIC_ALCHEMY_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...
 *        DEPLOYER_PRIVATE_KEY=0x...   (a throwaway test key — NEVER a real one)
 *   2. Fund that address with Sepolia ETH (faucet) for gas.
 *   3. npm run register:parent              # registers democlub.eth
 *      npm run register:parent -- myorg     # or a custom label
 *
 * The Sepolia paymentToken is a dummy USDC with open mint(), so this script mints
 * the registration fee to your address automatically if your balance is short.
 */

import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { CONTRACTS } from "../src/lib/contracts";
import {
  approvePaymentToken,
  commit,
  getRegisterPrice,
  isAvailable,
  MIN_COMMITMENT_AGE_SECONDS,
  normalizeRegistration,
  register,
} from "../src/lib/ens/registration";

// The Sepolia test paymentToken has open minting (see ens-cli price.ts testTokenHint).
const mintableErc20Abi = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  const label = (process.argv[2] ?? "democlub").trim();
  const name = `${label}.eth`;

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  console.log(`\n▶ Registering ${name} on Sepolia`);
  console.log(`  owner / sender: ${account.address}`);

  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`  ETH balance:    ${formatEther(ethBalance)} ETH`);
  if (ethBalance === 0n) {
    throw new Error("Sender has 0 Sepolia ETH — fund it from a faucet before registering (gas).");
  }
  // Registration is up to 4 txs (mint? + commit + approve + register), and the
  // register reveal alone can estimate ~0.007 ETH on Sepolia. Warn before the 65s wait.
  const RECOMMENDED_MIN_ETH = parseEther("0.02");
  if (ethBalance < RECOMMENDED_MIN_ETH) {
    console.warn(
      `  ⚠ Low ETH for gas. The reveal can estimate high on Sepolia — recommend ` +
        `≥ ${formatEther(RECOMMENDED_MIN_ETH)} ETH. Top up if register fails at the end.`,
    );
  }

  // 1. Availability ----------------------------------------------------------
  const available = await isAvailable(publicClient, label);
  if (!available) {
    throw new Error(
      `"${name}" is not available. Pick another label, e.g. ${label}hq.eth / ${label}-dao.eth.`,
    );
  }
  console.log(`✓ ${name} is available`);

  // Build one normalized registration so commit and reveal share the same secret/args.
  const reg = normalizeRegistration({ name, owner: account.address });
  console.log(`  secret (save if interrupted): ${reg.secret}`);

  // 2. Price -----------------------------------------------------------------
  const price = await getRegisterPrice(publicClient, { label: reg.label, duration: reg.duration });
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: reg.paymentToken, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address: reg.paymentToken, abi: erc20Abi, functionName: "decimals" }),
  ]);
  console.log(
    `✓ Price: ${formatUnits(price.total, decimals)} ${symbol} ` +
      `(base ${formatUnits(price.base, decimals)} + premium ${formatUnits(price.premium, decimals)})`,
  );

  // 3. Ensure ERC-20 balance (mint test token if short) ----------------------
  const tokenBalance = await publicClient.readContract({
    address: reg.paymentToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (tokenBalance < price.total) {
    console.log(`… minting ${formatUnits(price.total, decimals)} ${symbol} (test token, open mint)`);
    const { request } = await publicClient.simulateContract({
      account,
      address: reg.paymentToken,
      abi: mintableErc20Abi,
      functionName: "mint",
      args: [account.address, price.total],
    });
    const mintHash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
    console.log(`  minted (${mintHash})`);
  }

  // 4. COMMIT ----------------------------------------------------------------
  console.log("… commit");
  const committed = await commit(publicClient, walletClient, reg);
  await publicClient.waitForTransactionReceipt({ hash: committed.hash });
  console.log(`✓ committed (${committed.hash})`);

  // 5. Wait for the commitment to mature (registrar enforces a minimum age) ---
  const waitSeconds = Number(MIN_COMMITMENT_AGE_SECONDS) + 5;
  console.log(`… waiting ${waitSeconds}s for the commitment to mature`);
  await sleep(waitSeconds * 1000);

  // 6. APPROVE the registrar to spend the ERC-20 total -----------------------
  console.log("… approve");
  const approveHash = await approvePaymentToken(publicClient, walletClient, {
    amount: price.total,
    paymentToken: reg.paymentToken,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log(`✓ approved (${approveHash})`);

  // 7. REVEAL / register -----------------------------------------------------
  console.log("… register (reveal)");
  const registerHash = await register(publicClient, walletClient, reg);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
  console.log(`✓ registered (${registerHash}) — block ${receipt.blockNumber}`);

  console.log(`\n🎉 ${name} is now owned by ${account.address}`);
  console.log(
    "   Resolver is unset (zeroAddress). For the offchain golden path, point the\n" +
      "   resolver at NameStone's gateway; for onchain records, deploy a per-account\n" +
      "   resolver via deployResolver() and setResolver to it.\n",
  );
}

main().catch((err) => {
  console.error("\n✗ Registration failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
