import { GoldenPath } from "@/components/GoldenPath";

/**
 * App shell: a sticky top bar + a wide (80%) container holding the golden-path entry, which is the
 * marketing hero when logged out and the full manager once signed in.
 */
export default function Home() {
  return (
    <>
      <header className="appBar">
        <div className="appBarInner appContainer">
          <span className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ensv2_subname_manager_logo.png"
              alt="ENS Subname Manager logo"
              width={28}
              height={28}
              style={{ borderRadius: 8, display: "block" }}
            />
            Subname Manager
          </span>
          <a
            href="https://app.ens.domains/"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 14, fontWeight: 600, textDecoration: "none" }}
          >
            Get a .eth name on ENS
          </a>
        </div>
      </header>

      <main className="appContainer" style={{ padding: "36px 0 96px" }}>
        <GoldenPath />
      </main>
    </>
  );
}
