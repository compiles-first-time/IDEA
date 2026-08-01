"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

/**
 * GitHub device-flow sign-in (S-52).
 *
 * Click → show an eight-character code and a github.com link → the user
 * approves there → we poll until GitHub says yes → a one-time handoff code
 * completes the Auth.js session. No OAuth app setup, no client secret, and
 * the GitHub token never enters this browser.
 */

type Phase =
  | { name: "idle" }
  | { name: "starting" }
  | { name: "waiting"; id: string; userCode: string; verificationUri: string; interval: number }
  | { name: "finishing" }
  | { name: "error"; message: string };

export function DeviceSignIn() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function start() {
    setPhase({ name: "starting" });
    try {
      const r = await fetch("/api/auth/device/start", { method: "POST" }).then((x) => x.json());
      if (!r.id) {
        setPhase({ name: "error", message: r.error ?? "Could not reach GitHub." });
        return;
      }
      setPhase({ name: "waiting", ...r });
      schedulePoll(r.id, r.interval);
    } catch (e) {
      setPhase({ name: "error", message: String(e) });
    }
  }

  function schedulePoll(id: string, interval: number) {
    timer.current = setTimeout(() => void poll(id, interval), Math.max(interval, 1) * 1000);
  }

  async function poll(id: string, interval: number) {
    try {
      const r = await fetch("/api/auth/device/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      }).then((x) => x.json());

      if (r.status === "authorized") {
        setPhase({ name: "finishing" });
        // The handoff is one-time; Auth.js trades it for the session cookie.
        await signIn("device", { handoff: r.handoff, redirectTo: "/chat" });
        return;
      }
      if (r.status === "denied") {
        setPhase({ name: "error", message: r.reason ?? "Sign-in was refused." });
        return;
      }
      if (r.status === "expired") {
        setPhase({ name: "error", message: "The code expired. Start again." });
        return;
      }
      schedulePoll(id, r.interval ?? interval);
    } catch {
      // A transient poll failure is not a verdict — try again on schedule.
      schedulePoll(id, interval);
    }
  }

  if (phase.name === "waiting") {
    return (
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-neutral-800 p-6 text-center">
        <p className="text-sm text-neutral-400">
          Enter this code at{" "}
          <a
            href={phase.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-neutral-100 underline underline-offset-4"
          >
            {phase.verificationUri.replace("https://", "")}
          </a>
        </p>
        <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-6 py-3 font-mono text-3xl tracking-[0.3em]">
          {phase.userCode}
        </div>
        <p className="text-xs text-neutral-500">
          Waiting for GitHub — this page finishes by itself once you approve.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={() => void start()}
        disabled={phase.name === "starting" || phase.name === "finishing"}
        className="rounded-lg bg-white px-5 py-2.5 font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-60"
      >
        {phase.name === "starting"
          ? "Contacting GitHub…"
          : phase.name === "finishing"
            ? "Signing you in…"
            : "Sign in with GitHub"}
      </button>
      {phase.name === "error" && (
        <p className="max-w-sm text-center text-xs text-red-400">{phase.message}</p>
      )}
    </div>
  );
}
