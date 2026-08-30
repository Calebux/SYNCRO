import type React from "react";
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { PWAProvider } from "../components/pwa-provider";
import CookieConsent from "@/components/cookie-consent";
import Link from "next/link";
import { NonceProvider } from "../components/providers/nonce-provider";
import { QueryProvider } from "../components/providers/query-provider";

const _geist = GeistSans;
const _geistMono = GeistMono;

export const metadata: Metadata = {
  title: "SYNCRO — Subscription Manager",
  description: "Self-custodial subscription management on Stellar",
  generator: "v0.app",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#6366f1",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const nonce = headersList.get("x-nonce") || "";

    return (
        <html lang="en">
            <body className={`font-sans antialiased`} suppressHydrationWarning>
                <NonceProvider nonce={nonce}>
                    <QueryProvider>
                        <PWAProvider>{children}</PWAProvider>
                    </QueryProvider>
                </NonceProvider>
                <footer className="py-4 text-center text-xs text-gray-500">
                    <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
                    <span className="mx-2">·</span>
                    <Link href="/terms" className="hover:underline">Terms of Service</Link>
                </footer>
                <CookieConsent />
            </body>
        </html>
    );
}
