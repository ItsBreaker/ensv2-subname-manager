# CRE: verifiable domain-authority gate (prize layer)

The decentralized, on-chain version of our backend DNS check (`/api/admin/verify/*`). A Chainlink CRE
workflow verifies a domain's DNS-TXT challenge **across the DON**, reaches consensus, and writes the
result **on-chain** — so no single party (not even us) is the trusted verifier. That on-chain write is
the Chainlink prize requirement; the backend DNS path stays as the fallback.

It's **dynamic — any caller, any domain.** The workflow is **HTTP-triggered**: the `{domain, token}`
arrive in the request body at call-time, never hardcoded in config. The contract is keyed by
`keccak256(domain)`, so a single deployment verifies every domain.

- `my-workflow/main.ts` — the workflow: reads `{domain, token}` from the HTTP trigger payload
  (`decodeJson(payload.input)`), each node fetches the domain's TXT via DNS-over-HTTPS
  (`https://dns.google/resolve`), checks for `ens-subname-verify=<token>`, consensus
  (`consensusIdenticalAggregation`), then `runtime.report()` → `EVMClient.writeReport()`.
  **Typechecks against `@chainlink/cre-sdk@1.11.0`.**
- `my-workflow/config/config.staging.json` — only the chain target (`evms[0].verifierAddress`) and an
  optional `authorizedKeys` allowlist (the backend signer's EVM address; empty for simulation). **No
  domain lives here.**
- `my-workflow/http_trigger_payload.json` — sample trigger body for local simulation; set a domain you
  control + its token.
- `contracts/` — the consumer contract `DomainVerifier.sol` (`_processReport` sets
  `verifiedDomain[keccak256(domain)] = true`) plus the CRE base files vendored from the docs samples
  (`ReceiverTemplate.sol`, `IReceiver.sol`, `IERC165.sol` — these are NOT npm packages). Only
  `@openzeppelin/contracts` is a real dependency.

## Step 1 — deploy DomainVerifier.sol to Sepolia (Remix, no local toolchain)

1. Open [Remix](https://remix.ethereum.org), create a folder, and add all four `contracts/*.sol`
   files (drag them in). Remix auto-resolves the `@openzeppelin/contracts` import.
2. Compile `DomainVerifier.sol` (Solidity 0.8.24+).
3. Deploy & Run → Injected Provider (MetaMask on **Sepolia**) → select `DomainVerifier` → constructor
   arg `_forwarder` = the Sepolia CRE forwarder **`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`**
   (re-check the [Forwarder Directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts)).
4. Deploy and copy the deployed address.

## Step 2 — wire config + key

- `config.staging.json` already points at the deployed `verifierAddress`. No domain to set here.
- Create `my-workflow/.env` (gitignored) with `CRE_ETH_PRIVATE_KEY=<64-hex, no 0x>` — a Sepolia-funded
  key that pays gas for the broadcast.
- For local simulation, put a domain you control + its `token` into `http_trigger_payload.json`, and
  add the `ens-subname-verify=<token>` TXT record to that domain's DNS.

## Step 3 — run the simulation (the prize target)

Run from the **project root** (`ENSv2_subname_manager/`, where `project.yaml` is) — the workflow folder
arg resolves relative to it. Needs native **Bun** on PATH (`bun.exe`, not the npm `.cmd` shim) for the
WASM compile. `--http-payload` takes the JSON **inline**, not a file path:

```bash
cre login
cre workflow simulate my-workflow --target staging-settings --broadcast \
  --non-interactive --trigger-index 0 \
  --http-payload '{"domain":"your-domain","token":"your-token"}'
```

(Or omit `--non-interactive`/`--http-payload` and paste the JSON when prompted.) A successful run reads the payload → fetches
the TXT across nodes → consensus → broadcasts the report to the forwarder, which calls
`DomainVerifier.onReport` → flips `verifiedDomain` true on Sepolia. Without `--broadcast` it's a dry
run (no on-chain tx).

## Step 4 — invoking the DEPLOYED workflow from the app

For the live, per-user path the workflow must be **deployed to the CRE DON** (often done with the
Chainlink team at the event). Then:

1. Set `authorizedKeys` in `config.staging.json` to the backend signer's EVM address
   (`{ "type": "KEY_TYPE_ECDSA_EVM", "publicKey": "0x..." }`).
2. The backend POSTs `{domain, token}` to the workflow's gateway endpoint, authenticated with an
   ETH-signed JWT (or via the `cre-http-trigger` proxy package, which handles signing). Wire this into
   `/api/admin/verify` so "Verify with CRE" calls the DON instead of the local DNS check.

## Mapping to the app

`isDomainVerified()` (`src/lib/verifications.ts`) could additionally read
`DomainVerifier.isVerified(domain)` on-chain, so the app trusts the CRE-verified result directly.

> CRE's SDK is new — the workflow compiles against 1.11.0; reconcile the `ReceiverTemplate` import and
> the simulate/gateway specifics against your installed versions.
