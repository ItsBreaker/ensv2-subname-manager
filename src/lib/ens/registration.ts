/**
 * ENSv2 parent-name registration (commit/reveal with ERC-20 payment).
 *
 * Adapted from the booth reference gskril/ens-cli (`commands/register.ts`,
 * `commands/price.ts`, `commands/resolver.ts`). The CLI emits raw calldata; here we
 * mirror the same proven contract calls but execute them with viem clients
 * (simulate → write) so they drop into our Privy/wagmi frontend.
 *
 * The full flow (see architecture doc §5):
 *   0. (optional) deployResolver()      — per-account resolver so the name holds records
 *   1. getRegisterPrice()               — exact ERC-20 total (base + premium), no buffer
 *   2. commit()                         — makeCommitment (onchain pure) then commit()
 *   3. wait >= MIN_COMMITMENT_AGE_SECONDS after the commit tx is mined
 *   4. approvePaymentToken(total)       — ERC-20 approve the registrar BEFORE reveal
 *   5. register()                       — the reveal; mints the name, returns tokenId
 *
 * CRITICAL: the same `secret` (and the same label/owner/subregistry/resolver/duration/
 * referrer) must be used for both commit and register. Build one NormalizedRegistration
 * via normalizeRegistration() and pass it to both steps.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  getContractAddress,
  isHex,
  keccak256,
  stringToBytes,
  toHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { normalize } from "viem/ens";
import { CONTRACTS } from "../contracts";
import { ethRegistrarAbi, permissionedResolverAbi, verifiableFactoryAbi } from "./abis";

export const ONE_YEAR = 31536000n;

/** The registrar enforces a minimum delay between commit and reveal (≥ 60s on-chain). */
export const MIN_COMMITMENT_AGE_SECONDS = 60n;

/**
 * Validate a fully-qualified 2LD `.eth` name and return its label.
 * Mirrors ens-cli `extractLabel`: normalizes, requires `name.eth`, min 3 chars.
 */
export function extractLabel(name: string): string {
  if (!name.trim()) throw new Error("Name cannot be empty.");
  let normalized: string;
  try {
    normalized = normalize(name);
  } catch {
    throw new Error(`Invalid ENS name: "${name}". Could not normalize name.`);
  }
  const parts = normalized.split(".");
  const label = parts.length === 2 && parts[1] === "eth" ? parts[0]! : null;
  if (label == null) {
    throw new Error(`Registration only supports 2LDs (e.g. name.eth). Got: ${normalized}`);
  }
  if (label.length < 3) {
    throw new Error(
      `Name "${label}.eth" is too short. The registrar requires labels of at least 3 characters.`,
    );
  }
  return label;
}

