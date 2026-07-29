import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "IDEA",
  description: "Gated multi-LLM console — chat, repos, and per-project observatories.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      {/*
        Viewport-height shell, not min-height. With `min-h-full` the body grew
        with its content, so a long file tree pushed the chat composer below the
        fold and every message meant scrolling down to type and back up to read.
        Fixing the shell to the viewport lets the panes inside scroll instead of
        the page.
      */}
      <body className="flex h-dvh flex-col overflow-hidden bg-neutral-950 text-neutral-100">
        <Nav />
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</main>
      </body>
    </html>
  );
}
