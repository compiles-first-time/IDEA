import { randomUUID } from "node:crypto";

import { denialReason, isAllowed, parseAllowlist } from "@/lib/allowlist";
import { upsertEnvLocal } from "@/lib/env-local";
import { isHosted } from "@/lib/hosted";

/**
 * GitHub Device Flow sign-in for local installs (S-52, E-10.c/E-10.d).
 *
 * The distributable version of IDEA cannot ask every user to create their own
 * GitHub OAuth app — that step alone kills "download and go". The Device Flow
 * is GitHub's answer for installed applications (it is how the `gh` CLI signs
 * in): the app shows a short code, the user types it at github.com/login/device,
 * and GitHub hands the app a token. No callback URL, and **no client secret
 * anywhere** — only a client ID, which is public by design (it appears in every
 * ordinary OAuth redirect).
 *
 * Flow, and where the trust boundaries sit:
 *   1. `startDeviceLogin` — server asks GitHub for a device/user code pair.
 *      The device code never leaves this process; the browser gets an opaque
 *      session id and the user code to display.
 *   2. `pollDeviceLogin` — the browser polls us; we poll GitHub no faster than
 *      the interval GitHub set. On success the token stays server-side, the
 *      login is checked against the allowlist (E-10.d: on a local install with
 *      an *empty* allowlist, the first successful sign-in claims ownership and
 *      is written to `.env.local` — the binding is 127.0.0.1, so whoever
 *      completes the flow is at this machine's keyboard).
 *   3. `redeemHandoff` — a one-time code lets Auth.js' credentials callback
 *      collect the login + token and mint the same session cookie the web
 *      OAuth flow would have. Used once, then destroyed.
 *
 * Hosted deployments never use this module — their routes refuse (FR-15.3);
 * the web OAuth flow with a configured callback stays correct there.
 */

/** IDEA's shipped OAuth client ID (device-flow-enabled). Public, like gh's. */
const DEFAULT_CLIENT_ID = "Ov23liD2Mt0zFi9XQTU3";

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const SCOPE = "read:user user:email repo";

export function deviceClientId(env: Record<string, string | undefined> = process.env): string {
  return env.AUTH_GITHUB_ID?.trim() || DEFAULT_CLIENT_ID;
}

export type DevicePollStatus =
  | { status: "pending"; interval: number }
  | { status: "authorized"; handoff: string; login: string }
  | { status: "denied"; reason: string }
  | { status: "expired" };

interface PendingLogin {
  deviceCode: string;
  interval: number;
  expiresAt: number;
  lastGithubPoll: number;
  outcome?: DevicePollStatus;
}

/** In-memory: one local process, short-lived entries, nothing to persist. */
const pending = new Map<string, PendingLogin>();
const handoffs = new Map<string, { login: string; accessToken: string }>();

export interface DeviceAuthDeps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  /** Writes the first owner into ALLOWED_LOGINS (E-10.d). Injectable for tests. */
  claimOwner?: (login: string) => Promise<void>;
  now?: () => number;
}

function deps(d: DeviceAuthDeps) {
  return {
    fetchImpl: d.fetchImpl ?? fetch,
    env: d.env ?? process.env,
    claimOwner: d.claimOwner ?? ((login: string) => upsertEnvLocal("ALLOWED_LOGINS", login)),
    now: d.now ?? Date.now,
  };
}

export class DeviceAuthError extends Error {}

export async function startDeviceLogin(
  d: DeviceAuthDeps = {},
): Promise<{ id: string; userCode: string; verificationUri: string; interval: number }> {
  const { fetchImpl, env, now } = deps(d);

  const res = await fetchImpl(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: deviceClientId(env), scope: SCOPE }),
  });
  if (!res.ok) {
    throw new DeviceAuthError(`GitHub device authorization failed (${res.status})`);
  }
  const data = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    interval?: number;
    expires_in?: number;
    error?: string;
  };
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new DeviceAuthError(
      data.error === "device_flow_disabled"
        ? "This OAuth app does not have Device Flow enabled — tick “Enable Device Flow” in its GitHub settings."
        : `GitHub device authorization returned no code (${data.error ?? "unknown"})`,
    );
  }

  const id = randomUUID();
  pending.set(id, {
    deviceCode: data.device_code,
    interval: Math.max(data.interval ?? 5, 1),
    expiresAt: now() + (data.expires_in ?? 900) * 1000,
    lastGithubPoll: 0,
  });
  return {
    id,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: Math.max(data.interval ?? 5, 1),
  };
}

