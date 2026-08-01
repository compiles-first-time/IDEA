"use client";

import { BYOK_PROVIDERS, byokHeaderName, type ByokProviderId } from "@/lib/byok";

/**
 * Browser side of BYOK (E-15.b): keys live in localStorage under this origin,
 * and leave it only as headers on same-origin `/api/chat` requests.
 *
 * localStorage rather than a cookie, deliberately: a cookie rides *every*
 * request automatically — pages, prefetches, third-party-triggered navigations.
 * A header is attached explicitly, to exactly one route, by our own code.
 */

const STORAGE_PREFIX = "idea.byok.";

function storageKey(provider: ByokProviderId): string {
  return `${STORAGE_PREFIX}${provider}`;
}

export function getStoredKey(provider: ByokProviderId): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(storageKey(provider)) ?? "";
}

export function setStoredKey(provider: ByokProviderId, key: string): void {
  if (typeof window === "undefined") return;
  const trimmed = key.trim();
  if (trimmed) window.localStorage.setItem(storageKey(provider), trimmed);
  else window.localStorage.removeItem(storageKey(provider));
}

export function clearStoredKey(provider: ByokProviderId): void {
  setStoredKey(provider, "");
}

/**
 * The headers a chat request carries. Evaluated at send time, not at mount, so
 * a key pasted in Settings works on the very next message without a reload.
 */
export function byokHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const p of BYOK_PROVIDERS) {
    const key = getStoredKey(p.id);
    if (key) headers[byokHeaderName(p.id)] = key;
  }
  return headers;
}
