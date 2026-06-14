"use client";

import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  isAddress,
  type Address,
} from "viem";
import { sepolia } from "viem/chains";
import { ensureParentSubregistry } from "@/lib/ens/subregistry";
import { grantRegistrarRole, hasRolesIn } from "@/lib/ens/subgroups";
import { ROLE_REGISTRAR } from "@/lib/ens/roles";
import { InfoTip } from "./InfoTip";
import styles from "./Manager.module.css";

function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * "Bring your own parent" — an org admin who already owns their ENS name (bought outside the
 * platform) connects the owning wallet and grants the platform permission to issue member subnames.
 *
 * The admin's OWN wallet signs the on-chain steps (proving control = administration authority):
 *   1. attach a UserRegistry subregistry to the parent (if missing), and
 *   2. grant the platform issuer ROLE_REGISTRAR on it.
 * Then POST /api/admin/adopt re-verifies all of this server-side and records the org. After that, the
 * normal platform-mediated member flow (/api/issue) works under the user-owned parent.
 */
export function AdoptParent({ onAdopted }: { onAdopted: () => void }) {
  const { getAccessToken, linkWallet } = usePrivy();
  const { wallets } = useWallets();

  const externalWallets = wallets.filter((w) => w.walletClientType !== "privy");
  const [parent, setParent] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "working">("idle");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleAdopt = async () => {
    setError(null);
    setDone(false);
    const name = parent.trim().toLowerCase();
    if (!name.endsWith(".eth") || name.split(".").length !== 2) {
      setError("Enter a second-level .eth name you own, e.g. acme.eth.");
      return;
    }
    const walletAddr = selected || externalWallets[0]?.address;
    const wallet = externalWallets.find((w) => w.address === walletAddr);
    if (!wallet) {
      setError("Connect the wallet that owns this name first.");
      return;
    }

    setStatus("working");
    try {
      // Build a viem wallet client for the connected wallet, on Sepolia.
      setStep("Switching wallet to Sepolia…");
      await wallet.switchChain(sepolia.id);
      const provider = await wallet.getEthereumProvider();
      const account = getAddress(wallet.address) as Address;
      const walletClient = createWalletClient({ account, chain: sepolia, transport: custom(provider) });
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL),
      });

      // The platform issuer address to delegate to.
      setStep("Fetching platform issuer…");
      const platformRes = await fetch("/api/platform");
      const platform = (await platformRes.json()) as { ok?: boolean; issuer?: string; error?: string };
      if (!platform.ok || !platform.issuer || !isAddress(platform.issuer)) {
        throw new Error(platform.error ?? "Couldn't load the platform issuer address.");
      }
      const issuer = getAddress(platform.issuer);

      // 1. Attach a subregistry to the parent (you sign; first time is 2 txs).
      setStep("Setting up your name's subregistry (confirm in your wallet)…");
      const { subregistry } = await ensureParentSubregistry(publicClient, walletClient, name);

      // 2. Grant the platform issuer ROLE_REGISTRAR — unless it already has it.
      const already = await hasRolesIn(publicClient, {
        registry: subregistry,
        account: issuer,
        roleBitmap: ROLE_REGISTRAR,
      });
      if (!already) {
        setStep("Granting the platform permission to issue (confirm in your wallet)…");
        const grantHash = await grantRegistrarRole(
          { publicClient, walletClient },
          { registry: subregistry, manager: issuer },
        );
        await publicClient.waitForTransactionReceipt({ hash: grantHash });
      }

      // 3. Record the org (server re-verifies ownership + delegation on-chain).
      setStep("Finishing set-up…");
      const token = await getAccessToken();
      const res = await fetch("/api/admin/adopt", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ parent: name }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Couldn't record your organization.");

      setDone(true);
      setStep(null);
      onAdopted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(null);
    } finally {
      setStatus("idle");
    }
  };

  return (
    <div style={{ borderTop: "1px solid var(--line, #e6e8eb)", marginTop: 16, paddingTop: 14 }}>
      <div className={styles.cardLabel}>
        Already own your organization&apos;s name?
        <InfoTip>
          If you bought your ENS name elsewhere (e.g. on the ENS app), connect the wallet that owns it.
          You&apos;ll approve two quick transactions that let the platform issue member names under it.
          You keep full ownership and can revoke this anytime.
        </InfoTip>
      </div>

      <p className={styles.cardText} style={{ margin: "0 0 10px" }}>
        Connect the wallet that owns the name, then enter the name.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <select
          className={styles.input}
          style={{ flex: "1 1 220px" }}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">
            {externalWallets.length ? "Select the owning wallet" : "No wallet connected"}
          </option>
          {externalWallets.map((w) => (
            <option key={w.address} value={w.address}>
              {shortAddress(w.address)} — {w.walletClientType}
            </option>
          ))}
        </select>
        <button type="button" className={styles.ghostButton} onClick={linkWallet}>
          Connect a wallet
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className={styles.input}
          style={{ flex: "1 1 200px" }}
          value={parent}
          onChange={(e) => setParent(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ""))}
          placeholder="acme.eth"
          spellCheck={false}
        />
        <button
          className={styles.primaryButton}
          onClick={handleAdopt}
          disabled={status === "working" || !parent.trim() || externalWallets.length === 0}
        >
          {status === "working" ? "Setting up…" : "Use this name"}
        </button>
      </div>

      {step && (
        <p className={styles.cardText} style={{ margin: "8px 0 0", color: "var(--muted, #6b7280)", fontSize: 13 }}>
          {step}
        </p>
      )}
      {done && (
        <p className={styles.cardText} style={{ margin: "8px 0 0", color: "var(--accent2, #16a34a)", fontSize: 13 }}>
          Done — your organization is set up. Members can now claim names under {parent.trim().toLowerCase()}.
        </p>
      )}
      {error && (
        <p className={styles.notice} style={{ marginTop: 8 }}>
          <span className={styles.mono}>{error}</span>
        </p>
      )}
    </div>
  );
}

export default AdoptParent;
