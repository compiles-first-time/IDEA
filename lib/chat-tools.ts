import { tool, type Tool } from "ai";

import { gate } from "@/lib/permissions";
import type { ScopeContext } from "@/lib/permissions";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/tools";

/**
 * Repo tools for chat (S-49).
 *
 * The registry, the executor, and the Rule 20 gate were already built and
 * tested. This is the wire from the chat route — the same missing-caller pattern
 * as S-46, and the reason "I don't have access to your files" was the answer
 * when the project was sitting right there on disk.
 *
 * **Read-only by default.** Chat gets the tools that answer questions: search,
 * read, list. `write_file` and `bash` are deliberately excluded here — not
 * because agents may not have them (09-agent-authority says they may), but
 * because a chat turn has nowhere to surface a confirmation prompt. Rule 20 says
 * destructive operations require confirmation; a surface that cannot ask must
 * not act. Wiring those belongs with the confirmation UI, not before it.
 */

/** Read-only: always available, because reading is reversible. */
export const CHAT_TOOL_NAMES = ["search_files", "read_file", "list_files"] as const;

/**
 * Tools that can change things (BR_04).
 *
 * Available only when the caller can carry a confirmation back to a human. The
 * axis is reversibility, not capability (09-agent-authority): these are not
 * forbidden, they are gated.
 */
export const MUTATING_TOOL_NAMES = ["write_file", "bash"] as const;

export interface ChatToolOptions {
  scope: ScopeContext;
  /** Called for every executed tool call, so the UI can show the work. */
  onCall?: (event: { tool: string; args: unknown; ok: boolean }) => void;
  /**
   * Include the mutating tools.
   *
   * Requires `confirm`: Rule 20 says destructive operations need confirmation,
   * so a surface that cannot ask must not offer them.
   */
  allowMutations?: boolean;
  /**
   * Ask a human. Resolves true to proceed.
   *
   * Absent means nobody is there — a destructive call then **pauses**, it does
   * not proceed (BR_04_BE-03).
   */
  confirm?: (request: { tool: string; args: unknown; reason: string }) => Promise<boolean>;
}

/**
 * Build the AI SDK tool set for a project.
 *
 * Every call still passes `gate()` before executing. That is not belt-and-braces
 * — the model chooses these arguments, and a path outside the project is refused
 * outright rather than becoming a prompt someone might wave through.
 */
export function chatTools({
  scope,
  onCall,
  allowMutations = false,
  confirm,
}: ChatToolOptions): Record<string, Tool> {
  const out: Record<string, Tool> = {};

  // Mutating tools require a way to ask. Offering them without one would mean
  // every destructive call dead-ends at a pause the user never sees.
  const mutationsAvailable = allowMutations && typeof confirm === "function";
  const allowed: string[] = [
    ...CHAT_TOOL_NAMES,
    ...(mutationsAvailable ? MUTATING_TOOL_NAMES : []),
  ];

  for (const def of TOOL_DEFINITIONS) {
    if (!allowed.includes(def.name)) continue;

    out[def.name] = tool({
      description: def.description,
      inputSchema: def.parameters,
      execute: async (args: Record<string, unknown>) => {
        const call = { tool: def.name, args };
        const verdict = gate({
          call,
          scope,
          paths: def.pathsFor(args),
          humanPresent: true,
        });

        // A scope violation refuses outright and never becomes a prompt someone
        // could wave through (E-11.e, BR_04_BE-01). `gate()` already returns
        // "refuse" for these; the point is that "confirm" is not reachable from
        // a scope failure.
        if (verdict.decision === "refuse") {
          onCall?.({ tool: def.name, args, ok: false });
          // Returned as a result, not thrown: the model should read the refusal
          // and choose differently, which is more useful than a dead turn.
          return { ok: false, error: verdict.reason };
        }

        if (verdict.decision === "confirm") {
          if (!confirm) {
            // Rule 20 with nobody to ask means stop (BR_04_BE-03).
            onCall?.({ tool: def.name, args, ok: false });
            return {
              ok: false,
              error: `Paused: ${verdict.reason} No one is available to confirm it.`,
            };
          }
          const approved = await confirm({ tool: def.name, args, reason: verdict.reason });
          if (!approved) {
            onCall?.({ tool: def.name, args, ok: false });
            // A decline is an answer, not a failure — the model should adapt
            // rather than treat this as a broken tool (BR_04_BE-02).
            return { ok: false, declined: true, error: "The user declined this action." };
          }
        }

        const result = await executeTool({ id: `${def.name}-${Date.now()}`, ...call }, { scope });
        onCall?.({ tool: def.name, args, ok: result.ok });
        return result.ok ? result.result : { ok: false, error: String(result.result) };
      },
    });
  }

  return out;
}
