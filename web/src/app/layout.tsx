import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "School Systems Directory",
  description: "Compare how school education is organised around the world.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="bg-gradient-to-r from-sky-500 via-cyan-500 to-teal-500 text-white shadow-sm">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-white/20 text-base">🎓</span>
              School Systems Directory
            </Link>
            <Link href="/admin" className="rounded-md px-3 py-1 text-sm text-white/90 hover:bg-white/15">
              Admin
            </Link>
          </div>
        </nav>
        <div className="flex-1">{children}</div>
        {/* Vercel Web Analytics: visitors, countries, pages, referrers. No cookies.
            Only reports on Vercel deployments, and only once enabled in the dashboard. */}
        <Analytics />
      </body>
    </html>
  );
}
