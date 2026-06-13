"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { Session } from "@/hooks/useSession";
import { InfoTip } from "./InfoTip";
import styles from "./Manager.module.css";

/** Turn an email local-part into a plausible default subname label. */
function defaultLabel(email: string | null): string {
  const local = email?.split("@")[0] ?? "";
  return local.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type IssueStatus = "idle" | "issuing" | "done" | "error";
type IssueResult = { fqdn: string; txHash: string };

type OrgState =
  | { loading: true }
  | { loading: false; org: { parent: string } | null; isPublicDomain: boolean; subname: string | null };

/** Profile text-record fields the member can edit (label → resolver text key). */
const PROFILE_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "name", label: "Display name", placeholder: "Jayden" },
  { key: "description", label: "Bio", placeholder: "Builder at democlub" },
  { key: "url", label: "Website", placeholder: "https://…" },
  { key: "avatar", label: "Avatar URL", placeholder: "https://…/me.png" },
  { key: "com.twitter", label: "Twitter", placeholder: "yourhandle" },
];

/**
 * The manager shell — where a logged-in member lands (architecture doc §3). Eligibility and any
 * already-claimed name come from /api/org (DB is server-only). Claiming calls /api/issue (mints +
 * sets the addr record so the name resolves); the profile editor calls /api/records (text records).
 */
