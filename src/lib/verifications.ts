import { getSupabase } from "./supabase";

/**
 * Domain verifications: an admin proves control of their email DOMAIN (not just one mailbox) via a
 * DNS-TXT challenge. Keyed by domain so it can happen BEFORE an org exists — verification gates
 * provisioning the org's parent name. Server-only.
 */

export interface DomainVerification {
  token: string | null;
  verifiedAt: string | null;
}

export async function getDomainVerification(domain: string): Promise<DomainVerification | null> {
  const { data, error } = await getSupabase()
    .from("domain_verifications")
    .select("token, verified_at")
    .eq("domain", domain.trim().toLowerCase())
    .limit(1);
  if (error) throw new Error(`verification lookup failed: ${error.message}`);
  const r = data?.[0];
  return r ? { token: r.token, verifiedAt: r.verified_at } : null;
}

export async function isDomainVerified(domain: string): Promise<boolean> {
  const v = await getDomainVerification(domain);
  return !!v?.verifiedAt;
}

export async function setDomainVerifyToken(domain: string, token: string): Promise<void> {
  const { error } = await getSupabase()
    .from("domain_verifications")
    .upsert({ domain: domain.trim().toLowerCase(), token }, { onConflict: "domain" });
  if (error) throw new Error(`failed to set verify token: ${error.message}`);
}

export async function setDomainVerified(domain: string): Promise<void> {
  const { error } = await getSupabase()
    .from("domain_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("domain", domain.trim().toLowerCase());
  if (error) throw new Error(`failed to mark verified: ${error.message}`);
}
