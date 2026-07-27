import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { ModelsResponse } from "@/lib/contracts/api";
import { defaultModelId, enabledModels, loadRegistry } from "@/lib/registry";

export const runtime = "nodejs";

/**
 * GET /api/models — the registry, as the picker sees it (S-05, FR-4.1).
 *
 * `endpoint` is stripped: for a local model it is a URL the user owns, but it
 * could carry a token, and the browser has no need for it (NFR-6).
 */
export async function GET() {
  const session = await auth();
  if (!session) return unauthorized();

  try {
    const registry = loadRegistry();
    const body = ModelsResponse.parse({
      models: enabledModels(registry).map((m) => ({
        id: m.id,
        provider: m.provider,
        label: m.label,
        tier: m.tier,
        inputWeight: m.inputWeight,
        outputWeight: m.outputWeight,
        contextWindow: m.contextWindow,
      })),
      defaultId: defaultModelId(registry),
    });
    return Response.json(body);
  } catch (e) {
    // A malformed registry is a deployment fault, not a client fault.
    if (e instanceof Error && e.message.startsWith("invalid model registry")) {
      return jsonError(e.message, 500, "registry_invalid");
    }
    return serverError(e);
  }
}
