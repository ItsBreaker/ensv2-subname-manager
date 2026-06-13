import { getSupabase } from "./supabase";

/**
 * Reservations: CSV bulk-import invites. An admin reserves `label.parent` for an `email`; when that
 * person signs in, the reservation is an eligibility path (they may claim it even without a domain
 * match). Server-only.
 */

export interface Reservation {
  parent: string;
  label: string;
}

export interface ReservationRow extends Reservation {
  email: string;
  claimed: boolean;
}

/** The (unclaimed) reservation for an email, if any. */
export async function getReservation(email: string): Promise<Reservation | null> {
  const { data, error } = await getSupabase()
    .from("reservations")
    .select("parent, label")
    .eq("email", email.trim().toLowerCase())
    .eq("claimed", false)
    .limit(1);

  if (error) throw new Error(`reservation lookup failed: ${error.message}`);
  const r = data?.[0];
  return r ? { parent: r.parent, label: r.label } : null;
}

/** Mark an email's reservation under a parent as claimed (no-op if none). */
export async function markReservationClaimed(parent: string, email: string): Promise<void> {
  await getSupabase()
    .from("reservations")
    .update({ claimed: true })
    .eq("parent", parent)
    .eq("email", email.trim().toLowerCase());
}

/** Bulk-create reservations for a parent (upsert on (parent,email)). Returns the count written. */
export async function createReservations(
  parent: string,
  rows: { email: string; label: string }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const records = rows.map((r) => ({
    parent,
    email: r.email.trim().toLowerCase(),
    label: r.label,
    claimed: false,
  }));
  const { data, error } = await getSupabase()
    .from("reservations")
    .upsert(records, { onConflict: "parent,email" })
    .select("email");
  if (error) throw new Error(`import failed: ${error.message}`);
  return data?.length ?? records.length;
}

/** List reservations under a parent (for the admin's pending-invites view). */
export async function getReservations(parent: string): Promise<ReservationRow[]> {
  const { data, error } = await getSupabase()
    .from("reservations")
    .select("parent, email, label, claimed")
    .eq("parent", parent)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`reservations lookup failed: ${error.message}`);
  return (data ?? []).map((r) => ({ parent: r.parent, email: r.email, label: r.label, claimed: r.claimed }));
}
