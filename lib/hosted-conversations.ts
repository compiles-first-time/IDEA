import { randomUUID } from "node:crypto";

import {
  appendConversationTurn,
  createConversation,
  listConversations,
  loadConversation,
  type StoreContext,
  type StoredConversation,
} from "@/lib/conversation-store";
import type { ConversationMeta, NewTurn } from "@/lib/conversation";
import { isHosted } from "@/lib/hosted";
import { titleFrom } from "@/lib/project-conversations";
import { supabaseConfig, supabaseFileStore } from "@/lib/supabase-store";

/**
 * Conversations, scoped to a signed-in user on a hosted deployment (S-51).
 *
 * The hosted counterpart of `lib/project-conversations.ts`, and deliberately
 * just as thin: locally a conversation belongs to a project's repo; hosted it
 * belongs to a GitHub login, namespaced in the Supabase store. The logic —
 * stamping, redaction, retries — is `lib/conversation-store.ts` either way.
 */

export class HostedConversationError extends Error {}

/**
 * Whether this deployment saves conversations at all. False on a local
 * install (the project repo is the store there) and on a hosted deployment
 * with no Supabase wiring (E-15.d's original state, still supported).
 */
export function hostedPersistenceAvailable(): boolean {
  return isHosted() && supabaseConfig() !== null;
}

function contextForLogin(login: string): StoreContext {
  const cfg = supabaseConfig();
  if (!cfg) {
    throw new HostedConversationError("hosted conversation store is not configured");
  }
  if (!login) {
    throw new HostedConversationError("hosted conversations need a signed-in login");
  }
  return {
    store: supabaseFileStore(cfg, login),
    // Carried for the shared contract; the login namespace is the isolation.
    branch: "hosted",
    projectName: "hosted",
  };
}

export async function listForLogin(login: string): Promise<ConversationMeta[]> {
  return listConversations(contextForLogin(login));
}

export async function loadForLogin(login: string, id: string): Promise<StoredConversation> {
  return loadConversation(contextForLogin(login), id);
}

export async function startForLogin(
  login: string,
  title: string,
  now = new Date(),
): Promise<ConversationMeta> {
  return createConversation(contextForLogin(login), { id: randomUUID(), title: titleFrom(title) }, now);
}

/**
 * Append a turn. `extraSecrets` carries the requester's BYOK key values so
 * redaction scrubs them if one was ever pasted into the chat itself — the
 * keys are not otherwise present in any turn (E-15.b).
 */
export async function appendForLogin(
  login: string,
  id: string,
  turn: NewTurn,
  extraSecrets: readonly string[] = [],
  now = new Date(),
) {
  return appendConversationTurn(contextForLogin(login), id, turn, now, extraSecrets);
}
