import { z } from "zod";

import { auth } from "@/auth";
import { hostedUnavailable, jsonError, serverError, unauthorized } from "@/lib/api";
import { isHosted } from "@/lib/hosted";
import {
  HardwareInput,
  classifyAll,
  defaultCacheDirs,
  discoverLocalModels,
  probeEndpoint,
  userHardware,
} from "@/lib/local-models";

export const runtime = "nodejs";

/**
 * GET /api/local — discovered local models, and where we looked.
 *
 * No fit verdict here: classification needs the user's reported memory, and
 * IDEA never guesses at hardware (E-6.b). POST supplies it.
 */
export async function GET() {
  const session = await auth();
  if (!session) return unauthorized();
  // Scanning a serverless container's home directory would "discover" the
  // host's filesystem and report it as the user's — meaningless and misleading.
  if (isHosted()) return hostedUnavailable("Local model discovery");

  try {
    const models = await discoverLocalModels();
    return Response.json({
      models,
      searched: defaultCacheDirs(),
      note:
        models.length === 0
          ? "No local models found. Download one with Hugging Face or Ollama, or set HF_HOME if your cache lives elsewhere."
          : null,
    });
  } catch (e) {
    return serverError(e);
  }
}

const Body = z.object({
  hardware: HardwareInput,
  /** Optionally probe a local OpenAI-compatible server at the same time. */
  endpoint: z.url().optional(),
});

/**
 * POST /api/local — classify discovered models against reported hardware.
 *
 * Hardware comes from the request because it is the user's to state. `os` can
 * report installed RAM but not what is usable, and cannot see VRAM at all — a
 * confident wrong number is worse than asking (E-6.b).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  if (isHosted()) return hostedUnavailable("Local model classification");

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  try {
    const hardware = userHardware(body.hardware);
    const models = await discoverLocalModels();
    const results = classifyAll(models, hardware);

    return Response.json({
      hardware,
      results,
      summary: {
        good_fit: results.filter((r) => r.verdict === "good_fit").length,
        overkill: results.filter((r) => r.verdict === "overkill").length,
        too_large: results.filter((r) => r.verdict === "too_large").length,
      },
      endpoint: body.endpoint ? await probeEndpoint(body.endpoint) : null,
    });
  } catch (e) {
    return serverError(e);
  }
}
