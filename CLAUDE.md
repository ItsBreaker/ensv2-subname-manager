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
| resolverFactory | `0xd2A632D8A8b67C2c4398c255CBd7Af8Dd7236198` |
| resolverImplementation | `0xdcE5205A553573FFd47629327DDdf36186022FfA` |
| resolverProxyLogic | `0x917C561a74Df398646e06f3FFAA51DB8e8330C5A` |
| NameWrapper (v1 fallback) | `0x0635513f179D50A207757E05759CbD106d7dFcE8` |
| UniversalResolver | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |

Interfaces are non-final upstream — pin these and re-check against gskril/ens-cli if a call reverts.

## Golden-path-first priority order

When time is short, build in this order and never sacrifice a flawless golden path for a
second half-working integration:

1. **Phase 1 golden path** — email login → embedded wallet → verified domain matches a
   pre-enrolled parent → auto-issue `you.democlub.eth` **offchain** (NameStone) → manager edits
   text records → resolution works.
2. **Chainlink CRE** simulation (verifiable issuance gate).
3. **Onchain** issuance toggle (ENSv2 EAC role; NameWrapper fallback).
4. **Ledger** device-backed approval on a high-risk parent op.
5. **Safe / roles** (multisig posture + one role-grant manager onboarding).
6. Extra doors (connect wallet, type-.eth-name → SIWE).

## UX requirement

Every button/control carries an `<InfoTip>` (ⓘ) — plain-language help, zero jargon. The audience
is web3 novices, so contextual help is core to the value prop, not polish.

## Auth model (do not break)

- **Email = eligibility** ("you may receive `you.acme.eth`").
- **Wallet / multisig = administration** ("you may govern `acme.eth`").
- First-sign-in is only a bootstrap trigger, never parent authority. Authority always traces to
  wallet control of the `.eth` name. Never authorize on name resolution alone — pair with SIWE.
