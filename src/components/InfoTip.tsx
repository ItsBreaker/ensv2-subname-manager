"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./InfoTip.module.css";

export interface InfoTipProps {
  /** Plain-language explanation: what this control does and when to click it. No jargon. */
  children: ReactNode;
  /** Optional accessible label for the trigger (defaults to "More information"). */
  label?: string;
  /** Optional "Learn more" link for the curious. */
  learnMoreHref?: string;
}

/**
 * <InfoTip> — an ⓘ icon that reveals a one/two-sentence tooltip on hover or tap.
 *
 * Per docs/architecture.html §3: the product is for web3 novices, so *every* button and
 * control carries one of these. Built early (Phase 0) so help is designed in, not retrofitted.
 * Keep copy plain ("This creates a free web address for a member" — not "mints a CCIP-Read subname").
 *
 * Works on both desktop (hover) and touch (tap toggles open; Escape / blur closes).
 */
export function InfoTip({ children, label = "More information", learnMoreHref }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span
      className={styles.root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="4.6" r="1" fill="currentColor" />
          <rect x="7.25" y="6.75" width="1.5" height="5" rx="0.75" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <span role="tooltip" id={tooltipId} className={styles.bubble}>
          {children}
          {learnMoreHref && (
            <>
              {" "}
              <a
                className={styles.learnMore}
                href={learnMoreHref}
                target="_blank"
                rel="noreferrer"
              >
                Learn more
              </a>
            </>
          )}
        </span>
      )}
    </span>
  );
}

export default InfoTip;
