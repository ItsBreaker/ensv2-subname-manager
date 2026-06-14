/**
 * ENSv2 contract addresses on Sepolia.
 *
 * Source of truth: docs/architecture.html §8 ("ENSv2 Sepolia addresses — confirmed").
 * Interfaces are still labelled non-final upstream, so these are pinned here — re-check
 * against gskril/ens-cli `lib/contracts.ts` if a call reverts unexpectedly.
 *
 * Everything in this project is built and demoed on Sepolia (testnet), with the same
 * contracts/flows intended to port to mainnet later (only addresses + gas economics change).
 */

export const CONTRACTS = {
  /** PermissionedRegistry — onchain subname issuance + Enhanced Access Control (EAC) roles. */
  PermissionedRegistry: "0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67",
  /** ETHRegistrar — parent-name registration (commit/reveal with ERC-20 payment). */
  ETHRegistrar: "0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA",
  /** paymentToken (ERC-20) — registration payment; approve before reveal. */
  paymentToken: "0x3DfC8b53dAFa5eBbb071a8B97678Ab534Ed838D9",
  /** resolverFactory (VerifiableFactory) — deploy per-account resolvers + subregistries.
   *  NB: canonical EIP-55 casing; the architecture doc / ens-cli use a non-canonical casing that
   *  viem's strict address validation rejects. Same underlying address. */
  resolverFactory: "0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198",
  /** resolverImplementation — resolver logic implementation. */
  resolverImplementation: "0xdcE5205A553573FFd47629327DDdf36186022FfA",
  /** resolverProxyLogic — proxy logic for ALL VerifiableFactory proxies (resolvers + subregistries). */
  resolverProxyLogic: "0x917C561a74Df398646e06f3FFAA51DB8e8330C5A",
  /** subregistryImplementation — UserRegistry impl; per-parent subregistry proxies point at this. */
  subregistryImplementation: "0x0F99e7Ea74903AfCB7224d0354fD7428A6f92917",
  /** NameWrapper (v1 fallback) — guaranteed onchain issuance via setSubnodeRecord. */
  NameWrapper: "0x0635513f179D50A207757E05759CbD106d7dFcE8",
  /** UniversalResolver — canonical resolution entry point (v1 + v2). */
  UniversalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
} as const satisfies Record<string, `0x${string}`>;

export type ContractName = keyof typeof CONTRACTS;

/**
 * CRE DomainVerifier (Sepolia) — the on-chain target the Chainlink CRE workflow writes to after the
 * DON verifies a domain's DNS-TXT challenge and reaches consensus. `isVerified(domain)` reads
 * `verifiedDomain[keccak256(domain)]`. Source: ENSv2_subname_manager/ (workflow + contract).
 */
export const DOMAIN_VERIFIER_ADDRESS =
  "0x754AD90E8bCd7fb645126bB4626643D2a97da2b5" as const satisfies `0x${string}`;

/**
 * ENSv1 contracts on Sepolia — used only by the onchain subname *fallback*
 * (NameWrapper / registry `setSubnodeRecord`, per architecture doc §6).
 *
 * Confirmed identical to gskril/ens-cli `lib/contracts.ts` (the booth reference).
 * NameWrapper + UniversalResolver are shared across v1/v2 and already live in CONTRACTS.
 */
export const V1_CONTRACTS = {
  /** ENS registry — read parent owner; setSubnodeRecord on unwrapped parents. */
  ENSRegistry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  /** Public resolver — default resolver for onchain subnames. */
  PublicResolver: "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5",
  /** Base registrar (.eth) — name expiry lookups. */
  BaseRegistrar: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
  /** v1 ETHRegistrarController — v1 commit/reveal (not used by the v2 flow). */
  ETHRegistrarController: "0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968",
} as const satisfies Record<string, `0x${string}`>;

export type V1ContractName = keyof typeof V1_CONTRACTS;
