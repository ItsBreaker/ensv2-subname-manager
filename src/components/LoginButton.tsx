"use client";

import { usePrivy } from "@privy-io/react-auth";
import { InfoTip } from "./InfoTip";
import styles from "./LoginButton.module.css";

/**
 * Placeholder auth control for Phase 0. Renders Privy's email-login button and reflects
 * the current login state. No real auth flow (org-domain matching, SIWE, sessions) yet —
 * that's Phase 1+. See docs/architecture.html §4 (auth-path decision tree).
 */
function PrivyLoginButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  if (!ready) {
    return (
      <button className={styles.button} disabled>
        Loading…
      </button>
    );
  }

  if (authenticated) {
    return (
      <div className={styles.row}>
        <span className={styles.who}>
          Signed in{user?.email?.address ? ` as ${user.email.address}` : ""}
        </span>
        <button className={styles.button} onClick={logout}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <button className={styles.button} onClick={login}>
        Sign in with email
      </button>
      <InfoTip>
        Sign in with just your email. We&apos;ll create a secure wallet for you behind the
        scenes. No crypto knowledge needed.
      </InfoTip>
    </div>
  );
}

export function LoginButton() {
  // The Providers component skips PrivyProvider when no app ID is configured, so calling
  // usePrivy() would throw. Guard on the same env var to keep the page rendering.
  const configured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

  if (!configured) {
    return (
      <div className={styles.row}>
        <button className={styles.button} disabled>
          Sign in with email
        </button>
        <InfoTip>
          Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> in <code>.env.local</code> to enable login.
        </InfoTip>
      </div>
    );
  }

  return <PrivyLoginButton />;
}

export default LoginButton;
