// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// The CRE receiver base. It enforces "only the CRE forwarder may deliver reports" and verifies the
// DON's signatures before calling `_processReport`. Import path comes from the Chainlink CRE contracts
// package (see CRE getting-started part 4) — reconcile the exact path/constructor against the version
// you install when you deploy.
import {ReceiverTemplate} from "@chainlink/contracts-cre/ReceiverTemplate.sol";

/**
 * DomainVerifier — the on-chain authorization target for the CRE domain-verification workflow.
 *
 * The workflow (../my-workflow/main.ts) verifies a domain's DNS-TXT challenge across the DON, reaches
 * consensus, and writes a signed report here. On a verified result we record
 * `verifiedDomain[keccak256(domain)] = true` — the Chainlink prize's on-chain state change. The app
 * can read this to gate admin authority (the decentralized version of /api/admin/verify/check).
 */
contract DomainVerifier is ReceiverTemplate {
    /// keccak256(lowercased domain) => verified
    mapping(bytes32 => bool) public verifiedDomain;

    event DomainVerified(bytes32 indexed domainHash);

    /// @param forwarder The CRE forwarder address (only it may deliver reports).
    constructor(address forwarder) ReceiverTemplate(forwarder) {}

    /// Decodes the DON report and records verification. Called only after signature checks pass.
    function _processReport(bytes calldata report) internal override {
        (bytes32 domainHash, bool isVerified) = abi.decode(report, (bytes32, bool));
        if (isVerified && !verifiedDomain[domainHash]) {
            verifiedDomain[domainHash] = true;
            emit DomainVerified(domainHash);
        }
    }

    /// Convenience: the app computes keccak256(bytes(domain)) the same way the workflow does.
    function isVerified(string calldata domain) external view returns (bool) {
        return verifiedDomain[keccak256(bytes(domain))];
    }
}
