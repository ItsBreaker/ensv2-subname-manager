"use client";

import { useState } from "react";
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

/**
 * The manager shell — where a logged-in member lands (architecture doc §3). Shows the unified
 * session, the org-eligibility match, and the issue control. Claiming calls POST /api/issue, which
 * verifies eligibility (Privy token → verified domain → enrolled org) server-side and has the
 * platform's manager key mint the real onchain subname to the member's wallet.
 */
export function Manager({ session }: { session: Session }) {
  const { email, verifiedEmailDomain, address, org, logout } = session;
  const { getAccessToken } = usePrivy();

  const [label, setLabel] = useState(() => defaultLabel(email));
  const [status, setStatus] = useState<IssueStatus>("idle");
  const [result, setResult] = useState<IssueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fqdn = org && label ? `${label}.${org.parent}` : null;
  const canIssue = Boolean(org && label) && status !== "issuing";

  async function handleIssue() {
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
            <button className={styles.primaryButton} onClick={handleIssue} disabled={!canIssue}>
              {status === "issuing" ? "Claiming…" : "Claim my name"}
            </button>
            <InfoTip>
              Creates {fqdn ?? "alice.yourorg.eth"} as a name you fully own on the blockchain. Your
              organization covers the small network fee — it takes a few seconds to confirm.
            </InfoTip>
          </div>

          {status === "done" && result && (
            <p className={styles.success}>
              🎉 Claimed {result.fqdn} —{" "}
              <a
                href={`https://sepolia.etherscan.io/tx/${result.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                view transaction
              </a>
            </p>
          )}
          {status === "error" && (
            <p className={styles.notice}>
              Couldn&apos;t claim your name:
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
