"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * One item in the app nav, highlighted when you are on it.
 *
 * Client-side only because it needs the current path. The nav around it stays a
 * server component so sign-out can remain a server action.
 */
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  // startsWith so /observatory?project=x still marks Observatory as current.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded px-2 py-1 text-sm font-medium text-neutral-100 bg-neutral-800"
          : "rounded px-2 py-1 text-sm text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
      }
    >
      {label}
    </Link>
  );
}
