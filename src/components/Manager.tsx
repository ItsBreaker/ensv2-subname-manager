"use client";

import { useMemo, useState } from "react";
import { OffchainIssuer, type IssuedSubname } from "@/lib/ens/issuer";
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

/**
 * The manager shell — where a logged-in member lands (architecture doc §3). Phase 1 scope:
 * show the unified session, the org-eligibility match, and the issue control. The actual
 * issue call goes through the OffchainIssuer interface; until NameStone is wired it surfaces
 * a clear "not connected yet" state, proving the path end-to-end without the backend.
 */
export function Manager({ session }: { session: Session }) {
  const { email, verifiedEmailDomain, address, org, logout } = session;

  const [label, setLabel] = useState(() => defaultLabel(email));
  const [status, setStatus] = useState<IssueStatus>("idle");
  const [result, setResult] = useState<IssuedSubname | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issuer = useMemo(() => new OffchainIssuer(), []);
  const fqdn = org && label ? `${label}.${org.parent}` : null;
  const canIssue = Boolean(org && address && label) && status !== "issuing";

  async function handleIssue() {
    if (!org || !address || !label) return;
    setStatus("issuing");
    setError(null);
    setResult(null);
    try {
      const issued = await issuer.issue({ parent: org.parent, label, owner: address });
      setResult(issued);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

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
            <dd className={styles.mono}>
              {address ? shortAddress(address) : "provisioning…"}
            </dd>
          </div>
          <div className={styles.defRow}>
            <dt>Verified domain</dt>
            <dd className={styles.mono}>{verifiedEmailDomain ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* Org eligibility match */}
      {org ? (
        <section className={styles.card}>
          <div className={styles.cardLabel} style={{ color: "var(--accent2, #5be2c0)" }}>
            ✓ Eligible
          </div>
          <p className={styles.cardText}>
            Your email domain <code>{verifiedEmailDomain}</code> is linked to{" "}
            <strong>{org.parent}</strong>. You can claim a free name under it.
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
            <button className={styles.primaryButton} onClick={handleIssue} disabled={!canIssue}>
              {status === "issuing" ? "Claiming…" : "Claim my name"}
            </button>
            <InfoTip>
              Gives you your own name under your organization, e.g. {fqdn ?? "alice.yourorg.eth"} —
              free and instant. You can use it as your web3 username.
            </InfoTip>
          </div>

          {status === "done" && result && (
            <p className={styles.success}>🎉 Claimed {result.fqdn}</p>
          )}
          {status === "error" && (
            <p className={styles.notice}>
              Issuance isn&apos;t connected yet (offchain NameStone backend is stubbed). The flow is
              wired — this is the placeholder response:
              <br />
              <span className={styles.mono}>{error}</span>
            </p>
          )}
        </section>
      ) : (
        <section className={styles.card}>
          <div className={styles.cardLabel}>Not linked to an organization</div>
          <p className={styles.cardText}>
            Your email domain <code>{verifiedEmailDomain ?? "—"}</code> isn&apos;t enrolled with any
            organization yet, so there&apos;s no name to claim. To try the demo, add your domain to{" "}
            <code>src/lib/orgs.ts</code>.
          </p>
        </section>
      )}
    </div>
  );
}

export default Manager;
