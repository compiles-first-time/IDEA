import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  __resetDeviceAuthForTests,
  deviceClientId,
  pollDeviceLogin,
  redeemHandoff,
  startDeviceLogin,
  type DeviceAuthDeps,
} from "@/lib/device-auth";

/* ---------------------------------------------------------------------------
 * A scripted GitHub: each poll answers from a queue, so tests walk the flow
 * through GitHub's real response sequence without a network.
 * ------------------------------------------------------------------------- */

function fakeGitHub(tokenResponses: unknown[], login = "nick") {
  const startResponse = {
    device_code: "dev-123",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    interval: 0, // no throttle in tests
    expires_in: 900,
  };
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/login/device/code")) return Response.json(startResponse);
    if (url.includes("/login/oauth/access_token")) {
      return Response.json(tokenResponses.shift() ?? { error: "authorization_pending" });
    }
    if (url.includes("api.github.com/user")) return Response.json({ login });
    throw new Error(`unexpected fetch: ${url}`);
  };
  return fetchImpl;
}

function testDeps(overrides: Partial<DeviceAuthDeps> & { fetchImpl: typeof fetch }): {
  deps: DeviceAuthDeps;
  claimed: string[];
} {
  const claimed: string[] = [];
  // A clock that steps 2s per reading, so the GitHub poll throttle never
  // makes a test wait (or flake) on real time.
  let t = 0;
  return {
    claimed,
    deps: {
      env: { ALLOWED_LOGINS: "nick" },
      now: () => (t += 2000),
      claimOwner: async (login) => {
        claimed.push(login);
      },
      ...overrides,
    },
  };
}

beforeEach(() => __resetDeviceAuthForTests());

test("the shipped client id is used unless the operator set their own", () => {
  assert.equal(deviceClientId({ AUTH_GITHUB_ID: "my-own-app" }), "my-own-app");
  assert.notEqual(deviceClientId({}), "");
});

test("start returns the user-facing pieces and never the device code", async () => {
  const { deps } = testDeps({ fetchImpl: fakeGitHub([]) });
  const started = await startDeviceLogin(deps);
  assert.equal(started.userCode, "ABCD-1234");
  assert.equal(started.verificationUri, "https://github.com/login/device");
  assert.ok(started.id);
  assert.ok(!("device_code" in started), "the device code must stay server-side");
});

test("pending, then authorized: an allow-listed login gets a one-time handoff", async () => {
  const { deps } = testDeps({
    fetchImpl: fakeGitHub([{ error: "authorization_pending" }, { access_token: "gho_token" }]),
  });
  const { id } = await startDeviceLogin(deps);

  const first = await pollDeviceLogin(id, deps);
  assert.equal(first.status, "pending");

  const second = await pollDeviceLogin(id, deps);
  assert.equal(second.status, "authorized");
  const handoff = second.status === "authorized" ? second.handoff : "";

  const redeemed = redeemHandoff(handoff);
  assert.deepEqual(redeemed, { login: "nick", accessToken: "gho_token" });
  assert.equal(redeemHandoff(handoff), null, "a handoff redeems exactly once");
});

test("a login not on the allowlist is denied — the handoff never exists", async () => {
  const { deps } = testDeps({
    fetchImpl: fakeGitHub([{ access_token: "gho_token" }], "stranger"),
  });
  const { id } = await startDeviceLogin(deps);
  const result = await pollDeviceLogin(id, deps);
  assert.equal(result.status, "denied");
});

test("an empty allowlist on a local install is claimed by the first sign-in (E-10.d)", async () => {
  const { deps, claimed } = testDeps({
    fetchImpl: fakeGitHub([{ access_token: "gho_token" }]),
    env: { ALLOWED_LOGINS: "" },
  });
  const { id } = await startDeviceLogin(deps);
  const result = await pollDeviceLogin(id, deps);
  assert.equal(result.status, "authorized");
  assert.deepEqual(claimed, ["nick"], "the first login becomes the owner");
});

test("an empty allowlist on a HOSTED deployment claims nothing and denies (NFR-4)", async () => {
  const { deps, claimed } = testDeps({
    fetchImpl: fakeGitHub([{ access_token: "gho_token" }]),
    env: { ALLOWED_LOGINS: "", VERCEL: "1" },
  });
  const { id } = await startDeviceLogin(deps);
  const result = await pollDeviceLogin(id, deps);
  assert.equal(result.status, "denied");
  assert.deepEqual(claimed, [], "hosted mode never self-claims");
});

test("the user cancelling on GitHub reads as denied, said plainly", async () => {
  const { deps } = testDeps({ fetchImpl: fakeGitHub([{ error: "access_denied" }]) });
  const { id } = await startDeviceLogin(deps);
  const result = await pollDeviceLogin(id, deps);
  assert.equal(result.status, "denied");
  assert.match(result.status === "denied" ? result.reason : "", /cancelled/);
});

test("an expired code says expired, and an unknown session id does too", async () => {
  const { deps } = testDeps({ fetchImpl: fakeGitHub([{ error: "expired_token" }]) });
  const { id } = await startDeviceLogin(deps);
  assert.equal((await pollDeviceLogin(id, deps)).status, "expired");
  assert.equal((await pollDeviceLogin("nonsense", deps)).status, "expired");
});

test("slow_down stretches the polling interval instead of hammering GitHub", async () => {
  const { deps } = testDeps({
    fetchImpl: fakeGitHub([{ error: "slow_down", interval: 10 }]),
  });
  const { id } = await startDeviceLogin(deps);
  const result = await pollDeviceLogin(id, deps);
  assert.equal(result.status, "pending");
  assert.ok(result.status === "pending" && result.interval >= 10);
});
