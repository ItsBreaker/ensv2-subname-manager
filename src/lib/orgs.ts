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

/**
 * Look up an ACTIVE enrolled org by verified email domain (case-insensitive). Server-only.
 * Pending (mid-provisioning) orgs are excluded — a name isn't usable until registration completes.
 */
export async function getOrgByDomain(domain: string): Promise<EnrolledOrg | null> {
  const d = domain.trim().toLowerCase();
  const { data, error } = await getSupabase()
    .from("orgs")
    .select("domain, parent, subregistry, issuance, owner_model, parent_owner, status")
    .eq("domain", d)
    .eq("status", "active")
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

/** Normalize a user-typed org name to a parent ENS name: "democlub" / "Democlub.eth " -> "democlub.eth". */
export function normalizeParentName(input: string): string {
  const p = input.trim().toLowerCase().replace(/[^a-z0-9.-]/g, "");
  if (!p) return "";
  return p.includes(".") ? p : `${p}.eth`;
}

/**
 * Look up an org by parent name that has opted into OPEN enrollment (anyone may claim under it,
 * regardless of email domain). Used for the public-email "type your org's name" path. Server-only.
 */
export async function getOpenOrgByParent(parent: string): Promise<EnrolledOrg | null> {
  const p = parent.trim().toLowerCase();
  const { data, error } = await getSupabase()
    .from("orgs")
    .select("domain, parent, subregistry, issuance, owner_model, parent_owner, status")
    .eq("parent", p)
    .eq("open_enrollment", true)
    .eq("status", "active")
    .limit(1);

  if (error) throw new Error(`open org lookup failed: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return {
    domain: row.domain,
    parent: row.parent,
    subregistry: row.subregistry,
    issuance: row.issuance,
    ownerModel: row.owner_model,
    parentOwner: row.parent_owner,
    status: row.status,
  };
}

/** The org a user administers (bootstrap: matched by admin_email). Server-only. */
export async function getAdminOrg(email: string): Promise<EnrolledOrg | null> {
  const e = email.trim().toLowerCase();
  const { data, error } = await getSupabase()
    .from("orgs")
    .select("domain, parent, subregistry, issuance, owner_model, parent_owner, status")
    .eq("admin_email", e)
    .eq("status", "active")
    .limit(1);

  if (error) throw new Error(`admin org lookup failed: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return {
    domain: row.domain,
    parent: row.parent,
    subregistry: row.subregistry,
    issuance: row.issuance,
    ownerModel: row.owner_model,
    parentOwner: row.parent_owner,
    status: row.status,
  };
}

export interface Member {
  fqdn: string;
  label: string;
  owner: string;
  createdAt: string;
}

/** List the issued subnames under a parent (the org's members). Server-only. */
export async function getMembers(parent: string): Promise<Member[]> {
  const { data, error } = await getSupabase()
    .from("subnames")
    .select("fqdn, label, owner, created_at")
    .eq("parent", parent)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`members lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    fqdn: r.fqdn,
    label: r.label,
    owner: r.owner,
    createdAt: r.created_at,
  }));
}

/** Look up an active org by parent name (any enrollment policy) — used by the reservation path. */
export async function getActiveOrgByParent(parent: string): Promise<EnrolledOrg | null> {
  const p = parent.trim().toLowerCase();
  const { data, error } = await getSupabase()
    .from("orgs")
    .select("domain, parent, subregistry, issuance, owner_model, parent_owner, status")
    .eq("parent", p)
    .eq("status", "active")
    .limit(1);

  if (error) throw new Error(`org lookup failed: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return {
    domain: row.domain,
    parent: row.parent,
    subregistry: row.subregistry,
    issuance: row.issuance,
    ownerModel: row.owner_model,
    parentOwner: row.parent_owner,
    status: row.status,
  };
}

export interface ProvisioningRow {
  domain: string;
  parent: string;
  status: "active" | "pending" | "taken";
  commitSecret: string | null;
  readyAt: string | null;
}

/** Read the raw org row (any status) for provisioning — includes the commit secret + ready time. */
export async function getProvisioning(domain: string): Promise<ProvisioningRow | null> {
  const d = domain.trim().toLowerCase();
  const { data, error } = await getSupabase()
    .from("orgs")
    .select("domain, parent, status, commit_secret, ready_at")
    .eq("domain", d)
    .maybeSingle();

  if (error) throw new Error(`provisioning lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    domain: data.domain,
    parent: data.parent,
    status: data.status,
    commitSecret: data.commit_secret,
    readyAt: data.ready_at,
  };
}
