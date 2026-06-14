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

## Enrollment + issuance API (server-side)

Org enrollment is **Supabase-backed** (`orgs` table; `subnames` indexes issued names — see
`supabase/schema.sql`). DB access is **server-only** via the SECRET key (`src/lib/supabase.ts`); the
browser never touches Supabase. The UI gets eligibility from `GET /api/org` and claims via
`POST /api/issue`. Both verify the caller's Privy token server-side (`src/lib/auth.ts` `verifyMember`)
→ derive the verified email domain → match an enrolled org → the **platform's `ISSUER_PRIVATE_KEY`**
(holds `ROLE_REGISTRAR`) mints to the member's wallet. Public email domains (gmail/outlook) are
routed to self-serve, not org-enrolled. Server-only env: `PRIVY_APP_SECRET`, `ISSUER_PRIVATE_KEY`,
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`.

**Auto-provision (Phase B):** an unenrolled org domain can register a platform-owned parent.
`GET /api/provision` suggests registerable names (base + alternatives if taken). Because a parent
registration is commit → 60s → reveal (too long for one serverless call), it's a two-call flow:
`POST /api/provision/start` (commit, stores a pending `orgs` row with `commit_secret` + `ready_at`)
then, after the client waits, `POST /api/provision/finish` (mint test token if needed → approve →
register → mark active; idempotent if the name is already ours). The platform key (`ISSUER_PRIVATE_KEY`)
pays gas + holds the name. Requires the `orgs` columns `commit_secret` + `ready_at` (see supabase/schema.sql).

**Entry modes + admin console:** the UI has a member/admin split (`GoldenPath` doors + a header toggle).
Members claim names; admins manage the org. The provisioner is recorded as the org's admin
(`orgs.admin_email` — bootstrap only; DNS/CRE proof to harden later). `AdminConsole` shows the org
set-up (provisioning) or the members list (`GET /api/admin/org`) with removal
(`POST /api/admin/remove` — **revokes on-chain** via `unregister` then de-lists; the platform holds
`ROLE_UNREGISTER` on the subregistry root, which the EAC ORs onto every token, so subnames are
revocable by the org). Open enrollment: `orgs.open_enrollment` lets public-email users claim
under a typed org name. **CSV bulk import:** admins upload emails/labels (`POST /api/admin/import`) →
rows are stored in `reservations` (a `(parent,email)` table); a member with a reservation may claim
it on sign-in (a third eligibility path in `/api/issue`, after domain match + open org). The UI is a
light/ENS theme (white bg, blue accent) driven by CSS variables in `globals.css`.

**Admin proof (DNS, working):** an admin proves they control the org's domain (not just one mailbox —
doc §2) via a DNS-TXT challenge. `POST /api/admin/verify/start` stores a `verify_token` and returns
a `ens-subname-verify=<token>` TXT record; `POST /api/admin/verify/check` does a server-side
`dns.resolveTxt` on the org's domain and sets `domain_verified_at` on match. Shown as a verified
badge in the AdminConsole. Verification is keyed by domain (`domain_verifications` table, see
`src/lib/verifications.ts`) and **gates provisioning** (`/api/provision/start` rejects unverified;
`/api/provision` returns `kind:"unverified"`). The earlier `orgs.verify_token`/`domain_verified_at`
columns are superseded (unused).

**CRE layer (prize, in `ENSv2_subname_manager/`):** the verifiable version of the DNS check — a
Chainlink CRE TS workflow (`@chainlink/cre-sdk@1.11.0`, scaffolded by `cre init` into a SEPARATE
project at `ENSv2_subname_manager/`). It's **HTTP-triggered and dynamic**: the `{domain, token}` come
from the request body (`decodeJson(payload.input)`), never hardcoded in config. Each DON node fetches
the domain's TXT via DNS-over-HTTPS, reaches consensus, then `runtime.report()` →
`EVMClient.writeReport()` writes on-chain to `ENSv2_subname_manager/contracts/DomainVerifier.sol` (a
`ReceiverTemplate` whose `_processReport` sets `verifiedDomain[keccak256(domain)]`; deployed to Sepolia
at `0x754AD90E8bCd7fb645126bB4626643D2a97da2b5`, forwarder
`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`). The `ReceiverTemplate`/`IReceiver`/`IERC165` bases are
vendored from the CRE docs samples (NOT npm). That on-chain write is the prize requirement; target is a
successful `cre workflow simulate . --broadcast --non-interactive --trigger-index 0 --http-payload
http_trigger_payload.json`. Funded key = `CRE_ETH_PRIVATE_KEY` (no 0x) in
`ENSv2_subname_manager/.env`. The backend DNS path is the fallback. `ENSv2_subname_manager/` is
excluded from the Next typecheck (its own toolchain). Live per-user path needs the workflow DEPLOYED
to the DON + `authorizedKeys` set. Then subgroups (EAC).

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
