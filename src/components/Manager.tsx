"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { Session } from "@/hooks/useSession";
import type { Mode } from "./GoldenPath";
import { AdminConsole } from "./AdminConsole";
import { InfoTip } from "./InfoTip";
import styles from "./Manager.module.css";

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

const PROFILE_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "name", label: "Display name", placeholder: "Jayden" },
  { key: "description", label: "Bio", placeholder: "Builder at democlub" },
  { key: "url", label: "Website", placeholder: "https://…" },
  { key: "avatar", label: "Avatar URL", placeholder: "https://…/me.png" },
  { key: "com.twitter", label: "Twitter", placeholder: "yourhandle" },
];

const linkButtonStyle: React.CSSProperties = {
  appearance: "none",
  border: "none",
  background: "none",
  padding: 0,
  color: "var(--accent)",
  cursor: "pointer",
  font: "inherit",
};

export function Manager({
  session,
  mode,
  setMode,
}: {
  session: Session;
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  const { email, verifiedEmailDomain, address, logout } = session;
  const { getAccessToken } = usePrivy();

  const [orgState, setOrgState] = useState<OrgState>({ loading: true });
  const [label, setLabel] = useState(() => defaultLabel(email));
  const [openParent, setOpenParent] = useState("");
  const [status, setStatus] = useState<IssueStatus>("idle");
  const [result, setResult] = useState<IssueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClaim, setShowClaim] = useState(false);

  const [profile, setProfile] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadOrg = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/org", { headers: { authorization: `Bearer ${token}` } });
      const data = (await res.json()) as {
        ok?: boolean;
        org?: { parent: string } | null;
        isPublicDomain?: boolean;
        subname?: string | null;
      };
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
      setOrgState({ loading: false, org: null, isPublicDomain: false, subname: null });
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);

  const org = orgState.loading ? null : orgState.org;
  const myName = result?.fqdn ?? (orgState.loading ? null : orgState.subname);

  const handleIssue = useCallback(
    async (parentOverride?: string) => {
      if (!label) return;
      setStatus("issuing");
      setError(null);
      setResult(null);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/issue", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ label, ...(parentOverride ? { parent: parentOverride } : {}) }),
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
    },
    [label, getAccessToken],
  );

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

  const issueError =
    status === "error" ? (
      <p className={styles.notice}>
        Couldn&apos;t claim your name:
        <br />
        <span className={styles.mono}>{error}</span>
      </p>
    ) : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <h2 className={styles.heading}>{mode === "admin" ? "Admin" : "Manager"}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Admins can preview the member view; members don't see an admin toggle. */}
          {mode === "admin" && (
            <div
              style={{
                display: "inline-flex",
                border: "1px solid var(--line, #2a2f3d)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {(["member", "admin"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    appearance: "none",
                    border: "none",
                    cursor: "pointer",
                    font: "600 12px/1 inherit",
                    padding: "7px 12px",
                    background: mode === m ? "var(--accent)" : "transparent",
                    color: mode === m ? "#0f1117" : "var(--muted, #9aa3b5)",
                  }}
                >
                  {m === "member" ? "Member" : "Admin"}
                </button>
              ))}
            </div>
          )}
          <button className={styles.ghostButton} onClick={logout}>
            Sign out
          </button>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardLabel}>Your session</div>
        <dl className={styles.defs}>
          <div className={styles.defRow}>
            <dt>Email</dt>
            <dd>{email ?? "not set"}</dd>
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
            <dd className={styles.mono}>{verifiedEmailDomain ?? "not set"}</dd>
          </div>
        </dl>
      </section>

      {mode === "admin" ? (
        <AdminConsole />
      ) : orgState.loading ? (
        <section className={styles.card}>
          <p className={styles.cardText} style={{ margin: 0 }}>
            Checking your organization…
          </p>
        </section>
      ) : myName ? (
        <section className={styles.card}>
          <div className={styles.cardLabel} style={{ color: "var(--accent2, #5be2c0)" }}>
            {result ? "All set" : "Your name"}
          </div>
          {result ? (
            <p className={styles.cardText}>
              Thank you for setting up your name! <strong>{myName}</strong> is yours (
              <a
                href={`https://sepolia.etherscan.io/tx/${result.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                view transaction
              </a>
              ).
              <br />
              Think of it as a username for web3: instead of a long wallet address like{" "}
              <span className={styles.mono}>{address ? shortAddress(address) : "0x…"}</span>, people
              can find and pay you at <strong>{myName}</strong>. It already points to your wallet and
              works in any app that supports ENS. Add public profile details below — all optional.
            </p>
          ) : (
            <p className={styles.cardText}>
              You own <strong>{myName}</strong>. It resolves to your wallet. Add profile records below.
              <InfoTip>
                These are public details attached to your name. Anyone looking up {myName} can see
                them. All optional.
              </InfoTip>
            </p>
          )}

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
            {saveStatus === "done" && <span className={styles.success}>Saved</span>}
          </div>
          {saveStatus === "error" && (
            <p className={styles.notice}>
              Couldn&apos;t save:
              <br />
              <span className={styles.mono}>{saveError}</span>
            </p>
          )}

          {org && (
            <div style={{ borderTop: "1px solid var(--line, #2a2f3d)", marginTop: 18, paddingTop: 14 }}>
              {showClaim ? (
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
                  <button
                    className={styles.primaryButton}
                    onClick={() => handleIssue()}
                    disabled={!label || status === "issuing"}
                  >
                    {status === "issuing" ? "Claiming…" : "Claim"}
                  </button>
                </div>
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
          )}
        </section>
      ) : org ? (
        <section className={styles.card}>
          <div className={styles.cardLabel} style={{ color: "var(--accent2, #5be2c0)" }}>
            Eligible
          </div>
          <p className={styles.cardText}>
            Your email domain <code>{verifiedEmailDomain}</code> is linked to{" "}
            <strong>{org.parent}</strong>. You can claim your own name under it.
          </p>
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
            <button
              className={styles.primaryButton}
              onClick={() => handleIssue()}
              disabled={!label || status === "issuing"}
            >
              {status === "issuing" ? "Claiming…" : "Claim my name"}
            </button>
            <InfoTip>
              Creates {label ? `${label}.${org.parent}` : "alice.yourorg.eth"} as a name you fully own
              on the blockchain, set up to resolve to your wallet. Your organization covers the fee.
            </InfoTip>
          </div>
          {issueError}
        </section>
      ) : orgState.isPublicDomain ? (
        <section className={styles.card}>
          <div className={styles.cardLabel}>Join an organization</div>
          <p className={styles.cardText}>
            <code>{verifiedEmailDomain}</code> is a personal email, so we can&apos;t match you to an
            organization automatically. If your organization has opened sign-ups, enter its name to
            claim a name under it.
            <InfoTip>
              Ask your organization for their name (for example democlub.eth). It only works if
              they&apos;ve turned on open sign-ups.
            </InfoTip>
          </p>
          <label className={styles.field} style={{ marginBottom: 10 }}>
            <span className={styles.fieldLabel}>Organization name</span>
            <input
              className={styles.input}
              style={{ width: "100%" }}
              value={openParent}
              onChange={(e) => setOpenParent(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ""))}
              placeholder="democlub.eth"
              spellCheck={false}
            />
          </label>
          <div className={styles.issueRow}>
            <div className={styles.inputGroup}>
              <input
                className={styles.input}
                value={label}
                onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="yourname"
                spellCheck={false}
              />
              <span className={styles.suffix}>.{openParent || "yourorg.eth"}</span>
            </div>
            <button
              className={styles.primaryButton}
              onClick={() => handleIssue(openParent)}
              disabled={!openParent || !label || status === "issuing"}
            >
              {status === "issuing" ? "Claiming…" : "Claim my name"}
            </button>
          </div>
          {issueError}
        </section>
      ) : (
        <section className={styles.card}>
          <div className={styles.cardLabel}>Not set up yet</div>
          <p className={styles.cardText} style={{ margin: 0 }}>
            <code>{verifiedEmailDomain ?? "your domain"}</code> doesn&apos;t have a name set up yet.
            Ask your organization&apos;s admin to set it up — or, if that&apos;s you, switch to{" "}
            <button onClick={() => setMode("admin")} style={linkButtonStyle}>
              Admin
            </button>
            .
          </p>
        </section>
      )}
    </div>
  );
}

export default Manager;