export function Manager({ session }: { session: Session }) {
  const { email, verifiedEmailDomain, address, logout } = session;
  const { getAccessToken } = usePrivy();

  const [orgState, setOrgState] = useState<OrgState>({ loading: true });
  const [label, setLabel] = useState(() => defaultLabel(email));
  const [status, setStatus] = useState<IssueStatus>("idle");
  const [result, setResult] = useState<IssueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClaim, setShowClaim] = useState(false);

  const [profile, setProfile] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/org", { headers: { authorization: `Bearer ${token}` } });
        const data = (await res.json()) as {
          ok?: boolean;
          org?: { parent: string } | null;
          isPublicDomain?: boolean;
          subname?: string | null;
        };
        if (cancelled) return;
        if (res.ok && data.ok) {
          setOrgState({
            loading: false,
            org: data.org ?? null,
            isPublicDomain: !!data.isPublicDomain,
            subname: data.subname ?? null,
          });
        } else {
          setOrgState({ loading: false, org: null, isPublicDomain: false, subname: null });
        }
      } catch {
        if (!cancelled) setOrgState({ loading: false, org: null, isPublicDomain: false, subname: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  const org = orgState.loading ? null : orgState.org;
  const myName = result?.fqdn ?? (orgState.loading ? null : orgState.subname);
  const fqdn = org && label ? `${label}.${org.parent}` : null;
  const canIssue = Boolean(org && label) && status !== "issuing";

  const handleIssue = useCallback(async () => {
    if (!org || !label) return;
    setStatus("issuing");
    setError(null);
    setResult(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/issue", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ label }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string } & Partial<IssueResult>;
      if (!res.ok || !data.ok || !data.fqdn || !data.txHash) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setResult({ fqdn: data.fqdn, txHash: data.txHash });
      setStatus("done");
      setShowClaim(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [org, label, getAccessToken]);

  const handleSaveProfile = useCallback(async () => {
    const texts = Object.fromEntries(Object.entries(profile).filter(([, v]) => v.trim() !== ""));
    if (Object.keys(texts).length === 0) return;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/records", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ texts }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSaveStatus("done");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveStatus("error");
    }
  }, [profile, getAccessToken]);

  // The claim form, reused for first-time claims and "claim another name".
  const claimForm = org ? (
    <>
      <div className={styles.issueRow}>
        <div className={styles.inputGroup}>
          <input
            className={styles.input}
            value={label}
            onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="yourname"
            spellCheck={false}
          />
          <span className={styles.suffix}>.{org.parent}</span>
        </div>
        <button className={styles.primaryButton} onClick={handleIssue} disabled={!canIssue}>
          {status === "issuing" ? "Claiming…" : "Claim my name"}
        </button>
        <InfoTip>
          Creates {fqdn ?? "alice.yourorg.eth"} as a name you fully own on the blockchain, set up to
          resolve to your wallet. Your organization covers the small network fee.
        </InfoTip>
      </div>
      {status === "error" && (
        <p className={styles.notice}>
          Couldn&apos;t claim your name:
          <br />
          <span className={styles.mono}>{error}</span>
        </p>
      )}
    </>
  ) : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <h2 className={styles.heading}>Manager</h2>
        <button className={styles.ghostButton} onClick={logout}>
          Sign out
        </button>
      </div>

      {/* Unified session readout */}
      <section className={styles.card}>
        <div className={styles.cardLabel}>Your session</div>
        <dl className={styles.defs}>
          <div className={styles.defRow}>
            <dt>Email</dt>
            <dd>{email ?? "—"}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>
              Wallet
              <InfoTip>
                A secure wallet we created for you automatically when you signed in. You don&apos;t
                need a seed phrase or browser extension.
              </InfoTip>
            </dt>
            <dd className={styles.mono}>{address ? shortAddress(address) : "provisioning…"}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Verified domain</dt>
            <dd className={styles.mono}>{verifiedEmailDomain ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* Eligibility / claim / profile */}
      {orgState.loading ? (
        <section className={styles.card}>
          <p className={styles.cardText} style={{ margin: 0 }}>
            Checking your organization…
          </p>
        </section>
      ) : org ? (
        <section className={styles.card}>
          {myName ? (
            <>
              <div className={styles.cardLabel} style={{ color: "var(--accent2, #5be2c0)" }}>
                ✓ Your name
              </div>
              <p className={styles.cardText}>
                You own <strong>{myName}</strong>
                {result && (
                  <>
                    {" — "}
                    <a
                      href={`https://sepolia.etherscan.io/tx/${result.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view transaction
                    </a>
                  </>
                )}
                . It resolves to your wallet. Add profile records below.
                <InfoTip>
                  These are public details attached to your name — anyone looking up {myName} can see
                  them. All optional.
                </InfoTip>
              </p>

              <div className={styles.profileGrid}>
                {PROFILE_FIELDS.map((f) => (
                  <label key={f.key} className={styles.field}>
                    <span className={styles.fieldLabel}>{f.label}</span>
                    <input
                      className={styles.input}
                      style={{ width: "100%" }}
                      value={profile[f.key] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setProfile((p) => ({ ...p, [f.key]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <div className={styles.issueRow} style={{ marginTop: 12 }}>
                <button
                  className={styles.primaryButton}
                  onClick={handleSaveProfile}
                  disabled={saveStatus === "saving"}
                >
                  {saveStatus === "saving" ? "Saving…" : "Save profile"}
                </button>
                {saveStatus === "done" && <span className={styles.success}>Saved ✓</span>}
              </div>
              {saveStatus === "error" && (
                <p className={styles.notice}>
                  Couldn&apos;t save:
                  <br />
                  <span className={styles.mono}>{saveError}</span>
                </p>
              )}

              {/* Claim another name (also the way to test a fresh, resolvable claim) */}
              <div style={{ borderTop: "1px solid var(--line, #2a2f3d)", marginTop: 18, paddingTop: 14 }}>
                {showClaim ? (
                  claimForm
                ) : (
                  <button
                    className={styles.ghostButton}
                    onClick={() => {
                      setLabel("");
                      setStatus("idle");
                      setShowClaim(true);
                    }}
                  >
                    + Claim another name
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className={styles.cardLabel} style={{ color: "var(--accent2, #5be2c0)" }}>
                ✓ Eligible
              </div>
              <p className={styles.cardText}>
                Your email domain <code>{verifiedEmailDomain}</code> is linked to{" "}
                <strong>{org.parent}</strong>. You can claim your own name under it.
              </p>
              {claimForm}
            </>
          )}
        </section>
      ) : orgState.isPublicDomain ? (
        <section className={styles.card}>
          <div className={styles.cardLabel}>Personal account</div>
          <p className={styles.cardText} style={{ margin: 0 }}>
            <code>{verifiedEmailDomain}</code> is a personal email provider, so there&apos;s no
            organization to join. Registering your own name (self-serve) is coming soon.
          </p>
        </section>
      ) : (
        <section className={styles.card}>
          <div className={styles.cardLabel}>Not set up yet</div>
          <p className={styles.cardText} style={{ margin: 0 }}>
            <code>{verifiedEmailDomain ?? "—"}</code> isn&apos;t enrolled with an organization yet.
            Auto-provisioning a name for your organization is coming soon.
          </p>
        </section>
      )}
    </div>
  );
}

export default Manager;
