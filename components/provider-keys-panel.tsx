"use client";

import { useEffect, useState } from "react";

import { BYOK_PROVIDERS, type ByokProviderId } from "@/lib/byok";
import { clearStoredKey, getStoredKey, setStoredKey } from "@/lib/byok-client";

interface KeyStatus {
  provider: string;
  label: string;
  env: string;
  configured: boolean;
  hint: string | null;
}

/**
 * Provider API keys.
 *
 * A key is sent once and never rendered back. The panel shows only whether a key
 * exists and its last four characters — enough to tell two keys apart, useless
 * if the screen is shared. Re-populating a form field with a stored key is how
 * keys end up in screenshots and support tickets (NFR-6).
 *
 * Two homes for a key, decided by the deployment (FR-15.2):
 * - local: `.env.local` on the machine, via POST /api/keys — unchanged.
 * - hosted: this browser's localStorage, never the server. Each chat request
 *   carries the key as a header; closing the account is deleting the key here.
 */
export function ProviderKeysPanel({ hosted = false }: { hosted?: boolean }) {
  return hosted ? <ByokPanel /> : <EnvKeysPanel />;
}

/* ------------------------------------------------------------------------- */
/* Hosted: keys stay in the browser                                           */
/* ------------------------------------------------------------------------- */

function ByokPanel() {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Last-four hints, read from localStorage after mount (SSR has no storage).
  const [hints, setHints] = useState<Record<string, string>>({});

  useEffect(() => {
    refreshHints(setHints);
  }, []);

  function save(provider: ByokProviderId) {
    const key = (drafts[provider] ?? "").trim();
    if (!key) return;
    setStoredKey(provider, key);
    // Clear immediately — the key should not linger in the DOM.
    setDrafts((d) => ({ ...d, [provider]: "" }));
    refreshHints(setHints);
  }

  function forget(provider: ByokProviderId) {
    clearStoredKey(provider);
    refreshHints(setHints);
  }

  return (
    <section className="space-y-3 rounded-lg border border-neutral-800 p-4">
      <div>
        <h2 className="text-sm font-medium">Your API keys</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Stored in <em>this browser</em> only — never on the server. Each message you send
          carries your key straight to the provider you picked; nothing is billed to anyone
          else. Clearing a key here removes it completely.
        </p>
      </div>

      <ul className="space-y-3">
        {BYOK_PROVIDERS.map((p) => {
          const hint = hints[p.id] ?? "";
          return (
            <li key={p.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm">{p.label}</span>
                <span className="text-xs text-neutral-500">
                  {hint ? (
                    <span className="text-emerald-400">in this browser · …{hint}</span>
                  ) : (
                    <span className="text-amber-400">not set</span>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={drafts[p.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  placeholder={hint ? "paste a new key to replace" : p.placeholder}
                  className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs outline-none focus:border-neutral-600"
                />
                <button
                  onClick={() => save(p.id)}
                  disabled={!(drafts[p.id] ?? "").trim()}
                  className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40"
                >
                  {hint ? "Replace" : "Save"}
                </button>
                {hint && (
                  <button
                    onClick={() => forget(p.id)}
                    className="rounded border border-neutral-800 px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
                  >
                    Clear
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function refreshHints(set: (h: Record<string, string>) => void): void {
  const next: Record<string, string> = {};
  for (const p of BYOK_PROVIDERS) {
    const key = getStoredKey(p.id);
    if (key.length >= 4) next[p.id] = key.slice(-4);
  }
  set(next);
}

/* ------------------------------------------------------------------------- */
/* Local: keys live in .env.local, via the API                                */
/* ------------------------------------------------------------------------- */

function EnvKeysPanel() {
  const [statuses, setStatuses] = useState<KeyStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Inline rather than calling a function declared below: the status list is
    // read once on mount and never re-fetched, so there is nothing to share.
    void (async () => {
      try {
        const r = await fetch("/api/keys").then((x) => x.json());
        if (r.providers) setStatuses(r.providers);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  async function save(provider: string) {
    const key = (drafts[provider] ?? "").trim();
    if (!key) return;
    setBusy(provider);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, key }),
      }).then((x) => x.json());

      if (r.error) setError(r.error);
      else {
        setStatuses(r.providers);
        // Clear immediately — the key should not linger in the DOM.
        setDrafts((d) => ({ ...d, [provider]: "" }));
        setNotice("Saved to .env.local.");
      }
    } catch (e) {
      setError(String(e));
    }
    setBusy("");
  }

  return (
    <section className="space-y-3 rounded-lg border border-neutral-800 p-4">
      <div>
        <h2 className="text-sm font-medium">Provider API keys</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Stored in <code className="text-neutral-400">.env.local</code> on this machine, never in
          a conversation or a config file. Keys are write-only here — IDEA will show you the last
          four characters and nothing more.
        </p>
      </div>

      <ul className="space-y-3">
        {statuses.map((s) => (
          <li key={s.provider} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm">{s.label}</span>
              <span className="text-xs text-neutral-500">
                {s.configured ? (
                  <span className="text-emerald-400">configured · …{s.hint}</span>
                ) : (
                  <span className="text-amber-400">not set</span>
                )}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={drafts[s.provider] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [s.provider]: e.target.value }))}
                placeholder={s.configured ? "paste a new key to replace" : "paste your key"}
                className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs outline-none focus:border-neutral-600"
              />
              <button
                onClick={() => save(s.provider)}
                disabled={busy === s.provider || !(drafts[s.provider] ?? "").trim()}
                className="rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40"
              >
                {busy === s.provider ? "Saving…" : s.configured ? "Replace" : "Save"}
              </button>
            </div>
            <p className="text-[10px] text-neutral-600">
              Sets <code>{s.env}</code>
            </p>
          </li>
        ))}
      </ul>

      {notice && <p className="text-xs text-emerald-400">{notice}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
