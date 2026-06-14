import { getSupabase } from "./supabase";

/**
 * Reservations: CSV bulk-import invites. An admin reserves `label.parent` for an `email`; when that
 * person signs in, the reservation is an eligibility path (they may claim it even without a domain
 * match). A reservation can optionally target a SUBGROUP, so a bulk import lands people under, say,
 * `student.org.eth` instead of the org root. Server-only.
 */

export interface Reservation {
  parent: string;
  label: string;
  /** Subgroup label to claim under (e.g. "student"), or null for the org root. */
  subgroup: string | null;
}

export interface ReservationRow extends Reservation {
  email: string;
  claimed: boolean;
}

/** The (unclaimed) reservation for an email, if any. */
export async function getReservation(email: string): Promise<Reservation | null> {
  const { data, error } = await getSupabase()
    .from("reservations")
    .select("parent, label, subgroup")
    .eq("email", email.trim().toLowerCase())
    .eq("claimed", false)
    .limit(1);

  if (error) throw new Error(`reservation lookup failed: ${error.message}`);
  const r = data?.[0];
  return r ? { parent: r.parent, label: r.label, subgroup: r.subgroup ?? null } : null;
}

/** Mark an email's reservation under a parent as claimed (no-op if none). */
export async function markReservationClaimed(parent: string, email: string): Promise<void> {
  await getSupabase()
    .from("reservations")
    .update({ claimed: true })
    .eq("parent", parent)
    .eq("email", email.trim().toLowerCase());
}

/**
 * Bulk-create reservations for a parent (upsert on (parent,email)). Optionally assigns every row to a
 * subgroup. Returns the count written.
 */
export async function createReservations(
  parent: string,
  rows: { email: string; label: string }[],
  subgroup?: string | null,
): Promise<number> {
  if (rows.length === 0) return 0;
  const records = rows.map((r) => ({
    parent,
    email: r.email.trim().toLowerCase(),
    label: r.label,
    subgroup: subgroup ?? null,
    claimed: false,
  }));
  const { data, error } = await getSupabase()
    .from("reservations")
    .upsert(records, { onConflict: "parent,email" })
    .select("email");
  if (error) throw new Error(`import failed: ${error.message}`);
  return data?.length ?? records.length;
}

/** Move a subgroup's pending invites back to the org root (used when a subgroup is deleted). */
export async function resetSubgroupReservations(parent: string, subgroupLabel: string): Promise<void> {
  const { error } = await getSupabase()
    .from("reservations")
    .update({ subgroup: null })
    .eq("parent", parent)
    .eq("subgroup", subgroupLabel.trim().toLowerCase());
  if (error) throw new Error(`failed to reset subgroup invites: ${error.message}`);
}

/** Delete a single invite (reservation) by email under a parent. */
export async function deleteReservation(parent: string, email: string): Promise<void> {
  const { error } = await getSupabase()
    .from("reservations")
    .delete()
    .eq("parent", parent)
    .eq("email", email.trim().toLowerCase());
  if (error) throw new Error(`failed to remove invite: ${error.message}`);
}

/** Delete all UNCLAIMED invites under a parent. Returns the count removed. */
export async function clearUnclaimedReservations(parent: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from("reservations")
    .delete()
    .eq("parent", parent)
    .eq("claimed", false)
    .select("email");
  if (error) throw new Error(`failed to clear invites: ${error.message}`);
  return data?.length ?? 0;
}

/** List reservations under a parent (for the admin's pending-invites view). */
export async function getReservations(parent: string): Promise<ReservationRow[]> {
  const { data, error } = await getSupabase()
    .from("reservations")
    .select("parent, email, label, subgroup, claimed")
    .eq("parent", parent)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`reservations lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    parent: r.parent,
    email: r.email,
    label: r.label,
    subgroup: r.subgroup ?? null,
    claimed: r.claimed,
  }));
}
