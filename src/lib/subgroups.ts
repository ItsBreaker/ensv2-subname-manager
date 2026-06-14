import { getSupabase } from "./supabase";

/**
 * Subgroups index: named sub-namespaces (eng.acme.eth) under an org parent, each backed by its own
 * on-chain UserRegistry. This table mirrors on-chain state for UX (listing, member-claim routing) —
 * the registry address + manager are derivable on-chain, but cached here to avoid extra reads.
 * Server-only (secret key).
 */

export interface Subgroup {
  fqdn: string; // eng.acme.eth
  parent: string; // acme.eth
  label: string; // eng
  childRegistry: string; // 0x...
  manager: string | null; // delegated manager wallet
  createdAt: string;
}

/** List the subgroups under a parent. Server-only. */
export async function getSubgroups(parent: string): Promise<Subgroup[]> {
  const { data, error } = await getSupabase()
    .from("subgroups")
    .select("fqdn, parent, label, child_registry, manager, created_at")
    .eq("parent", parent.trim().toLowerCase())
    .order("created_at", { ascending: true });

  if (error) throw new Error(`subgroups lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    fqdn: r.fqdn,
    parent: r.parent,
    label: r.label,
    childRegistry: r.child_registry,
    manager: r.manager,
    createdAt: r.created_at,
  }));
}

/** Look up a single subgroup by its fqdn (eng.acme.eth). Server-only. */
export async function getSubgroup(fqdn: string): Promise<Subgroup | null> {
  const { data, error } = await getSupabase()
    .from("subgroups")
    .select("fqdn, parent, label, child_registry, manager, created_at")
    .eq("fqdn", fqdn.trim().toLowerCase())
    .maybeSingle();

  if (error) throw new Error(`subgroup lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    fqdn: data.fqdn,
    parent: data.parent,
    label: data.label,
    childRegistry: data.child_registry,
    manager: data.manager,
    createdAt: data.created_at,
  };
}

/** Upsert a subgroup row (idempotent on fqdn). Server-only. */
export async function upsertSubgroup(args: {
  fqdn: string;
  parent: string;
  label: string;
  childRegistry: string;
  manager?: string | null;
  adminEmail?: string | null;
}): Promise<void> {
  const { error } = await getSupabase()
    .from("subgroups")
    .upsert(
      {
        fqdn: args.fqdn.trim().toLowerCase(),
        parent: args.parent.trim().toLowerCase(),
        label: args.label.trim().toLowerCase(),
        child_registry: args.childRegistry,
        manager: args.manager ?? null,
        admin_email: args.adminEmail?.trim().toLowerCase() ?? null,
      },
      { onConflict: "fqdn" },
    );
  if (error) throw new Error(`failed to save subgroup: ${error.message}`);
}
