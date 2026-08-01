import { hostedUnavailable, serverError } from "@/lib/api";
import { DeviceAuthError, startDeviceLogin } from "@/lib/device-auth";
import { isHosted } from "@/lib/hosted";

export const runtime = "nodejs";

/**
 * POST /api/auth/device/start — begin a GitHub device-flow sign-in (S-52).
 *
 * Unauthenticated by nature (it *is* the way in), local-only by policy: a
 * hosted deployment has a proper OAuth callback and never needs this. The
 * response carries an opaque session id and what the user must see — never
 * the device code itself, which stays server-side.
 */
export async function POST() {
  if (isHosted()) return hostedUnavailable("Device-code sign-in");

  try {
    const started = await startDeviceLogin();
    return Response.json(started);
  } catch (e) {
    if (e instanceof DeviceAuthError) return serverError(e);
    return serverError(e);
  }
}
