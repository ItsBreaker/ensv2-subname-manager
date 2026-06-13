/**
 * Pre-enrolled organizations: the map from a verified email *domain* to an ENS parent
 * name. This is the "email = eligibility" half of the authority model (architecture doc §2):
 * a member whose verified email domain matches an enrolled org may receive a subname under
 * that org's parent. It deliberately grants NO authority over the parent itself.
 *
 * Phase 1 uses a static list (one demo org). Later this becomes the output of the org
 * enrollment flow (§5), backed by real storage.
 */

export interface EnrolledOrg {
  /** Verified email domain that qualifies a member, e.g. "democlub.com". */
  domain: string;
  /** ENS parent the member receives a subname under, e.g. "democlub.eth". */
  parent: string;
  /** Issuance policy chosen at enrollment (golden path = offchain). */
  issuance: "offchain" | "onchain";
}

/**
 * Demo enrollment. `democlub.eth` is registered on Sepolia (see scripts/register-parent.ts).
 *
 * To try the golden path with your own login, add your email's domain here — e.g. for
 * testing with a gmail address, temporarily add `{ domain: "gmail.com", parent: "democlub.eth",
 * issuance: "offchain" }`. (In production an org would never enroll a public domain like gmail.)
 */
export const ENROLLED_ORGS: EnrolledOrg[] = [
  { domain: "democlub.com", parent: "democlub.eth", issuance: "offchain" },
];

/** Look up an enrolled org by verified email domain (case-insensitive). */
export function findOrgByDomain(domain: string): EnrolledOrg | undefined {
  const d = domain.trim().toLowerCase();
  return ENROLLED_ORGS.find((o) => o.domain.toLowerCase() === d);
}
