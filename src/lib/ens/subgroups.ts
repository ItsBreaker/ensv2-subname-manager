/**
 * Named sub-namespaces ("subgroups") for org subname issuance.
 *
 * A subgroup is a nested name like `eng.org.eth` that has its OWN UserRegistry subregistry, into
 * which members are issued (`alice.eng.org.eth`). It lets an org partition its namespace and
 * delegate issuance per branch: a subgroup's manager holds ROLE_REGISTRAR on that subgroup's
 * registry only — they can mint under `eng.org.eth` but not under the org root or sibling subgroups.
 *
 * The machinery is the same EAC/UserRegistry pattern as the org parent, just one level deeper. The
 * functions here generalize subregistry.ts/issuer.ts (which target the root .eth PermissionedRegistry)
 * to operate on ANY registry address — the org's UserRegistry is the same contract type, so:
 *   - register a label INTO a registry (mint the subgroup/member token),
 *   - attach a child subregistry to a token (so the subgroup can hold its own members),
 *   - grant a manager ROLE_REGISTRAR on a registry (delegate issuance).
 *
 * Authority: the platform key (ISSUER/DEPLOYER) holds ALL_ROLES on each UserRegistry it deploys, so
 * it can register subgroups, attach their registries, and grant managers. The org parent must already
 * exist + be owned by the platform key (auto-provisioned orgs) for this to be callable server-side.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  getAddress,
  zeroAddress,
} from "viem";
import { labelhash, normalize } from "viem/ens";
import { permissionedRegistryAbi } from "./abis";
import { extractLabel } from "./registration";
import {
  deployUserRegistry,
  ensureParentSubregistry,
  getParentState,
} from "./subregistry";
import type { Clients } from "./issuer";
import { ROLE_REGISTRAR, ROOT_RESOURCE, V2_DEFAULT_OWNER_ROLE_BITMAP } from "./roles";

function requireAccount(walletClient: WalletClient) {
  const account = walletClient.account;
  if (!account) throw new Error("walletClient has no account — connect a wallet first.");
  return account;
}

function singleLabel(label: string, what: string): string {
  const l = normalize(label);
  if (!l || l.includes(".")) throw new Error(`${what} must be a single label (e.g. "eng"), got "${label}".`);
  return l;
}

/** Read the child subregistry attached to `label` within `registry` (zeroAddress if none). */
export function getSubregistryIn(
  publicClient: PublicClient,
  registry: Address,
  label: string,
): Promise<Address> {
  return publicClient.readContract({
    address: getAddress(registry),
    abi: permissionedRegistryAbi,
    functionName: "getSubregistry",
    args: [label],
  });
}

/** Read the on-chain state tuple of `label` within `registry`. */
export function getStateIn(publicClient: PublicClient, registry: Address, label: string) {
  return publicClient.readContract({
    address: getAddress(registry),
    abi: permissionedRegistryAbi,
    functionName: "getState",
    args: [BigInt(labelhash(label))],
  });
}

export interface RegisterInArgs {
  registry: Address;
  label: string;
  owner: Address;
  /** The new token's OWN subregistry (attach a child at mint); default none. */
  subregistry?: Address;
  resolver?: Address;
  roleBitmap?: bigint;
  expiry: bigint;
}

/** Register `label` into `registry`, optionally attaching the token's own subregistry at mint. */
export async function registerIn(clients: Clients, args: RegisterInArgs): Promise<Hex> {
  const { publicClient, walletClient } = clients;
  const account = requireAccount(walletClient);
  const { request } = await publicClient.simulateContract({
    account,
    address: getAddress(args.registry),
    abi: permissionedRegistryAbi,
    functionName: "register",
    args: [
      args.label,
      getAddress(args.owner),
      args.subregistry ? getAddress(args.subregistry) : zeroAddress,
      args.resolver ? getAddress(args.resolver) : zeroAddress,
      args.roleBitmap ?? V2_DEFAULT_OWNER_ROLE_BITMAP,
      args.expiry,
    ],
  });
  return walletClient.writeContract(request);
}

