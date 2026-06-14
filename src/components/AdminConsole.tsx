"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { AdoptParent } from "./AdoptParent";
import { InfoTip } from "./InfoTip";
import { EnsName, GrowthChart, WalletAddress } from "./ui";
import styles from "./Manager.module.css";

type Member = { fqdn: string; label: string; owner: string; createdAt: string };
type Invite = { email: string; label: string; subgroup?: string | null };
type NameOption = { label: string; fqdn: string; available: boolean };
type Subgroup = { fqdn: string; label: string; childRegistry: string; manager: string | null };

type AdminState =
  | { phase: "loading" }
  | {
      phase: "managed";
      parent: string;
      members: Member[];
      invites: Invite[];
      domain: string | null;
      verified: boolean;
    }
  | { phase: "setup" };

type ProvPhase =
  | { phase: "loading" }
  | { phase: "public" }
  | { phase: "unverified"; domain: string }
  | { phase: "suggest"; options: NameOption[] }
  | { phase: "registering"; parent: string; readyAt: number }
  | { phase: "done"; parent: string }
  | { phase: "error"; message: string };

type VerifyFlow =
  | { status: "idle" }
  | { status: "record"; value: string; domain: string }
  | { status: "checking"; value: string; domain: string };

/**
 * The admin surface. Manages an org (members, invites, CSV import, verified badge) if one exists,
 * otherwise the set-up flow: prove domain control (DNS-TXT) -> register the org's parent name.
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

  const [verify, setVerify] = useState<VerifyFlow>({ status: "idle" });
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [sgLabel, setSgLabel] = useState("");
  const [sgManager, setSgManager] = useState("");
  const [sgStatus, setSgStatus] = useState<"idle" | "creating">("idle");
  const [sgMsg, setSgMsg] = useState<string | null>(null);
  const [importSubgroup, setImportSubgroup] = useState(""); // "" = org root; else a subgroup label

  const loadAdmin = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/org", { headers: { authorization: `Bearer ${token}` } });
      const data = (await res.json()) as {
        ok?: boolean;
        org?: { parent: string } | null;
        members?: Member[];
        invites?: Invite[];
        verification?: { domain: string | null; verified: boolean };
      };
      if (res.ok && data.ok && data.org) {
        setAdmin({
          phase: "managed",
          parent: data.org.parent,
          members: data.members ?? [],
          invites: data.invites ?? [],
          domain: data.verification?.domain ?? null,
          verified: !!data.verification?.verified,
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

  const loadSubgroups = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/subgroup", { headers: { authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { ok?: boolean; subgroups?: Subgroup[] };
      if (res.ok && data.ok) setSubgroups(data.subgroups ?? []);
    } catch {
      /* non-fatal: subgroups are an optional admin tool */
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (admin.phase === "managed") void loadSubgroups();
  }, [admin.phase, loadSubgroups]);

  const handleCreateSubgroup = useCallback(async () => {
    const label = sgLabel.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!label) {
      setSgMsg("Enter a subgroup name (letters, numbers, hyphens).");
      return;
    }
    setSgStatus("creating");
    setSgMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/subgroup", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ label, ...(sgManager.trim() ? { manager: sgManager.trim() } : {}) }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; subgroup?: { fqdn: string } };
      if (res.ok && data.ok) {
        setSgMsg(`Created ${data.subgroup?.fqdn}.`);
        setSgLabel("");
        setSgManager("");
        await loadSubgroups();
      } else {
        setSgMsg(data.error ?? "Couldn't create the subgroup.");
      }
    } catch (e) {
      setSgMsg(e instanceof Error ? e.message : "Couldn't create the subgroup.");
    } finally {
      setSgStatus("idle");
    }
  }, [sgLabel, sgManager, getAccessToken, loadSubgroups]);

  const loadProvision = useCallback(async () => {
    setProv({ phase: "loading" });
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/provision", { headers: { authorization: `Bearer ${token}` } });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        kind?: string;
        domain?: string;
        parent?: string;
        readyAt?: string | null;
        options?: NameOption[];
      };
      // Surface server errors instead of silently showing an empty name list.
      if (!res.ok || data.ok === false) {
        setProv({ phase: "error", message: data.error ?? `Couldn't load provisioning (${res.status}).` });
        return;
      }
      if (data.kind === "pending" && data.parent) {
        setProv({
          phase: "registering",
          parent: data.parent,
          readyAt: data.readyAt ? new Date(data.readyAt).getTime() : Date.now(),
        });
      } else if (data.kind === "public") {
        setProv({ phase: "public" });
      } else if (data.kind === "unverified") {
        setProv({ phase: "unverified", domain: data.domain ?? "" });
      } else if (data.kind === "unprovisioned") {
        setProv({ phase: "suggest", options: data.options ?? [] });
      } else {
        setProv({ phase: "error", message: `Unexpected response: ${JSON.stringify(data)}` });
      }
    } catch (e) {
      setProv({ phase: "error", message: e instanceof Error ? e.message : "Network error loading provisioning." });
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (admin.phase === "setup") void loadProvision();
  }, [admin.phase, loadProvision]);

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

  const handleVerifyStart = useCallback(async () => {
    setVerifyMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/verify/start", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; value?: string; domain?: string };
      if (res.ok && data.ok && data.value && data.domain) {
        setVerify({ status: "record", value: data.value, domain: data.domain });
      } else {
        setVerifyMsg(data.error ?? "Couldn't start verification.");
      }
    } catch (e) {
      setVerifyMsg(e instanceof Error ? e.message : "Couldn't start verification.");
    }
  }, [getAccessToken]);

  const handleVerifyCheck = useCallback(async () => {
    if (verify.status !== "record") return;
    setVerifyMsg(null);
    setVerify({ status: "checking", value: verify.value, domain: verify.domain });
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/admin/verify/check", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { ok?: boolean; verified?: boolean; error?: string };
      if (res.ok && data.ok && data.verified) {
        setVerify({ status: "idle" });
        // Refresh both flows: the set-up flow advances to provisioning, and the managed view's
        // verified badge flips (for orgs that pre-date the verification gate).
        await Promise.all([loadProvision(), loadAdmin()]);
      } else {
        setVerifyMsg(data.error ?? "TXT record not found yet. DNS can take a few minutes. Try again shortly.");
        setVerify({ status: "record", value: verify.value, domain: verify.domain });
      }
    } catch (e) {
      setVerifyMsg(e instanceof Error ? e.message : "Check failed.");
      setVerify({ status: "record", value: verify.value, domain: verify.domain });
    }
  }, [verify, getAccessToken, loadProvision, loadAdmin]);

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
          if (!email.includes("@")) continue;
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
          body: JSON.stringify({ rows, ...(importSubgroup ? { subgroup: importSubgroup } : {}) }),
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
    [getAccessToken, loadAdmin, importSubgroup],
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
        <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--line, #e6e8eb)" }}>
          {admin.verified ? (
            <span style={{ color: "var(--accent2, #16a34a)", fontSize: 13, fontWeight: 600 }}>
              Domain verified{admin.domain ? ` (${admin.domain})` : ""}
            </span>
          ) : (
            <span style={{ color: "var(--muted, #6b7280)", fontSize: 13 }}>
              Domain not verified{admin.domain ? ` (${admin.domain})` : ""}
            </span>
          )}
        </div>

        {!admin.verified && (
          <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--line, #e6e8eb)" }}>
            {verify.status === "idle" ? (
              <>
                <p className={styles.cardText} style={{ margin: "0 0 8px" }}>
                  Prove you control <strong>{admin.domain}</strong> to verify this organization.
                  <InfoTip>
                    Add a DNS TXT record to your domain. Controlling the domain (not just one mailbox)
                    is what authorizes you to manage the org&apos;s name. Required to provision a name
                    and to pass the on-chain CRE check.
                  </InfoTip>
                </p>
                <button className={styles.primaryButton} onClick={handleVerifyStart}>
                  Verify domain
                </button>
              </>
            ) : (
              <>
                <p className={styles.cardText} style={{ margin: "0 0 8px" }}>
                  Add this <strong>TXT</strong> record to <strong>{verify.domain}</strong>, then check:
                </p>
                <p
                  className={styles.mono}
                  style={{ margin: "0 0 10px", padding: "8px 10px", background: "#f1f3f5", borderRadius: 8, wordBreak: "break-all" }}
                >
                  {verify.value}
                </p>
                <button
                  className={styles.primaryButton}
                  onClick={handleVerifyCheck}
                  disabled={verify.status === "checking"}
                >
                  {verify.status === "checking" ? "Checking…" : "Check verification"}
                </button>
              </>
            )}
            {verifyMsg && (
              <p className={styles.cardText} style={{ margin: "8px 0 0", color: "var(--muted, #6b7280)", fontSize: 13 }}>
                {verifyMsg}
              </p>
            )}
          </div>
        )}

        <p className={styles.cardText} style={{ marginTop: 0 }}>
          Thank you for setting up <strong>{admin.parent}</strong> as your organization.
          <InfoTip>
            You control this org&apos;s ENS name. Members claim real subnames under it that resolve to
            their wallets; you can group them, invite by CSV, and revoke names on-chain at any time.
          </InfoTip>
        </p>

        <div className={styles.cardLabel}>
          Members joining
          <InfoTip>Total members over time, from when each person claimed their name.</InfoTip>
        </div>
        <div style={{ marginBottom: 18 }}>
          <GrowthChart dates={admin.members.map((m) => m.createdAt)} />
        </div>

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
                  borderTop: "1px solid var(--line, #e6e8eb)",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <EnsName name={m.fqdn} />
                  <WalletAddress address={m.owner} style={{ fontSize: 11, color: "var(--muted)" }} />
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
              name your members can claim when they sign in. Choose a group to drop the whole batch into
              that subgroup (e.g. student.{admin.parent}).
            </InfoTip>
          </div>

          {subgroups.length > 0 && (
            <label className={styles.field} style={{ marginBottom: 10, maxWidth: 360 }}>
              <span className={styles.fieldLabel}>Add this batch to</span>
              <select
                className={styles.input}
                style={{ width: "100%" }}
                value={importSubgroup}
                onChange={(e) => setImportSubgroup(e.target.value)}
              >
                <option value="">{admin.parent} (organization root)</option>
                {subgroups.map((s) => (
                  <option key={s.fqdn} value={s.label}>
                    {s.fqdn}
                  </option>
                ))}
              </select>
            </label>
          )}

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
                    {i.label}.{i.subgroup ? `${i.subgroup}.` : ""}{admin.parent}
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
            <span style={{ marginLeft: 10, fontSize: 13, color: "var(--muted, #6b7280)" }}>{importMsg}</span>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--line, #e6e8eb)", marginTop: 16, paddingTop: 14 }}>
          <div className={styles.cardLabel}>
            Subgroups
            <InfoTip>
              A subgroup is a named branch of your organization, like eng.{admin.parent}. Members can
              claim names under it (alice.eng.{admin.parent}). You can hand a subgroup to a manager
              wallet, and they can issue names in that branch only, never your root or other subgroups.
            </InfoTip>
          </div>

          {subgroups.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
              {subgroups.map((s) => (
                <li
                  key={s.fqdn}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "9px 0",
                    borderTop: "1px solid var(--line, #e6e8eb)",
                    fontSize: 13,
                  }}
                >
                  <span className={styles.mono}>{s.fqdn}</span>
                  <span style={{ color: "var(--muted, #6b7280)", display: "inline-flex", gap: 4 }}>
                    {s.manager ? (
                      <>
                        manager <WalletAddress address={s.manager} style={{ fontSize: 12 }} />
                      </>
                    ) : (
                      "no manager"
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span
              className={styles.mono}
              style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--line, #e6e8eb)", borderRadius: 8, overflow: "hidden" }}
            >
              <input
                value={sgLabel}
                onChange={(e) => setSgLabel(e.target.value)}
                placeholder="eng"
                style={{ border: "none", outline: "none", padding: "8px 4px 8px 10px", width: 90, font: "inherit" }}
              />
              <span style={{ color: "var(--muted, #6b7280)", paddingRight: 10 }}>.{admin.parent}</span>
            </span>
            <input
              value={sgManager}
              onChange={(e) => setSgManager(e.target.value)}
              placeholder="manager wallet 0x… (optional)"
              className={styles.mono}
              style={{ flex: "1 1 240px", minWidth: 200, border: "1px solid var(--line, #e6e8eb)", borderRadius: 8, padding: "8px 10px", font: "inherit" }}
            />
            <button className={styles.primaryButton} onClick={handleCreateSubgroup} disabled={sgStatus === "creating"}>
              {sgStatus === "creating" ? "Creating…" : "Create subgroup"}
            </button>
          </div>
          {sgMsg && (
            <p className={styles.cardText} style={{ margin: "8px 0 0", color: "var(--muted, #6b7280)", fontSize: 13 }}>
              {sgMsg}
            </p>
          )}
        </div>
      </section>
    );
  }

  // Set up an org (no managed org yet): verify domain, then register a name.
  return (
    <section className={styles.card}>
      <div className={styles.cardLabel}>Set up your organization</div>

      {prov.phase === "loading" && (
        <p className={styles.cardText} style={{ margin: 0 }}>
          Loading…
        </p>
      )}

      {prov.phase === "public" && (
        <p className={styles.cardText} style={{ margin: 0 }}>
          You&apos;re signed in with a personal email, so there&apos;s no organization domain to set
          up. Organizations are created from a company email domain.
        </p>
      )}

      {prov.phase === "unverified" && (
        <>
          <p className={styles.cardText}>
            First, prove you control <strong>{prov.domain}</strong>. This makes you the
            organization&apos;s authority, required before registering its name.
            <InfoTip>
              Add a DNS TXT record to your domain. Controlling the domain (not just one mailbox) is
              what authorizes you to register and manage the org&apos;s name.
            </InfoTip>
          </p>
          {verify.status === "idle" ? (
            <button className={styles.primaryButton} onClick={handleVerifyStart}>
              Verify domain
            </button>
          ) : (
            <>
              <p className={styles.cardText} style={{ margin: "0 0 8px" }}>
                Add this <strong>TXT</strong> record to <strong>{verify.domain}</strong>, then check:
              </p>
              <p
                className={styles.mono}
                style={{ margin: "0 0 10px", padding: "8px 10px", background: "#f1f3f5", borderRadius: 8, wordBreak: "break-all" }}
              >
                {verify.value}
              </p>
              <button
                className={styles.primaryButton}
                onClick={handleVerifyCheck}
                disabled={verify.status === "checking"}
              >
                {verify.status === "checking" ? "Checking…" : "Check verification"}
              </button>
            </>
          )}
          {verifyMsg && (
            <p className={styles.cardText} style={{ margin: "8px 0 0", color: "var(--muted, #6b7280)", fontSize: 13 }}>
              {verifyMsg}
            </p>
          )}
        </>
      )}

      {prov.phase === "suggest" && (
        <>
          <p className={styles.cardText}>
            Pick a name to register for your organization:
            <InfoTip>
              We turn your email domain into a name (org.com becomes org.eth). If it&apos;s taken,
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
                  borderTop: "1px solid var(--line, #e6e8eb)",
                }}
              >
                <span className={styles.mono}>{o.fqdn}</span>
                {o.available ? (
                  <button className={styles.primaryButton} onClick={() => handleProvision(o.label)}>
                    Register
                  </button>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--muted, #6b7280)" }}>taken</span>
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
          <span style={{ color: "var(--muted, #6b7280)", fontSize: 13 }}>
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

      {/* Alternative to registering a new name: bring a parent you already own. Needs no DNS proof —
          wallet control of the name IS the authority. */}
      {(prov.phase === "suggest" || prov.phase === "unverified") && (
        <AdoptParent onAdopted={loadAdmin} />
      )}
    </section>
  );
}

export default AdminConsole;
