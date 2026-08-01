import { z } from "zod";

import { hostedUnavailable, jsonError, serverError } from "@/lib/api";
import { pollDeviceLogin } from "@/lib/device-auth";
import { isHosted } from "@/lib/hosted";

export const runtime = "nodejs";

const Body = z.object({ id: z.uuid() });

/**
 * POST /api/auth/device/poll — has GitHub granted the sign-in yet? (S-52)
 *
 * The browser polls here; this server polls GitHub no faster than GitHub
 * asked. On success the response carries a one-time handoff code — the GitHub
 * token itself never reaches the browser.
 */
export async function POST(req: Request) {
  if (isHosted()) return hostedUnavailable("Device-code sign-in");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  try {
    return Response.json(await pollDeviceLogin(body.id));
  } catch (e) {
    return serverError(e);
  }
}