/** Attach `child` as the subregistry of `label`'s token within `registry`. */
export async function setSubregistryIn(
  clients: Clients,
  args: { registry: Address; label: string; child: Address },
): Promise<Hex> {
  const { publicClient, walletClient } = clients;
  const account = requireAccount(walletClient);
  const state = await getStateIn(publicClient, args.registry, args.label);
  const { request } = await publicClient.simulateContract({
    account,
    address: getAddress(args.registry),
    abi: permissionedRegistryAbi,
    functionName: "setSubregistry",
    args: [state.tokenId, getAddress(args.child)],
  });
  return walletClient.writeContract(request);
}

/**
 * Grant a manager registry-wide ROLE_REGISTRAR so they can issue names — delegate issuance. Uses
 * `grantRootRoles` (NOT `grantRoles`, which reverts on the root resource with EACRootResourceNotAllowed);
 * `register` checks ROLE_REGISTRAR on the ROOT resource, which is exactly what this grants. Only
 * ROLE_REGISTRAR is granted (the manager issues, but can't re-delegate).
 */
export function grantRegistrarRole(
  clients: Clients,
  args: { registry: Address; manager: Address; roleBitmap?: bigint },
): Promise<Hex> {
  const { publicClient, walletClient } = clients;
  const account = requireAccount(walletClient);
  const roleBitmap = args.roleBitmap ?? ROLE_REGISTRAR;
  return publicClient
    .simulateContract({
      account,
      address: getAddress(args.registry),
      abi: permissionedRegistryAbi,
      functionName: "grantRootRoles",
      args: [roleBitmap, getAddress(args.manager)],
    })
    .then(({ request }) => walletClient.writeContract(request));
}

/** Check whether `account` holds `roleBitmap` on `registry`'s root resource. */
export function hasRolesIn(
  publicClient: PublicClient,
  args: { registry: Address; account: Address; roleBitmap: bigint; resource?: bigint },
): Promise<boolean> {
  return publicClient.readContract({
    address: getAddress(args.registry),
    abi: permissionedRegistryAbi,
    functionName: "hasRoles",
    args: [args.resource ?? ROOT_RESOURCE, args.roleBitmap, getAddress(args.account)],
  });
}

export interface CreateSubgroupResult {
  fqdn: string; // eng.org.eth
  parent: string; // org.eth
  subgroupLabel: string; // eng
  parentRegistry: Address; // org.eth's UserRegistry
  childRegistry: Address; // eng.org.eth's UserRegistry
  manager?: Address;
  created: boolean; // false if it already existed (idempotent no-op)
  txs: { deploy?: Hex; register?: Hex; setSubregistry?: Hex; grant?: Hex };
}

/**
 * Create (or ensure) a subgroup `label.parent` with its own subregistry, optionally delegating a
 * manager. Idempotent: re-running with the same args is a no-op (and will only add the manager grant
 * if a new manager is supplied). Sent by the platform key, which owns the org parent + its registry.
 */