export async function pollDeviceLogin(id: string, d: DeviceAuthDeps = {}): Promise<DevicePollStatus> {
  const { fetchImpl, env, claimOwner, now } = deps(d);

  const entry = pending.get(id);
  if (!entry) return { status: "expired" };
  if (entry.outcome) return entry.outcome;
  if (now() > entry.expiresAt) {
    pending.delete(id);
    return { status: "expired" };
  }

  // The browser may poll us eagerly; GitHub must not be polled faster than
  // the interval it set, or it answers slow_down and stretches the wait.
  if (now() - entry.lastGithubPoll < entry.interval * 1000) {
    return { status: "pending", interval: entry.interval };
  }
  entry.lastGithubPoll = now();

  const res = await fetchImpl(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: deviceClientId(env),
      device_code: entry.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    interval?: number;
  };

  if (data.error === "authorization_pending") return { status: "pending", interval: entry.interval };
  if (data.error === "slow_down") {
    entry.interval = Math.max(entry.interval + 5, data.interval ?? entry.interval + 5);
    return { status: "pending", interval: entry.interval };
  }
  if (data.error === "expired_token") {
    pending.delete(id);
    return { status: "expired" };
  }
  if (data.error || !data.access_token) {
    const outcome: DevicePollStatus = {
      status: "denied",
      reason:
        data.error === "access_denied"
          ? "You cancelled the request on GitHub."
          : `GitHub refused the sign-in (${data.error ?? "no token returned"}).`,
    };
    entry.outcome = outcome;
    return outcome;
  }

  // Token in hand (server-side only). Who is this?
  const userRes = await fetchImpl(GITHUB_USER_URL, {
    headers: { authorization: `Bearer ${data.access_token}`, accept: "application/json" },
  });
  const user = (await userRes.json()) as { login?: string };
  const login = user.login?.trim() ?? "";
  if (!userRes.ok || !login) {
    const outcome: DevicePollStatus = {
      status: "denied",
      reason: "GitHub did not say who you are — the sign-in cannot be checked.",
    };
    entry.outcome = outcome;
    return outcome;
  }

  // The allowlist decision, re-read fresh each time (a claim may just have
  // happened). E-10.d: an empty list on a local install is claimed by the
  // first person to finish this flow — they are at this machine's keyboard.
  const allowlist = parseAllowlist(env.ALLOWED_LOGINS);
  if (allowlist.length === 0 && !isHosted(env)) {
    await claimOwner(login);
    console.log(`[auth] first sign-in — "${login}" is now this install's owner (ALLOWED_LOGINS).`);
  } else if (!isAllowed(login, allowlist)) {
    console.warn(`[auth] device sign-in refused: ${denialReason(login, allowlist)}`);
    const outcome: DevicePollStatus = {
      status: "denied",
      reason: `"${login}" is not on this install's allowlist.`,
    };
    entry.outcome = outcome;
    return outcome;
  }

  const handoff = randomUUID();
  handoffs.set(handoff, { login, accessToken: data.access_token });
  const outcome: DevicePollStatus = { status: "authorized", handoff, login };
  entry.outcome = outcome;
  return outcome;
}

/** One-time: the credentials callback trades the handoff for the identity. */
export function redeemHandoff(handoff: string): { login: string; accessToken: string } | null {
  const entry = handoffs.get(handoff);
  if (entry) handoffs.delete(handoff);
  return entry ?? null;
}

/** Test seam — a fresh module state between tests. */
export function __resetDeviceAuthForTests(): void {
  pending.clear();
  handoffs.clear();
}
