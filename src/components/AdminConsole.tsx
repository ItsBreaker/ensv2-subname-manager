"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { InfoTip } from "./InfoTip";
import styles from "./Manager.module.css";

type Member = { fqdn: string; label: string; owner: string; createdAt: string };
type Invite = { email: string; label: string };
type NameOption = { label: string; fqdn: string; available: boolean };

type AdminState =
  | { phase: "loading" }
  | { phase: "managed"; parent: string; members: Member[]; invites: Invite[] }
  | { phase: "setup" };

type ProvPhase =
  | { phase: "loading" }
  | { phase: "public" }
  | { phase: "suggest"; options: NameOption[] }
  | { phase: "registering"; parent: string; readyAt: number }
  | { phase: "done"; parent: string }
  | { phase: "error"; message: string };

function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * The admin surface. If the signed-in user administers an org, shows its members (issued names) with
 * remove. Otherwise, the org set-up (provisioning) flow — registering a platform-owned parent.
 */
export function AdminConsole() {
  const { getAccessToken } = usePrivy();

  const [admin, setAdmin] = useState<AdminState>({ phase: "loading" });
  const [removing, setRemoving] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const [prov, setProv] = useState<ProvPhase>({ phase: "loading" });
  const [now, setNow] = useState<number>(() => Date.now());
  const finishingRef = useRef(false);

  const loadAdmin = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/org", { headers: { authorization: `Bearer ${token}` } });
      const data = (await res.json()) as {
        ok?: boolean;
        org?: { parent: string } | null;
        members?: Member[];
        invites?: Invite[];
      };
      if (res.ok && data.ok && data.org) {
        setAdmin({
          phase: "managed",
          parent: data.org.parent,
          members: data.members ?? [],
          invites: data.invites ?? [],
        });
      } else {
        setAdmin({ phase: "setup" });
      }
    } catch {
      setAdmin({ phase: "setup" });
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  // When setting up (no managed org), load name suggestions / resume an in-flight registration.
  useEffect(() => {
    if (admin.phase !== "setup") return;
    let cancelled = false;
    setProv({ phase: "loading" });
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/provision", { headers: { authorization: `Bearer ${token}` } });
        const data = (await res.json()) as {
          kind?: string;
          parent?: string;
          readyAt?: string | null;
          options?: NameOption[];
        };
        if (cancelled) return;
        if (data.kind === "pending" && data.parent) {
          setProv({
            phase: "registering",
            parent: data.parent,
            readyAt: data.readyAt ? new Date(data.readyAt).getTime() : Date.now(),
          });
        } else if (data.kind === "public") {
          setProv({ phase: "public" });
        } else if (data.kind === "unprovisioned") {
          setProv({ phase: "suggest", options: data.options ?? [] });
        } else {
          setProv({ phase: "suggest", options: [] });
        }
      } catch {
        if (!cancelled) setProv({ phase: "suggest", options: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [admin.phase, getAccessToken]);

  useEffect(() => {
    if (prov.phase !== "registering") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [prov.phase]);

  useEffect(() => {
    if (prov.phase !== "registering") {
      finishingRef.current = false;
      return;
    }
    if (now < prov.readyAt || finishingRef.current) return;
    finishingRef.current = true;
    const parent = prov.parent;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/provision/finish", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (res.ok && data.ok) {
          setProv({ phase: "done", parent });
          await loadAdmin();
        } else {
          setProv({ phase: "error", message: data.error ?? "Registration failed." });
        }
      } catch (e) {
        setProv({ phase: "error", message: e instanceof Error ? e.message : "Registration failed." });
      }
    })();
  }, [prov, now, getAccessToken, loadAdmin]);

  const handleProvision = useCallback(
    async (label: string) => {
      setProv({ phase: "loading" });
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/provision/start", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ label }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; parent?: string; readyAt?: string };
        if (res.ok && data.ok && data.parent) {
          setProv({
            phase: "registering",
            parent: data.parent,
            readyAt: data.readyAt ? new Date(data.readyAt).getTime() : Date.now() + 65_000,
          });
          setNow(Date.now());
        } else {
          setProv({ phase: "error", message: data.error ?? "Couldn't start provisioning." });
        }
      } catch (e) {
        setProv({ phase: "error", message: e instanceof Error ? e.message : "Couldn't start provisioning." });
      }
    },
    [getAccessToken],
  );

  const handleImport = useCallback(
    async (file: File) => {
      setImportMsg(null);
      setImporting(true);
      try {
        const text = await file.text();
        const rows: { email: string; label?: string }[] = [];
        for (const line of text.split(/\r?\n/)) {
          const cells = line.split(",").map((c) => c.trim());
          const email = cells[0] ?? "";
          if (!email.includes("@")) continue; // skip header rows / blanks
          rows.push({ email, label: cells[1] || undefined });
        }
        if (rows.length === 0) {
          setImportMsg("No emails found in that file.");
          return;
        }
        const token = await getAccessToken();
        const res = await fetch("/api/admin/import", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ rows }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; count?: number };
        if (res.ok && data.ok) {
          setImportMsg(`Imported ${data.count} invite(s).`);
          await loadAdmin();
        } else {
          setImportMsg(data.error ?? "Import failed.");
        }
      } catch (e) {
        setImportMsg(e instanceof Error ? e.message : "Import failed.");
      } finally {
        setImporting(false);
      }
    },
    [getAccessToken, loadAdmin],
  );

  const handleRemove = useCallback(
    async (fqdn: string) => {
      setRemoving(fqdn);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/admin/remove", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ fqdn }),
        });
        const data = (await res.json()) as { ok?: boolean };
        if (res.ok && data.ok) await loadAdmin();
      } finally {
        setRemoving(null);
      }
    },
    [getAccessToken, loadAdmin],
  );

  if (admin.phase === "loading") {
    return (
      <section className={styles.card}>
        <p className={styles.cardText} style={{ margin: 0 }}>
          Loading your organization…
        </p>
      </section>
    );
  }

  if (admin.phase === "managed") {
    return (
      <section className={styles.card}>
        <div className={styles.cardLabel}>
          Members of {admin.parent}
          <InfoTip>
            Everyone who has claimed a name under your organization. Removing revokes their name
            on-chain (it no longer resolves) and takes them off this list.
          </InfoTip>
        </div>

        {admin.members.length === 0 ? (
          <p className={styles.cardText} style={{ margin: 0 }}>
            No members yet. Share your organization name so people can claim a name under it.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {admin.members.map((m) => (
              <li
                key={m.fqdn}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                  borderTop: "1px solid var(--line, #2a2f3d)",
                }}
              >
                <span>
                  <span className={styles.mono}>{m.fqdn}</span>
                  <span style={{ color: "var(--muted, #9aa3b5)", fontSize: 12, marginLeft: 8 }}>
                    {shortAddress(m.owner)}
                  </span>
                </span>
                <button
                  className={styles.ghostButton}
                  onClick={() => handleRemove(m.fqdn)}
                  disabled={removing === m.fqdn}
                >
                  {removing === m.fqdn ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div style={{ borderTop: "1px solid var(--line, #e6e8eb)", marginTop: 16, paddingTop: 14 }}>
          <div className={styles.cardLabel}>
            Invite members (CSV)
            <InfoTip>
              Upload a CSV with one email per row (optionally email,label). Each becomes a reserved
              name your members can claim when they sign in.
            </InfoTip>
          </div>

          {admin.invites.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
              {admin.invites.map((i) => (
                <li
                  key={i.email}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "7px 0",
                    borderTop: "1px solid var(--line, #e6e8eb)",
                    fontSize: 13,
                  }}
                >
                  <span className={styles.mono}>
                    {i.label}.{admin.parent}
                  </span>
                  <span style={{ color: "var(--muted, #6b7280)" }}>{i.email} · invited</span>
                </li>
              ))}
            </ul>
          )}

          <label className={styles.ghostButton} style={{ display: "inline-block" }}>
            {importing ? "Importing…" : "Upload CSV"}
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{ display: "none" }}
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImport(file);
                e.target.value = "";
              }}
            />
          </label>
          {importMsg && (
            <span style={{ marginLeft: 10, fontSize: 13, color: "var(--muted, #6b7280)" }}>
              {importMsg}
            </span>
          )}
        </div>
      </section>
    );
  }

  // Set up an org (no managed org yet).
  return (
    <section className={styles.card}>
      <div className={styles.cardLabel}>Set up your organization</div>

      {prov.phase === "loading" && (
        <p className={styles.cardText} style={{ margin: 0 }}>
          Checking available names…
        </p>
      )}

      {prov.phase === "public" && (
        <p className={styles.cardText} style={{ margin: 0 }}>
          You&apos;re signed in with a personal email, so there&apos;s no organization domain to set
          up. Organizations are created from a company email domain.
        </p>
      )}

      {prov.phase === "suggest" && (
        <>
          <p className={styles.cardText}>
            Pick a name to register for your organization:
            <InfoTip>
              We turn your email domain into a name (acme.com becomes acme.eth). If it&apos;s taken,
              choose an available alternative. Registering takes about a minute.
            </InfoTip>
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {prov.options.map((o) => (
              <li
                key={o.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "9px 0",
                  borderTop: "1px solid var(--line, #2a2f3d)",
                }}
              >
                <span className={styles.mono}>{o.fqdn}</span>
                {o.available ? (
                  <button className={styles.primaryButton} onClick={() => handleProvision(o.label)}>
                    Register
                  </button>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--muted, #9aa3b5)" }}>taken</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {prov.phase === "registering" && (
        <p className={styles.cardText} style={{ margin: 0 }}>
          Registering <strong>{prov.parent}</strong> for your organization…{" "}
          {now < prov.readyAt
            ? `~${Math.max(0, Math.ceil((prov.readyAt - now) / 1000))}s`
            : "finalizing…"}
          <br />
          <span style={{ color: "var(--muted, #9aa3b5)", fontSize: 13 }}>
            This is a one-time on-chain registration (commit then reveal). Keep this tab open.
          </span>
        </p>
      )}

      {prov.phase === "done" && (
        <p className={styles.cardText} style={{ margin: 0 }}>
          Registered <strong>{prov.parent}</strong>. Loading…
        </p>
      )}

      {prov.phase === "error" && (
        <p className={styles.notice}>
          Provisioning failed:
          <br />
          <span className={styles.mono}>{prov.message}</span>
        </p>
      )}
    </section>
  );
}

export default AdminConsole;