export async function createSubgroup(
  clients: Clients,
  args: { parent: string; label: string; manager?: Address; expiry?: bigint },
): Promise<CreateSubgroupResult> {
  const { publicClient, walletClient } = clients;
  const account = requireAccount(walletClient);
  const parent = normalize(args.parent);
  const parentLabel = extractLabel(parent); // validates a 2LD .eth parent
  const subgroupLabel = singleLabel(args.label, "subgroup label");
  const fqdn = `${subgroupLabel}.${parent}`;
  const manager = args.manager ? getAddress(args.manager) : undefined;
  const txs: CreateSubgroupResult["txs"] = {};

  // 1. The org parent must have a subregistry (org.eth's UserRegistry). Platform holds ALL_ROLES.
  const { subregistry: parentRegistry } = await ensureParentSubregistry(publicClient, walletClient, parent);

  // 2. Deploy the subgroup's own UserRegistry (eng.org.eth) — idempotent on the predicted address.
  const deployed = await deployUserRegistry(publicClient, walletClient, { name: fqdn });
  const childRegistry = deployed.registry;
  if (deployed.hash) {
    txs.deploy = deployed.hash;
    await publicClient.waitForTransactionReceipt({ hash: deployed.hash });
  }

  // 3. Ensure the subgroup label is registered in the parent registry and points at its child registry.
  //    A subname can't outlive its parent — cap expiry at the org parent's expiry.
  const expiry = args.expiry ?? (await getParentState(publicClient, parentLabel)).expiry;
  const state = await getStateIn(publicClient, parentRegistry, subgroupLabel);
  const isRegistered = state.latestOwner !== zeroAddress;
  let created = false;

  if (!isRegistered) {
    // Mint the subgroup token to the platform and attach its child registry in the same call.
    txs.register = await registerIn(clients, {
      registry: parentRegistry,
      label: subgroupLabel,
      owner: account.address,
      subregistry: childRegistry,
      roleBitmap: V2_DEFAULT_OWNER_ROLE_BITMAP,
      expiry,
    });
    await publicClient.waitForTransactionReceipt({ hash: txs.register });
    created = true;
  } else {
    const current = await getSubregistryIn(publicClient, parentRegistry, subgroupLabel);
    if (getAddress(current) !== getAddress(childRegistry)) {
      txs.setSubregistry = await setSubregistryIn(clients, {
        registry: parentRegistry,
        label: subgroupLabel,
        child: childRegistry,
      });
      await publicClient.waitForTransactionReceipt({ hash: txs.setSubregistry });
      created = true;
    }
  }

  // 4. Delegate issuance to the manager on the subgroup's registry only.
  if (manager) {
    const already = await hasRolesIn(publicClient, {
      registry: childRegistry,
      account: manager,
      roleBitmap: ROLE_REGISTRAR,
    });
    if (!already) {
      txs.grant = await grantRegistrarRole(clients, { registry: childRegistry, manager });
      await publicClient.waitForTransactionReceipt({ hash: txs.grant });
    }
  }

  return { fqdn, parent, subgroupLabel, parentRegistry, childRegistry, manager, created, txs };
}

export interface IssueUnderSubgroupResult {
  fqdn: string; // alice.eng.org.eth
  childRegistry: Address;
  txHash: Hex;
}

/**
 * Issue a member name under an existing subgroup: register `label` into the subgroup's registry
 * (mints `label.subgroup.parent`). The caller must hold ROLE_REGISTRAR on the subgroup registry
 * (the platform key does; a delegated manager does too).
 */
export async function issueUnderSubgroup(
  clients: Clients,
  args: { parent: string; subgroup: string; label: string; owner: Address; resolver?: Address; expiry?: bigint },
): Promise<IssueUnderSubgroupResult> {
  const { publicClient, walletClient } = clients;
  requireAccount(walletClient);
  const parent = normalize(args.parent);
  const subgroup = singleLabel(args.subgroup, "subgroup label");
  const label = singleLabel(args.label, "member label");

  const { subregistry: parentRegistry } = await ensureParentSubregistry(publicClient, walletClient, parent);
  const childRegistry = await getSubregistryIn(publicClient, parentRegistry, subgroup);
  if (childRegistry === zeroAddress) {
    throw new Error(`Subgroup ${subgroup}.${parent} has no subregistry — create it first.`);
  }
  // A member can't outlive its subgroup — default to the subgroup token's expiry.
  const expiry = args.expiry ?? (await getStateIn(publicClient, parentRegistry, subgroup)).expiry;

  const txHash = await registerIn(clients, {
    registry: childRegistry,
    label,
    owner: args.owner,
    resolver: args.resolver,
    roleBitmap: V2_DEFAULT_OWNER_ROLE_BITMAP,
    expiry,
  });

  return { fqdn: `${label}.${subgroup}.${parent}`, childRegistry, txHash };
}
