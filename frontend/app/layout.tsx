import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { PwaRegister } from "@/components/shared/pwa-register";
import { PwaInstallPrompt } from "@/components/shared/pwa-install-prompt";

// Everything in this app is client-rendered, auth-gated UI — there is nothing
// to statically prerender. Forcing dynamic rendering also sidesteps a Next
// 15.0.0 prerender bug where the shared Providers chunk resolves React to
// null, which made `next build` fail on a shifting set of pages.
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  // Pinch zoom stays available. Counter staff need to magnify a batch number,
  // an expiry date or a photographed prescription on a phone, and locking the
  // scale also fails WCAG 1.4.4.
  maximumScale: 5,
  userScalable: true,
};

export const metadata: Metadata = {
  title: "Radha Madhav Medical Hall",
  description: "Pharmacy management for Radha Madhav Medical Hall: POS billing, Schedule H compliance and batch inventory.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    // Home-screen labels get truncated, so this is the short form.
    title: "Radha Madhav",
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // Safari ignores an SVG here and falls back to a screenshot of the page,
    // so the home-screen icon has to be a raster. 180px is the size iOS asks
    // for on modern devices; it downscales that for everything smaller.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <PwaRegister />
          {children}
          <PwaInstallPrompt />
        </Providers>
      </body>
    </html>
  );
}
