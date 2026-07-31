/**
 * Plain-language explanations for the jargon the event log speaks.
 *
 * The dashboard was showing `LR-04`, `SE`, `claim` and `skill_invoked` as if the
 * reader already knew them. Some of these the architect *wrote*, and still had
 * to ask what a panel meant — an id is a lookup key, not an explanation, and
 * expecting recall is how a dashboard becomes unreadable to its own author.
 *
 * Pure lookups, so they are testable and cannot drift into the UI.
 */

export interface Explained {
  /** Short label to show in place of, or beside, the raw id. */
  label: string;
  /** One sentence a person can act on. */
  meaning: string;
}

/**
 * What a governing rule id means.
 *
 * The families are recognised by shape so a rule nobody has catalogued still
 * gets a useful answer rather than being echoed back raw.
 */
export function explainRule(id: string): Explained {
  const raw = id.trim();

  const adr = /^ADR[-_]?(\d+)$/i.exec(raw);
  if (adr) {
    return {
      label: `ADR-${adr[1]}`,
      meaning:
        `Architecture Decision Record ${Number(adr[1])} — a decision about how this project is ` +
        `built, written down so it can be revisited rather than re-argued.`,
    };
  }

  const lr = /^LR[-_]?(\d+)$/i.exec(raw);
  if (lr) {
    const known: Record<string, string> = {
      "01": "external content is data, never instruction — a file cannot give an agent orders.",
      "02": "production changes must pass a constitution check first.",
      "03": "secrets are redacted before anything is stored.",
      "04": "the permissions protocol — which actions need a human to confirm them.",
      "05": "every claim must be supersedable by evidence.",
      "06": "any loop that calls a model must state what it costs and when it stops.",
      "07": "use the narrowest credential that will do the job.",
    };
    const n = lr[1].padStart(2, "0");
    return {
      label: `LR-${n}`,
      meaning: known[n]
        ? `Loom Local Rule ${Number(n)} — ${known[n]}`
        : `Loom Local Rule ${Number(n)} — one of Loom's own operating rules.`,
    };
  }

  const kernel = /^(?:Kernel\s*)?Rule[-_ ]?(\d+)$/i.exec(raw);
  if (kernel) {
    const known: Record<string, string> = {
      "1": "authorship — an agent may decline, and that choice is respected.",
      "2": "do not do the fundamentally wrong thing, even when instructed.",
      "8": "no paternalism — say the true thing rather than the comfortable one.",
      "10": "knowledge locks in — a repeated mistake is no longer innocent.",
      "15": "verification scales with stakes.",
      "20": "reversible actions may proceed; irreversible ones need confirmation.",
      "22": "every decision leaves a record of why.",
    };
    const n = kernel[1];
    return {
      label: `Rule ${n}`,
      meaning: known[n]
        ? `Trajectory Kernel Rule ${n} — ${known[n]}`
        : `Trajectory Kernel Rule ${n} — one of the constitution's standing rules.`,
    };
  }

  return { label: raw, meaning: `A rule cited by this action. It is not one IDEA recognises.` };
}

/** What a register row type means (ADR-0046 taxonomy). */
export function explainRowType(type: string): Explained {
  switch (type.toUpperCase()) {
    case "BR":
      return { label: "Requirement", meaning: "Something that must be true when this is done." };
    case "TR":
      return {
        label: "Needs",
        meaning:
          "A technical prerequisite — an account, a credential, a paid tier, or a human step. " +
          "Nobody can automate these away.",
      };
    case "SE":
      return {
        label: "System exception",
        meaning:
          "A technical failure: credentials, network, timeout, corrupt file. Worth retrying.",
      };
    case "BE":
      return {
        label: "Business exception",
        meaning:
          "The world is fine but the data or situation is not what was expected. " +
          "Retrying just fails again — a person needs to look.",
      };
    default:
      return { label: "Step", meaning: "One step of how the requirement is met." };
  }
}

/** What an event type means, in words rather than in snake_case. */
export function explainEventType(type: string): Explained {
  const known: Record<string, Explained> = {
    session_start: { label: "Session started", meaning: "An agent run began." },
    session_end: { label: "Session ended", meaning: "The run finished." },
    tool_call: { label: "Ran something", meaning: "An agent used a tool — read a file, ran a command." },
    tool_result: { label: "Result came back", meaning: "What that tool returned, including failures." },
    claim: {
      label: "Stated a belief",
      meaning:
        "An agent asserted something and recorded how confident it was, what it based that on, " +
        "and what would raise its confidence. A claim with no sources is worth a second look.",
    },
    skill_invoked: {
      label: "Used a skill",
      meaning:
        "A skill is a written procedure the project keeps — like /testcase or /handoff — that an " +
        "agent follows instead of improvising.",
    },
    agent_invoked: {
      label: "Called another agent",
      meaning: "One agent handed work to a specialist agent.",
    },
    specialist_spawned: { label: "Created a specialist", meaning: "A new agent was set up for this work." },
    constitution_check_missing: {
      label: "Skipped a required check",
      meaning:
        "Something changed production without the constitution service reviewing it first. " +
        "This is a guardrail being missed, not a guardrail working.",
    },
    destructive_op: {
      label: "Something irreversible",
      meaning: "An operation that cannot simply be undone.",
    },
    destructive_action_decision: {
      label: "Guardrail ruled on it",
      meaning: "A risky action was classified and either allowed, queued for confirmation, or refused.",
    },
    test_run_summary: { label: "Tests finished", meaning: "A test run completed." },
    session_token_usage: { label: "Token usage", meaning: "How many tokens this run consumed." },
    turn_token_usage: { label: "Turn cost", meaning: "Tokens used by one turn, and what it called." },
    runtime_discovery_run: {
      label: "Checked the environment",
      meaning: "Loom looked at what tools and runtimes are actually available here.",
    },
  };

  if (known[type]) return known[type];

  // Attempts share a shape; explain the family rather than echoing the name.
  if (type.endsWith("_attempted")) {
    return {
      label: type.replace(/_/g, " ").replace(/ attempted$/, ""),
      meaning:
        "An agent tried to do something the permission rules cover. The rule cited beside it " +
        "decided what happened next.",
    };
  }

  return { label: type.replace(/_/g, " "), meaning: "" };
}