/** 32 cryptographically-random bytes. Save this between commit and reveal. */
export function generateSecret(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export interface RegistrationRequest {
  /** Fully-qualified 2LD name, e.g. "democlub.eth". */
  name: string;
  /** Address that will own the registered name. */
  owner: Address;
  /** Registration length in seconds (default: 1 year). */
  durationSeconds?: bigint;
  /** Per-account resolver (default: zeroAddress — deploy one first to hold profile records). */
  resolver?: Address;
  /** Initial subregistry (default: zeroAddress; set if the name will itself issue subnames). */
  subregistry?: Address;
  /** ERC-20 payment token (default: CONTRACTS.paymentToken — Sepolia test USDC). */
  paymentToken?: Address;
  /** Referrer (default: zeroHash). */
  referrer?: Hex;
  /** Commitment secret. Omit to generate; reuse the SAME value for commit and reveal. */
  secret?: Hex;
}

export interface NormalizedRegistration {
  label: string;
  owner: Address;
  duration: bigint;
  resolver: Address;
  subregistry: Address;
  paymentToken: Address;
  referrer: Hex;
  secret: Hex;
}

/** Fill defaults + validate once, so commit and reveal are guaranteed to use matching args. */
export function normalizeRegistration(req: RegistrationRequest): NormalizedRegistration {
  return {
    label: extractLabel(req.name),
    owner: getAddress(req.owner),
    duration: req.durationSeconds ?? ONE_YEAR,
    resolver: req.resolver ? getAddress(req.resolver) : zeroAddress,
    subregistry: req.subregistry ? getAddress(req.subregistry) : zeroAddress,
    paymentToken: req.paymentToken ? getAddress(req.paymentToken) : CONTRACTS.paymentToken,
    referrer: req.referrer ?? zeroHash,
    secret: req.secret ?? generateSecret(),
  };
}

export interface RegisterPrice {
  base: bigint;
  premium: bigint;
  /** base + premium — the exact ERC-20 amount to approve before reveal. */
  total: bigint;
}

/** Read the exact registration price (ERC-20). Fetch right before reveal and approve `total`. */
export async function getRegisterPrice(
  publicClient: PublicClient,
  args: { label: string; duration?: bigint; paymentToken?: Address },
): Promise<RegisterPrice> {
  const [base, premium] = await publicClient.readContract({
    address: CONTRACTS.ETHRegistrar,
    abi: ethRegistrarAbi,
    functionName: "getRegisterPrice",
    args: [args.label, args.duration ?? ONE_YEAR, args.paymentToken ?? CONTRACTS.paymentToken],
  });
  return { base, premium, total: base + premium };
}

/** Whether the 2LD label is registerable on the v2 registrar. */
export function isAvailable(publicClient: PublicClient, label: string): Promise<boolean> {
  return publicClient.readContract({
    address: CONTRACTS.ETHRegistrar,
    abi: ethRegistrarAbi,
    functionName: "isAvailable",
    args: [label],
  });
}

/** Compute the commitment hash on-chain (the registrar's own `pure` hashing — don't reimplement). */
export function makeCommitment(
  publicClient: PublicClient,
  n: NormalizedRegistration,
): Promise<Hex> {
  return publicClient.readContract({
    address: CONTRACTS.ETHRegistrar,
    abi: ethRegistrarAbi,
    functionName: "makeCommitment",
    args: [n.label, n.owner, n.secret, n.subregistry, n.resolver, n.duration, n.referrer],
  });
}

function requireAccount(walletClient: WalletClient) {
  const account = walletClient.account;
  if (!account) throw new Error("walletClient has no account — connect a wallet first.");
  return account;
}

export interface CommitResult {
  hash: Hex;
  commitment: Hex;
  /** Echoed back so the caller can persist it for the reveal step. */
  secret: Hex;
}

/** Step 2 — broadcast the commitment. value: 0. Wait ≥ MIN_COMMITMENT_AGE_SECONDS afterwards. */
export async function commit(
  publicClient: PublicClient,
  walletClient: WalletClient,
  n: NormalizedRegistration,
): Promise<CommitResult> {
  const account = requireAccount(walletClient);
  const commitment = await makeCommitment(publicClient, n);
  const { request } = await publicClient.simulateContract({
    account,
    address: CONTRACTS.ETHRegistrar,
    abi: ethRegistrarAbi,
    functionName: "commit",
    args: [commitment],
  });
  const hash = await walletClient.writeContract(request);
  return { hash, commitment, secret: n.secret };
}

/** Step 4 — approve the registrar to spend the ERC-20 registration total. Run before reveal. */
export async function approvePaymentToken(
  publicClient: PublicClient,
  walletClient: WalletClient,
  args: { amount: bigint; paymentToken?: Address },
): Promise<Hex> {
  const account = requireAccount(walletClient);
  const { request } = await publicClient.simulateContract({
    account,
    address: args.paymentToken ?? CONTRACTS.paymentToken,
    abi: erc20Abi,
    functionName: "approve",
    args: [CONTRACTS.ETHRegistrar, args.amount],
  });
  return walletClient.writeContract(request);
}

/** Step 5 — the reveal. Mints the name; requires the matching commit args + a prior approve. value: 0. */
export async function register(
  publicClient: PublicClient,
  walletClient: WalletClient,
  n: NormalizedRegistration,
): Promise<Hex> {
  const account = requireAccount(walletClient);
  const { request } = await publicClient.simulateContract({
    account,
    address: CONTRACTS.ETHRegistrar,
    abi: ethRegistrarAbi,
    functionName: "register",
    args: [
      n.label,
      n.owner,
      n.secret,
      n.subregistry,
      n.resolver,
      n.duration,
      n.paymentToken,
      n.referrer,
    ],
  });
  return walletClient.writeContract(request);
}

// --- Per-account resolver (VerifiableFactory) -------------------------------
// Mirrors ens-cli `resolver deploy`: the resolver address is deterministic in
// (factory, proxyLogic, deployer, salt), so we can predict it and skip redeploys.

// EnhancedAccessControl packs each role into a 4-bit group; all-1 nibbles = ALL_ROLES.
const DEFAULT_ROLE_BITMAP = BigInt(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const OWNED_RESOLVER_ID = keccak256(stringToBytes("OwnedResolver"));
const OWNED_RESOLVER_VERSION = 0n;

/** Canonical CREATE2 salt for an account's owned resolver (matches the contracts-v2 setup script). */
export function ownedResolverSalt(admin: Address): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [OWNED_RESOLVER_ID, getAddress(admin), OWNED_RESOLVER_VERSION],
      ),
    ),
  );
}

