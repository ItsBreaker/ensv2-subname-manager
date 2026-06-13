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
  /** resolverFactory — deploy per-account resolvers. */
  resolverFactory: "0xd2A632D8A8b67C2c4398c255CBd7Af8Dd7236198",
  /** resolverImplementation — resolver logic implementation. */
  resolverImplementation: "0xdcE5205A553573FFd47629327DDdf36186022FfA",
  /** resolverProxyLogic — resolver proxy logic. */
  resolverProxyLogic: "0x917C561a74Df398646e06f3FFAA51DB8e8330C5A",
  /** NameWrapper (v1 fallback) — guaranteed onchain issuance via setSubnodeRecord. */
  NameWrapper: "0x0635513f179D50A207757E05759CbD106d7dFcE8",
  /** UniversalResolver — canonical resolution entry point (v1 + v2). */
  UniversalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
} as const satisfies Record<string, `0x${string}`>;

export type ContractName = keyof typeof CONTRACTS;
