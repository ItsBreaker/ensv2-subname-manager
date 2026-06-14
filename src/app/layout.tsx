import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

const title = "ENS Subname Manager";
const description =
  "Onboard anyone to ENS by email. Organizations issue, manage, and revoke member subnames at scale.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ensv2-subname-manager.vercel.app"),
  title,
  description,
  // Favicon / app icon (the logo in /public).
  icons: { icon: "/ensv2_subname_manager_logo.png", apple: "/ensv2_subname_manager_logo.png" },
  // Social share thumbnail (the 16:9 banner).
  openGraph: {
    title,
    description,
    images: [{ url: "/ensv2_subname_manager_banner.png", width: 1280, height: 720, alt: title }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/ensv2_subname_manager_banner.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
