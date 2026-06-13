import { getSupabase } from "./supabase";

/**
 * Enrolled organizations: the map from a verified email *domain* to an ENS parent name, now backed
 * by the Supabase `orgs` table (was a hardcoded array). This is the "email = eligibility" half of
 * the authority model (architecture doc §2) — it grants NO authority over the parent itself.
 *
 * SERVER-ONLY: getOrgByDomain queries Supabase with the secret key, so it must only be called from
 * API routes, never from client components.
 */

export interface EnrolledOrg {
  /** Verified email domain that qualifies a member, e.g. "acme.com". */
  domain: string;
  /** ENS parent the member receives a subname under, e.g. "acme.eth". */
  parent: string;
  /** Deployed UserRegistry subregistry address (null until provisioned). */
  subregistry: string | null;
  /** Issuance policy chosen at enrollment. */
  issuance: "onchain" | "offchain";
  /** Who controls the parent: the platform, or a user/org admin. */
  ownerModel: "platform" | "user";
  /** Address that owns the parent. */
  parentOwner: string | null;
  status: "active" | "pending" | "taken";
}

/**
 * Public email providers. Users on these domains are NOT org members — they belong to the
 * self-serve path (register their own name), never auto-enrolled under a shared "provider org".
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
]);

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/** Look up an enrolled org by verified email domain (case-insensitive). Server-only. */
export async function getOrgByDomain(domain: string): Promise<EnrolledOrg | null> {
  const d = domain.trim().toLowerCase();
  const { data, error } = await getSupabase()
    .from("orgs")
    .select("domain, parent, subregistry, issuance, owner_model, parent_owner, status")
    .eq("domain", d)
    .maybeSingle();

  if (error) throw new Error(`orgs lookup failed: ${error.message}`);
  if (!data) return null;

  return {
    domain: data.domain,
    parent: data.parent,
    subregistry: data.subregistry,
    issuance: data.issuance,
    ownerModel: data.owner_model,
    parentOwner: data.parent_owner,
    status: data.status,
  };
}