/**
 * Predict the address of any VerifiableFactory proxy from (deployer, salt). The proxy address
 * depends only on the factory, the shared proxy logic, the deployer, and the salt — NOT on the
 * implementation — so this is reused for both per-account resolvers and per-name subregistries
 * (CONTRACTS.resolverFactory/resolverProxyLogic are the generic VerifiableFactory + its proxy logic).
 */
export function predictProxyAddress(args: { deployer: Address; salt: bigint }): Address {
  const deployer = getAddress(args.deployer);
  const outerSalt = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [deployer, args.salt]),
  );
  // EIP-1167 minimal proxy, with the runtime length byte bumped to 0x4d so the
  // VerifiableFactory can append the 32-byte outer salt for on-chain verification.
  const bytecode = concat([
    "0x3d604d80600a3d3981f3363d3d373d3d3d363d73",
    CONTRACTS.resolverProxyLogic,
    "0x5af43d82803e903d91602b57fd5bf3",
    outerSalt,
  ]);
  return getContractAddress({
    bytecode,
    from: CONTRACTS.resolverFactory,
    opcode: "CREATE2",
    salt: outerSalt,
  });
}

/** Predict the resolver proxy address for a deployer/salt without sending a transaction. */
export function predictResolverAddress(args: {
  deployer: Address;
  admin?: Address;
  salt?: bigint;
}): Address {
  const deployer = getAddress(args.deployer);
  const admin = args.admin ? getAddress(args.admin) : deployer;
  const salt = args.salt ?? ownedResolverSalt(admin);
  return predictProxyAddress({ deployer, salt });
}

/** True if a resolver proxy is already deployed at the predicted address. */
export async function isResolverDeployed(
  publicClient: PublicClient,
  resolver: Address,
): Promise<boolean> {
  const code = await publicClient.getCode({ address: resolver });
  return isHex(code) && code !== "0x";
}

export interface DeployResolverResult {
  /** Predicted (and, after the tx confirms, live) resolver address. */
  resolver: Address;
  /** Deployment tx hash, or undefined if it was already deployed (no tx sent). */
  hash?: Hex;
  alreadyDeployed: boolean;
}

/**
 * Step 0 — deploy a per-account permissioned resolver via the VerifiableFactory.
 * No-ops (returns alreadyDeployed) if one already exists at the predicted address.
 * The resulting address is what you pass as `resolver` into normalizeRegistration().
 */
export async function deployResolver(
  publicClient: PublicClient,
  walletClient: WalletClient,
  args: { admin?: Address; salt?: bigint; roleBitmap?: bigint } = {},
): Promise<DeployResolverResult> {
  const account = requireAccount(walletClient);
  const deployer = account.address;
  const admin = args.admin ? getAddress(args.admin) : getAddress(deployer);
  const salt = args.salt ?? ownedResolverSalt(admin);
  const roleBitmap = args.roleBitmap ?? DEFAULT_ROLE_BITMAP;
  const resolver = predictResolverAddress({ deployer, admin, salt });

  if (await isResolverDeployed(publicClient, resolver)) {
    return { resolver, alreadyDeployed: true };
  }

  const initializeData = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "initialize",
    args: [admin, roleBitmap],
  });
  const { request } = await publicClient.simulateContract({
    account,
    address: CONTRACTS.resolverFactory,
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [CONTRACTS.resolverImplementation, salt, initializeData],
  });
  const hash = await walletClient.writeContract(request);
  return { resolver, hash, alreadyDeployed: false };
}
