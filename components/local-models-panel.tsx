"use client";

import { useEffect, useState } from "react";

/**
 * Local models (BR_03).
 *
 * `discoverLocalModels()` and `probeEndpoint()` were built and tested with no UI
 * — a scan nobody can trigger is not a feature. This is the caller.
 *
 * Where we looked is shown alongside what we found, because "no models" is only
 * actionable if you know which directories were searched (BR_03_BE-01).
 */

interface LocalModel {
  name: string;
  sizeBytes?: number;
  quant?: string | null;
  params?: number | null;
}

/** Endpoints a local runtime conventionally listens on. */
const CANDIDATE_ENDPOINTS = [
  { label: "Ollama", url: "http://127.0.0.1:11434/v1" },
  { label: "LM Studio", url: "http://127.0.0.1:1234/v1" },
  { label: "llama.cpp", url: "http://127.0.0.1:8080/v1" },
];

function gb(bytes?: number): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function LocalModelsPanel() {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [searched, setSearched] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [reachable, setReachable] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [probed, setProbed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Runs once on mount. `scan` is stable in practice but not by identity, and
    // depending on it would rescan on every render.
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function scan() {
    setScanning(true);
    setError("");
    try {
      const r = await fetch("/api/local").then((x) => x.json());
      if (r.error) setError(r.error);
      else {
        setModels(r.models ?? []);
        setSearched(r.searched ?? []);
        setNote(r.note ?? null);
      }
    } catch (e) {
      setError(String(e));
    }
    setScanning(false);
    void probe();
  }

  /**
   * Try the conventional local ports.
   *
   * Done from the browser rather than the server so a refused connection is just
   * a failed fetch. Nothing is sent to these endpoints beyond a models list
   * request.
   */
  async function probe() {
    const found: string[] = [];
    await Promise.all(
      CANDIDATE_ENDPOINTS.map(async (c) => {
        try {
          const res = await fetch(`${c.url}/models`, { signal: AbortSignal.timeout(1500) });
          if (res.ok) found.push(c.label);
        } catch {
          // Not running. Expected, not an error.
        }
      }),
    );
    setReachable(found);
    setProbed(true);
  }

  return (
    <section className="space-y-3 rounded-lg border border-neutral-800 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Local models</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Models already downloaded on this machine, and whether a local server is answering.
          </p>
        </div>
        <button
          onClick={() => void scan()}
          disabled={scanning}
          className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40"
        >
          {scanning ? "Scanning…" : "Rescan"}
        </button>
      </div>

      {/* "Found but not reachable" and "not found" have different fixes — start
          the server, versus download a model. They must not look alike
          (BR_03_BE-02). */}
      <div className="rounded border border-neutral-800 px-3 py-2 text-xs">
        {!probed ? (
          <span className="text-neutral-500">Checking for a running local server…</span>
        ) : reachable.length > 0 ? (
          <span className="text-emerald-400">
            Connected: {reachable.join(", ")} is answering on localhost.
          </span>
        ) : models.length > 0 ? (
          <span className="text-amber-400">
            {models.length} model{models.length === 1 ? "" : "s"} on disk, but no local server is
            answering. Start Ollama or LM Studio to use them.
          </span>
        ) : (
          <span className="text-neutral-500">No local server answering on the usual ports.</span>
        )}
      </div>

      {models.length > 0 && (
        <ul className="space-y-1">
          {models.slice(0, 25).map((m) => (
            <li key={m.name} className="flex justify-between gap-3 text-sm">
              <span className="truncate font-mono text-xs text-neutral-300">{m.name}</span>
              <span className="shrink-0 text-xs text-neutral-500">
                {gb(m.sizeBytes)}
                {m.quant ? ` · ${m.quant}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="text-xs text-neutral-500">{note}</p>}

      {searched.length > 0 && (
        <details className="text-xs text-neutral-600">
          <summary className="cursor-pointer hover:text-neutral-400">Where we looked</summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {searched.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
