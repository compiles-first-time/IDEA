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

/** What a question-answering turn is allowed to do. */
export const CHAT_TOOL_NAMES = ["search_files", "read_file", "list_files"] as const;

export interface ChatToolOptions {
  scope: ScopeContext;
  /** Called for every executed tool call, so the UI can show the work. */
  onCall?: (event: { tool: string; args: unknown; ok: boolean }) => void;
}

/**
 * Build the AI SDK tool set for a project.
 *
 * Every call still passes `gate()` before executing. That is not belt-and-braces
 * — the model chooses these arguments, and a path outside the project is refused
 * outright rather than becoming a prompt someone might wave through.
 */
export function chatTools({ scope, onCall }: ChatToolOptions): Record<string, Tool> {
  const out: Record<string, Tool> = {};

  for (const def of TOOL_DEFINITIONS) {
    if (!CHAT_TOOL_NAMES.includes(def.name as (typeof CHAT_TOOL_NAMES)[number])) continue;

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

        if (verdict.decision !== "allow") {
          onCall?.({ tool: def.name, args, ok: false });
          // Returned as a result, not thrown: the model should read the refusal
          // and choose differently, which is more useful than a dead turn.
          return { ok: false, error: verdict.reason };
        }

        const result = await executeTool({ id: `${def.name}-${Date.now()}`, ...call }, { scope });
        onCall?.({ tool: def.name, args, ok: result.ok });
        return result.ok ? result.result : { ok: false, error: String(result.result) };
      },
    });
  }

  return out;
}
