export type EvmConfig = {
  /** Deployed DomainVerifier contract address. */
  verifierAddress: `0x${string}`;
  /** CRE chain selector name, e.g. "ethereum-testnet-sepolia". */
  chainName: string;
  gasLimit: string;
};

export type Config = {
  /** Cron schedule, e.g. "* /30 * * * * *" (no space — shown spaced to avoid closing this comment). */
  schedule: string;
  /** Domain to verify, e.g. "acme.com". */
  domain: string;
  /** Challenge token from /api/admin/verify/start. */
  token: string;
  evms: EvmConfig[];
};
