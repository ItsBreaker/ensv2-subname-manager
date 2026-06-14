"use client";

import type { ReactNode } from "react";
import { InfoTip } from "./InfoTip";

/**
 * Small shared UI primitives used across the app.
 */

/**
 * A button with its info icon sitting INSIDE the button's right edge. The icon is a sibling (not a
 * nested <button>, which is invalid HTML) absolutely positioned over the button's right padding, so
 * hovering it still shows the tooltip and clicking the button still fires its action.
 */
export function ButtonWithInfo({
  children,
  info,
  className,
  onClick,
  disabled,
  type = "button",
  style,
}: {
  children: ReactNode;
  info: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  style?: React.CSSProperties;
}) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type={type}
        className={className}
        onClick={onClick}
        disabled={disabled}
        style={{ ...style, paddingRight: 38 }}
      >
        {children}
      </button>
      <span
        style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", display: "inline-flex" }}
        onClick={(e) => e.stopPropagation()}
      >
        <InfoTip>{info}</InfoTip>
      </span>
    </span>
  );
}

const SEPOLIA = "https://sepolia.etherscan.io";

/** A full (untruncated) wallet address that links to its Sepolia Etherscan page. */
export function WalletAddress({ address, style }: { address: string; style?: React.CSSProperties }) {
  return (
    <a
      href={`${SEPOLIA}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title="View on Sepolia Etherscan"
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: "0.86em",
        wordBreak: "break-all",
        color: "var(--accent)",
        textDecoration: "none",
        ...style,
      }}
    >
      {address}
    </a>
  );
}

/**
 * A tiny dependency-free cumulative-growth chart: members over time. Pass the members' ISO created-at
 * timestamps; renders a filled line of total members vs time. Returns a friendly placeholder until
 * there are at least two points to draw a line.
 */
export function GrowthChart({ dates }: { dates: string[] }) {
  const times = dates
    .map((d) => new Date(d).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (times.length < 2) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
        {times.length === 0
          ? "No members yet. The growth chart appears once people start joining."
          : "1 member so far. The chart fills in as more people join."}
      </p>
    );
  }

  const W = 600;
  const H = 130;
  const pad = 10;
  const n = times.length;
  const tMin = times[0];
  const tMax = times[n - 1];
  const span = Math.max(1, tMax - tMin);
  const x = (t: number) => pad + ((t - tMin) / span) * (W - 2 * pad);
  const y = (c: number) => H - pad - (c / n) * (H - 2 * pad);
  const pts = times.map((t, i) => `${x(t).toFixed(1)},${y(i + 1).toFixed(1)}`);
  const area = `${pad},${(H - pad).toFixed(1)} ${pts.join(" ")} ${x(tMax).toFixed(1)},${(H - pad).toFixed(1)}`;

  const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Member growth over time">
        <polygon points={area} fill="rgba(56,137,255,0.12)" />
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
        <span>{fmt(tMin)}</span>
        <span>
          {n} member{n === 1 ? "" : "s"} total
        </span>
        <span>{fmt(tMax)}</span>
      </div>
    </div>
  );
}

/** An ENS name that links to its Etherscan / app.ens.domains page. */
export function EnsName({ name }: { name: string }) {
  return (
    <a
      href={`https://app.ens.domains/${name}`}
      target="_blank"
      rel="noreferrer"
      title="View on the ENS app"
      style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}
    >
      {name}
    </a>
  );
}
