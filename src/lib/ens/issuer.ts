/**
 * SubnameIssuer — one internal interface, two backends (architecture doc §6); the manager picks
 * per-org at enrollment.
 *
 *   OnchainIssuer  → real ENSv2 subname tokens via the parent's UserRegistry subregistry (primary).
 *   OffchainIssuer → gasless offchain records via our own CCIP-Read gateway (option; not built yet).
 *
 * Onchain flow (matches the user's model: any user owns a parent and issues subnames under it):
 *   1. ensure the parent has a subregistry (deploy + attach a UserRegistry if missing)
 *   2. register(label, owner, 0, resolver, roleBitmap, expiry) on that subregistry → mints the subname
 *
 * Org delegation (the "manager" role from §2/§5) = grantManagerRole(): the parent owner grants a
 * manager/platform address ROLE_REGISTRAR on the subregistry so it can issue on the org's behalf.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  getAddress,
  zeroAddress,
} from "viem";
import { normalize } from "viem/ens";
import { permissionedRegistryAbi } from "./abis";
import { extractLabel } from "./registration";
import { ensureParentSubregistry, getParentState } from "./subregistry";
import {
  V2_DEFAULT_OWNER_ROLE_BITMAP,
  ROLE_REGISTRAR,
  ROLE_REGISTRAR_ADMIN,
  ROOT_RESOURCE,
} from "./roles";

export type IssuanceMode = "onchain" | "offchain";

export interface IssueArgs {
  /** Parent name, e.g. "democlub.eth" (2LD .eth supported for now). */
  parent: string;
  /** Leftmost label to create, e.g. "alice". */
  label: string;
  /** Address that will own the new subname. */
  owner: Address;
  /** Resolver for the subname (default: none — set later to hold records). */
  resolver?: Address;
  /** Expiry as a unix timestamp (default: the parent's expiry; a subname can't outlive its parent). */
  expiry?: bigint;
}

export interface IssuedSubname {
  fqdn: string;
  label: string;
  parent: string;
  owner: Address;
  resolver: Address;
  mode: IssuanceMode;
  /** The parent's subregistry the subname was minted into. */
  subregistry: Address;
  txHash: Hex;
}

export interface SubnameIssuer {
  issue(args: IssueArgs): Promise<IssuedSubname>;
  revoke(fqdn: string): Promise<void>;
}

export interface Clients {
  publicClient: PublicClient;
  walletClient: WalletClient;
}

export class OnchainIssuer implements SubnameIssuer {
  constructor(private readonly clients: Clients) {}

  /**
   * Ensure the parent can issue onchain subnames (deploy + attach a UserRegistry if needed).
   * Exposed so a one-time org setup can run this before the first issue. 2 txs on first call.
   */
  ensureSubregistry(parent: string) {
    const { publicClient, walletClient } = this.clients;
    return ensureParentSubregistry(publicClient, walletClient, parent);
  }

  async issue(args: IssueArgs): Promise<IssuedSubname> {
    const { publicClient, walletClient } = this.clients;
    const account = walletClient.account;
    if (!account) throw new Error("walletClient has no account — connect a wallet first.");

    const parent = normalize(args.parent);
    const parentLabel = extractLabel(parent); // validates 2LD .eth → "democlub"
    const label = normalize(args.label);
    if (label.includes(".")) {
      throw new Error(`Expected a single label (e.g. "alice"), got "${label}".`);
    }
    const owner = getAddress(args.owner);
    const resolver = args.resolver ? getAddress(args.resolver) : zeroAddress;

    // 1. Parent must have a subregistry to mint into.
    const { subregistry } = await ensureParentSubregistry(publicClient, walletClient, parent);

    // 2. Subnames can't outlive the parent — default to the parent's expiry.
    const expiry = args.expiry ?? (await getParentState(publicClient, parentLabel)).expiry;

    // 3. Mint the subname into the subregistry.
    const { request } = await publicClient.simulateContract({
      account,
      address: subregistry,
      abi: permissionedRegistryAbi,
      functionName: "register",
      args: [label, owner, zeroAddress, resolver, V2_DEFAULT_OWNER_ROLE_BITMAP, expiry],
    });
    const txHash = await walletClient.writeContract(request);

    return {
      fqdn: `${label}.${parent}`,
      label,
      parent,
      owner,
      resolver,
      mode: "onchain",
      subregistry,
      txHash,
    };
  }

  /**
   * TODO: revoke = burn/reclaim the subname via ROLE_UNREGISTER on the subregistry. The exact
   * unregister entrypoint needs verifying against the deployed contract before relying on it.
   */
  async revoke(_fqdn: string): Promise<void> {
    throw new Error("OnchainIssuer.revoke is not implemented yet (verify the unregister call first).");
  }
}

/**
 * Delegate issuance to a manager/platform: grant ROLE_REGISTRAR (+ its admin) on a parent's
 * subregistry so that account can register subnames on the org's behalf (architecture doc §5).
 * Must be sent by an account holding the admin role (the registry owner). Returns the tx hash.
 */
export function grantManagerRole(
  clients: Clients,
  args: { subregistry: Address; manager: Address; roleBitmap?: bigint; resource?: bigint },
): Promise<Hex> {
  const { publicClient, walletClient } = clients;
  const account = walletClient.account;
  if (!account) throw new Error("walletClient has no account — connect a wallet first.");
  const roleBitmap = args.roleBitmap ?? (ROLE_REGISTRAR | ROLE_REGISTRAR_ADMIN);
  const resource = args.resource ?? ROOT_RESOURCE;
  return publicClient
    .simulateContract({
      account,
      address: getAddress(args.subregistry),
      abi: permissionedRegistryAbi,
      functionName: "grantRoles",
      args: [resource, roleBitmap, getAddress(args.manager)],
    })
    .then(({ request }) => walletClient.writeContract(request));
}

/**
 * Placeholder for the gasless offchain option. NameStone was dropped (it requires a parent the
 * platform controls + per-domain enablement — incompatible with self-serve user-owned names).
 * The offchain path will be OUR OWN self-hosted CCIP-Read gateway (Durin-style). Not built yet.
 */
export class OffchainIssuer implements SubnameIssuer {
  async issue(_args: IssueArgs): Promise<IssuedSubname> {
    throw new Error("OffchainIssuer (self-hosted CCIP-Read gateway) is not implemented yet.");
  }
  async revoke(_fqdn: string): Promise<void> {
    throw new Error("OffchainIssuer.revoke is not implemented yet.");
  }
}
