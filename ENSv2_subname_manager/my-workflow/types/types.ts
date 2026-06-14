export type EvmConfig = {
  /** Deployed DomainVerifier contract address. */
  verifierAddress: `0x${string}`;
  /** CRE chain selector name, e.g. "ethereum-testnet-sepolia". */
  chainName: string;
  gasLimit: string;
};

/**
 * An EVM address allowed to invoke the DEPLOYED HTTP-triggered workflow. `publicKey` is the EVM
 * address derived from the backend signer's key (CRE's HTTP trigger uses ECDSA/EVM auth). Leave the
 * list empty for `cre workflow simulate`.
 */
export type AuthorizedKeyConfig = {
  type: "KEY_TYPE_ECDSA_EVM";
  publicKey: `0x${string}`;
};

export type Config = {
  /** Target chain(s); the DomainVerifier lives on evms[0]. */
  evms: EvmConfig[];
  /** Optional allowlist of callers for the deployed workflow. Empty in simulation. */
  authorizedKeys?: AuthorizedKeyConfig[];
};
