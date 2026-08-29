import type { Metadata, Viewport } from "next";
import { Nunito, Geist_Mono } from "next/font/google";
import "./globals.css";

// Nunito 600/800/900: body copy is 600, chips and labels 800, headings 900.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["600", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e1b40",
};

/**
 * The manifest and the Apple bits are here for exactly one reason:
 * notifications. iPhone Safari has no `window.Notification` in a tab — the API
 * only exists for a site added to the Home Screen, and only a site with a
 * manifest that says `display: standalone` installs like one. On a desktop
 * browser none of this is needed and none of it hurts.
 *
 * There is deliberately **no** `icons.apple` here. `src/app/apple-icon.tsx` is
 * already the 180px iOS icon (Next's file convention emits the `<link>` for
 * it), and a second `rel="apple-touch-icon"` with no `sizes` would leave which
 * one iOS installs up to tag order. The manifest's two PNGs come from
 * `scripts/make-icons.mjs`; the favicon and the iOS icon stay as they were.
 *
 * `src/proxy.ts` never sees any of these files: its matcher excludes anything
 * ending in a static extension, `webmanifest` and `png` among them, which is
 * what stops the manifest fetch (credentials-less, like a worker's) from being
 * answered with a redirect to `/login`.
 */
export const metadata: Metadata = {
  title: "Apartment Quest",
  description: "NYC apartment hunt tracker",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Apartment Quest",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `dark` is permanent: the app has no light mode. It is still set so the
    // shadcn primitives' `dark:` branches are the ones that apply.
    <html
      lang="en"
      className={`dark ${nunito.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
