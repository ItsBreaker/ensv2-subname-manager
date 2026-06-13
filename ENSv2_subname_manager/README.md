# CRE: verifiable domain-authority gate (prize layer)

The decentralized, on-chain version of our backend DNS check (`/api/admin/verify/*`). A Chainlink CRE
workflow verifies a domain's DNS-TXT challenge **across the DON**, reaches consensus, and writes the
result **on-chain** — so no single party (not even us) is the trusted verifier. That on-chain write is
the Chainlink prize requirement; the backend DNS path stays as the fallback.

- `my-workflow/main.ts` — the workflow: each node fetches the domain's TXT via DNS-over-HTTPS
  (`https://dns.google/resolve`), checks for `ens-subname-verify=<token>`, consensus
  (`consensusIdenticalAggregation`), then `runtime.report()` → `EVMClient.writeReport()`.
  **Typechecks against `@chainlink/cre-sdk@1.11.0`.**
- `my-workflow/config/config.staging.json` — set `domain`, `token` (from `/api/admin/verify/start`),
  and the deployed `verifierAddress`.
- `contracts/DomainVerifier.sol` — the `ReceiverTemplate` receiver; `_processReport` sets
  `verifiedDomain[keccak256(domain)] = true`.

## Run the simulation (the prize target)

```bash
cre login
cd my-workflow && bun install        # deps already installed; viem added
# Deploy contracts/DomainVerifier.sol to Sepolia (Foundry/Hardhat); put its address + the CRE
# forwarder address into config + the contract, and a private key in ../.env
cre workflow simulate my-workflow --target staging-settings --broadcast
```

A successful run fetches the TXT across nodes → consensus → broadcasts the report that flips
`verifiedDomain` true on Sepolia. The Chainlink team deploys it for you at the event.

## Mapping to the app

`isDomainVerified()` (`src/lib/verifications.ts`) could additionally read
`DomainVerifier.isVerified(domain)` on-chain, so the app trusts the CRE-verified result directly.

> CRE's SDK is new — the workflow compiles against 1.11.0, but reconcile the `ReceiverTemplate` import
> and the simulate output against your installed versions.
