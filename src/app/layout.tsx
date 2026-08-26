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

export const metadata: Metadata = {
  title: "Apartment Quest",
  description: "NYC apartment hunt tracker",
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
