/**
 * Per-parent subregistry management for onchain ENSv2 subname issuance.
 *
 * Mirrors gskril/ens-cli `commands/subregistry.ts` + `lib/v2.ts` (the booth reference). To issue
 * onchain subnames under a parent (e.g. democlub.eth) the parent must point at its own subregistry
 * — a UserRegistry deployed as a proxy via the VerifiableFactory (same machinery as the per-account
 * resolver). This module deploys that registry, attaches it, and reads parent state.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  stringToBytes,
  zeroAddress,
} from "viem";
import { labelhash, namehash } from "viem/ens";
import { CONTRACTS } from "../contracts";
import { permissionedRegistryAbi, verifiableFactoryAbi } from "./abis";
import { predictProxyAddress, isResolverDeployed, extractLabel } from "./registration";
import { ALL_ROLES } from "./roles";

/**
 * The ENSv2 UserRegistry implementation on Sepolia. Pinned from ens-cli `lib/contracts.ts`
 * (`subregistryImplementation`). Overridable via NEXT_PUBLIC_USER_REGISTRY_IMPL.
 */
export function getUserRegistryImpl(): Address {
  const override = process.env.NEXT_PUBLIC_USER_REGISTRY_IMPL;
  if (override && /^0x[0-9a-fA-F]{40}$/.test(override)) return getAddress(override);
  return CONTRACTS.subregistryImplementation;
}

const USER_REGISTRY_ID = keccak256(stringToBytes("UserRegistry"));
const USER_REGISTRY_VERSION = 0n;

/**
 * Canonical CREATE2 salt for a NAME's UserRegistry (ens-cli defaultUserRegistrySalt): keyed by
 * namehash(name), NOT the admin address — so a given parent has one deterministic subregistry.
 */
export function userRegistrySalt(name: string): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
        [USER_REGISTRY_ID, namehash(name), USER_REGISTRY_VERSION],
      ),
    ),
  );
}

/** Predict the UserRegistry proxy address for (deployer, name) without sending a transaction. */
export function predictUserRegistryAddress(args: {
  deployer: Address;
  name: string;
  salt?: bigint;
}): Address {
  const salt = args.salt ?? userRegistrySalt(args.name);
  return predictProxyAddress({ deployer: getAddress(args.deployer), salt });
}

function requireAccount(walletClient: WalletClient) {
  const account = walletClient.account;
  if (!account) throw new Error("walletClient has no account — connect a wallet first.");
  return account;
}

export interface DeployUserRegistryResult {
  registry: Address;
  hash?: Hex;
  alreadyDeployed: boolean;
}

/**
 * Deploy a UserRegistry to serve as `name`'s subregistry, via VerifiableFactory.deployProxy. The
 * rootAccount (default: deployer) gets ALL_ROLES so it can register subnames and delegate
 * ROLE_REGISTRAR to managers. Idempotent on the predicted proxy address.
 */
export async function deployUserRegistry(
  publicClient: PublicClient,
  walletClient: WalletClient,
  args: { name: string; rootAccount?: Address; salt?: bigint; roleBitmap?: bigint },
): Promise<DeployUserRegistryResult> {
  const account = requireAccount(walletClient);
  const deployer = account.address;
  const rootAccount = args.rootAccount ? getAddress(args.rootAccount) : getAddress(deployer);
  const salt = args.salt ?? userRegistrySalt(args.name);
  const roleBitmap = args.roleBitmap ?? ALL_ROLES;
  const registry = predictUserRegistryAddress({ deployer, name: args.name, salt });

  if (await isResolverDeployed(publicClient, registry)) {
    return { registry, alreadyDeployed: true };
  }

  const initializeData = encodeFunctionData({
    abi: permissionedRegistryAbi,
    functionName: "initialize",
    args: [rootAccount, roleBitmap],
  });
  const { request } = await publicClient.simulateContract({
    account,
    address: CONTRACTS.resolverFactory, // generic VerifiableFactory
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [getUserRegistryImpl(), salt, initializeData],
  });
  const hash = await walletClient.writeContract(request);
  return { registry, hash, alreadyDeployed: false };
}

/** Read the on-chain state of a 2LD label in the .eth registry (status, expiry, tokenId, …). */
export function getParentState(publicClient: PublicClient, parentLabel: string) {
  return publicClient.readContract({
    address: CONTRACTS.PermissionedRegistry,
    abi: permissionedRegistryAbi,
    functionName: "getState",
    args: [BigInt(labelhash(parentLabel))],
  });
}

/** Read the subregistry currently attached to a parent label (zeroAddress if none). */
export function getParentSubregistry(
  publicClient: PublicClient,
  parentLabel: string,
): Promise<Address> {
  return publicClient.readContract({
    address: CONTRACTS.PermissionedRegistry,
    abi: permissionedRegistryAbi,
    functionName: "getSubregistry",
    args: [parentLabel],
  });
}

/**
 * Attach a subregistry to a parent (requires ROLE_SET_SUBREGISTRY — the owner has it). Reads the
 * canonical tokenId via getState first, matching ens-cli's `subregistry set`.
 */
export async function setParentSubregistry(
  publicClient: PublicClient,
  walletClient: WalletClient,
  args: { parentLabel: string; subregistry: Address },
): Promise<Hex> {
  const account = requireAccount(walletClient);
  const state = await getParentState(publicClient, args.parentLabel);
  const { request } = await publicClient.simulateContract({
    account,
    address: CONTRACTS.PermissionedRegistry,
    abi: permissionedRegistryAbi,
    functionName: "setSubregistry",
    args: [state.tokenId, getAddress(args.subregistry)],
  });
  return walletClient.writeContract(request);
}

export interface EnsureSubregistryResult {
  subregistry: Address;
  /** True if we deployed + attached one this call (vs it already existing). */
  created: boolean;
  deployHash?: Hex;
  setHash?: Hex;
}

/**
 * Ensure a parent has a subregistry, deploying + attaching a UserRegistry if not. Waits for each
 * tx so the registry exists before it's attached (and before subnames are registered). First call
 * under a parent costs 2 txs; afterwards it's a single read.
 */
export async function ensureParentSubregistry(
  publicClient: PublicClient,
  walletClient: WalletClient,
  parentName: string,
): Promise<EnsureSubregistryResult> {
  const parentLabel = extractLabel(parentName); // validates 2LD .eth, returns "democlub"

  const existing = await getParentSubregistry(publicClient, parentLabel);
  if (existing && existing !== zeroAddress) {
    return { subregistry: existing, created: false };
  }

  const deployed = await deployUserRegistry(publicClient, walletClient, { name: parentName });
  if (deployed.hash) {
    await publicClient.waitForTransactionReceipt({ hash: deployed.hash });
  }

  const setHash = await setParentSubregistry(publicClient, walletClient, {
    parentLabel,
    subregistry: deployed.registry,
  });
  await publicClient.waitForTransactionReceipt({ hash: setHash });

  return { subregistry: deployed.registry, created: true, deployHash: deployed.hash, setHash };
}
