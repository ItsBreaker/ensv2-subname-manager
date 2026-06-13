# Subname Manager — standing constraints

Onboard-to-ENS subname manager for **ETHGlobal New York 2026**. A web3 novice signs in with
email, gets/connects an ENS name, and an org can auto-issue member subnames.

**The full plan lives in [docs/architecture.html](docs/architecture.html) — that is the source of
truth for architecture, contract addresses, and build sequencing. Read it before non-trivial work.**

## Network

- Build and demo on **Sepolia testnet**. Architecture stays portable to mainnet later — same
  contracts and flows, only addresses + gas economics change.

## Stack

- Next.js (App Router, TypeScript, `src/`), **wagmi + viem** (not ethers — reference code is viem).
- **Privy** for email login + embedded wallets (infrastructure only, not a prize submission).
- ENSv2 contracts on Sepolia for naming; addresses pinned in [src/lib/contracts.ts](src/lib/contracts.ts).

## ENSv2 Sepolia addresses (source: architecture doc §8)

| Contract | Address |
| --- | --- |
| PermissionedRegistry | `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67` |
| ETHRegistrar | `0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA` |
| paymentToken (ERC-20) | `0x3DfC8b53dAFa5eBbb071a8B97678Ab534Ed838D9` |
| resolverFactory (VerifiableFactory) | `0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198` |
| resolverImplementation | `0xdcE5205A553573FFd47629327DDdf36186022FfA` |
| resolverProxyLogic | `0x917C561a74Df398646e06f3FFAA51DB8e8330C5A` |
| NameWrapper (v1 fallback) | `0x0635513f179D50A207757E05759CbD106d7dFcE8` |
| UniversalResolver | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |

Interfaces are non-final upstream — pin these and re-check against gskril/ens-cli if a call reverts.

The reference impl `gskril/ens-cli` is cloned into `reference/ens-cli/` (gitignored) — authoritative
for the v2 registration commit/reveal flow and ABIs. ENSv2 registry/UserRegistry details come from
`ensdomains/namechain` (a.k.a. contracts-v2).

## Issuance model (CORRECTED — supersedes the architecture doc's NameStone golden path)

The platform NEVER owns names; users own their own parents (self-serve) AND orgs issue to members.
Subnames are created two ways:

- **Onchain (primary, built):** real ENSv2 subname tokens. Each parent issues through its OWN
  **subregistry** — a `UserRegistry` (a UUPS `PermissionedRegistry`) deployed as a proxy via the
  VerifiableFactory (= `resolverFactory` 0xd2A6…). Flow: `getSubregistry`/`setSubregistry` on the
  `.eth` registry (`PermissionedRegistry` 0xDEDB…) to attach it, then `register(label, owner, 0,
  resolver, roleBitmap, expiry)` on the subregistry to mint. Org delegation = `grantRoles(resource,
  ROLE_REGISTRAR, manager)`. Code: `src/lib/ens/{subregistry,issuer,roles}.ts`; script
  `npm run issue:subname`.
- **Offchain (option, NOT built):** our OWN self-hosted CCIP-Read gateway (Durin-style). **NameStone
  was dropped** — it requires a parent the platform controls + per-domain enablement, incompatible
  with self-serve user-owned names.

The `UserRegistry` implementation (the subregistry proxy impl) is pinned at
`0x0F99e7Ea74903AfCB7224d0354fD7428A6f92917` (from the current ens-cli `lib/contracts.ts` — pull
`reference/ens-cli` for the latest; it now has a `subregistry` command + `v2.ts`). The onchain path
runs with just RPC + a funded key (`npm run issue:subname`). Subregistry salt = `keccak256(abi.encode(
keccak256("UserRegistry"), namehash(name), 0))`; subname-owner roles = `V2_DEFAULT_OWNER_ROLE_BITMAP`.

## Build priority order

When time is short, never sacrifice a working core for a second half-working integration:

1. **Onchain self-serve golden path** — sign in → own/register a parent → issue real
   `you.parent.eth` subnames via the PermissionedRegistry → manager edits records.
2. **Org member flow** — verified email domain matches an enrolled parent → issue under it via a
   granted `ROLE_REGISTRAR` (delegation).
3. **Chainlink CRE** simulation (verifiable issuance gate).
4. **Offchain option** — our own CCIP-Read gateway.
5. **Ledger** device-backed approval on a high-risk parent op.
6. **Safe / roles**, extra doors (connect wallet, type-.eth-name → SIWE).

## UX requirement

Every button/control carries an `<InfoTip>` (ⓘ) — plain-language help, zero jargon. The audience
is web3 novices, so contextual help is core to the value prop, not polish.

## Auth model (do not break)

- **Email = eligibility** ("you may receive `you.acme.eth`").
- **Wallet / multisig = administration** ("you may govern `acme.eth`").
- First-sign-in is only a bootstrap trigger, never parent authority. Authority always traces to
  wallet control of the `.eth` name. Never authorize on name resolution alone — pair with SIWE.
