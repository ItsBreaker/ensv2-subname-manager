/**
 * SubnameIssuer — the one internal interface with two backends (architecture doc §6).
 * The manager picks per-org at enrollment which backend to use.
 *
 *   OffchainIssuer → NameStone REST write + CCIP-Read resolution (gasless) — Phase 1, TODO below.
 *   OnchainIssuer  → real subname via setSubnodeRecord (holder-owned, gas per issue).
 *
 * The OnchainIssuer here mirrors the *proven* calls from the booth reference
 * gskril/ens-cli (`commands/subname.ts`): read the parent owner, then route to
 * NameWrapper.setSubnodeRecord (wrapped parent) or ENS registry.setSubnodeRecord
 * (unwrapped parent). This is exactly the architecture doc's "v1 fallback".
 *
 * NOTE: the v2 PermissionedRegistry EAC create-subname path is NOT in ens-cli, so it
 * is intentionally left as a documented TODO (see issueViaV2Eac). Reference for it is the
 * ENSv2 "build a subname registrar on the Permissioned Registry" tutorial, not this CLI.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  getAddress,
  isAddressEqual,
  zeroAddress,
} from "viem";
import { labelhash, namehash, normalize } from "viem/ens";
import { CONTRACTS, V1_CONTRACTS } from "../contracts";
import { ensRegistryAbi, nameWrapperAbi } from "./abis";

export type IssuanceMode = "onchain" | "offchain";

export interface IssueArgs {
  /** Parent name, e.g. "democlub.eth". */
  parent: string;
  /** Leftmost label to create, e.g. "alice". */
  label: string;
  /** Address that will own the new subname. */
  owner: Address;
  /** Resolver for the subname (default: the v1 public resolver). */
  resolver?: Address;
  /** NameWrapper fuses bitmask — ignored on unwrapped parents (default: 0). */
  fuses?: number;
  /** NameWrapper expiry as a unix timestamp — ignored on unwrapped parents (default: 0). */
  expiry?: bigint;
}

export interface IssuedSubname {
  fqdn: string;
  label: string;
  parent: string;
  owner: Address;
  resolver: Address;
  mode: IssuanceMode;
  /** Whether the parent was wrapped (NameWrapper path) vs. unwrapped (registry path). */
  wrapped: boolean;
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

/** TTL for created subnames — matches the reference (0 = inherit). */
const TTL = 0n;

export class OnchainIssuer implements SubnameIssuer {
  constructor(private readonly clients: Clients) {}

  async issue(args: IssueArgs): Promise<IssuedSubname> {
    const { publicClient, walletClient } = this.clients;
    const account = walletClient.account;
    if (!account) throw new Error("walletClient has no account — connect a wallet first.");

    const parent = normalize(args.parent);
    const label = normalize(args.label);
    if (label.includes(".")) {
      throw new Error(`Expected a single label (e.g. "alice"), got "${label}".`);
    }
    const owner = getAddress(args.owner);
    const resolver = args.resolver ? getAddress(args.resolver) : V1_CONTRACTS.PublicResolver;
    const parentNode = namehash(parent);
    const fqdn = `${label}.${parent}`;

    // A subname can only be created onchain if the parent has an owner in the registry.
    const parentRegistryOwner = await publicClient.readContract({
      address: V1_CONTRACTS.ENSRegistry,
      abi: ensRegistryAbi,
      functionName: "owner",
      args: [parentNode],
    });
    if (parentRegistryOwner === zeroAddress) {
      throw new Error(
        `Parent "${parent}" has no owner in the ENS registry, so a subname cannot be created onchain.`,
      );
    }

    const wrapped = isAddressEqual(parentRegistryOwner, CONTRACTS.NameWrapper);

    if (wrapped) {
      // Parent is wrapped — the registry owner is the NameWrapper; the real owner is wrapped.
      const wrappedOwner = await publicClient.readContract({
        address: CONTRACTS.NameWrapper,
        abi: nameWrapperAbi,
        functionName: "ownerOf",
        args: [BigInt(parentNode)],
      });
      if (wrappedOwner === zeroAddress) {
        throw new Error(
          `Parent "${parent}" is held by the NameWrapper but has no wrapped owner (likely expired).`,
        );
      }

      const { request } = await publicClient.simulateContract({
        account,
        address: CONTRACTS.NameWrapper,
        abi: nameWrapperAbi,
        functionName: "setSubnodeRecord",
        args: [parentNode, label, owner, resolver, TTL, args.fuses ?? 0, args.expiry ?? 0n],
      });
      const txHash = await walletClient.writeContract(request);
      return { fqdn, label, parent, owner, resolver, mode: "onchain", wrapped: true, txHash };
    }

    // Unwrapped parent — create the subnode directly on the registry.
    const { request } = await publicClient.simulateContract({
      account,
      address: V1_CONTRACTS.ENSRegistry,
      abi: ensRegistryAbi,
      functionName: "setSubnodeRecord",
      args: [parentNode, labelhash(label), owner, resolver, TTL],
    });
    const txHash = await walletClient.writeContract(request);
    return { fqdn, label, parent, owner, resolver, mode: "onchain", wrapped: false, txHash };
  }

  /**
   * TODO (Phase 2/3): the booth reference has no revoke flow. Onchain revocation means the
   * parent owner reassigns/clears the subnode (setSubnodeRecord to a new owner / zero address,
   * or a v2 EAC role revoke). Implement deliberately rather than guessing.
   */
  async revoke(_fqdn: string): Promise<void> {
    throw new Error("OnchainIssuer.revoke is not implemented yet (no reference in ens-cli).");
  }
}

/**
 * Placeholder for the gasless Phase 1 golden path. Not part of the ens-cli reference —
 * NameStone has its own REST API + CCIP-Read resolution. Wired in Phase 1.
 */
export class OffchainIssuer implements SubnameIssuer {
  async issue(_args: IssueArgs): Promise<IssuedSubname> {
    throw new Error("OffchainIssuer (NameStone) is not implemented yet — Phase 1 golden path.");
  }
  async revoke(_fqdn: string): Promise<void> {
    throw new Error("OffchainIssuer.revoke is not implemented yet — Phase 1 golden path.");
  }
}

/**
 * TODO: v2 PermissionedRegistry EAC create-subname. The architecture doc's *primary* onchain
 * target, but absent from ens-cli — so not adapted here. Reference: ENSv2 "build a subname
 * registrar on the Permissioned Registry" tutorial + PermissionedRegistry (CONTRACTS.PermissionedRegistry).
 * Until then, OnchainIssuer uses the proven NameWrapper/registry path above.
 */
export function issueViaV2Eac(): never {
  throw new Error(
    "v2 PermissionedRegistry EAC issuance not implemented yet — see ENSv2 subname-registrar tutorial.",
  );
}
