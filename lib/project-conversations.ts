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
import { localStore } from "@/lib/local-store";
import { loadProjects } from "@/lib/project-store";
import { getProject, projectRoot } from "@/lib/projects";

/**
 * Conversations, scoped to a project (S-46, FR-9).
 *
 * The store and the canonical format were already built and tested; nothing
 * called them. This is the missing wire, and it is deliberately thin — if it
 * grew logic, the seam would be wrong.
 *
 * Scope is the point. A conversation belongs to a project, so switching projects
 * changes which conversations exist. Chat state that is not scoped to a project
 * will eventually be shown against the wrong one.
 */

export class ProjectConversationError extends Error {}

/** Resolve a project name to a conversation store rooted in its working tree. */
export async function contextForProject(
  projectName: string,
  ideaRoot = process.cwd(),
): Promise<StoreContext> {
  const project = getProject(await loadProjects(ideaRoot), projectName);
  if (!project) {
    throw new ProjectConversationError(`no project named "${projectName}"`);
  }
  const root = projectRoot(ideaRoot, project);
  return {
    store: localStore({ projectRoot: root }),
    // Kept for the shared store contract; a working tree has no branch to switch.
    branch: project.conversationBranch,
    projectName: project.name,
  };
}

export async function listForProject(
  projectName: string,
  ideaRoot = process.cwd(),
): Promise<ConversationMeta[]> {
  return listConversations(await contextForProject(projectName, ideaRoot));
}

export async function loadForProject(
  projectName: string,
  id: string,
  ideaRoot = process.cwd(),
): Promise<StoredConversation> {
  return loadConversation(await contextForProject(projectName, ideaRoot), id);
}

/**
 * Start a conversation.
 *
 * The title defaults to the first thing said rather than "New chat" — a sidebar
 * of identical titles is a list you cannot use, and the opening message is
 * almost always what the conversation is about.
 */
export async function startForProject(
  projectName: string,
  title: string,
  now = new Date(),
  ideaRoot = process.cwd(),
): Promise<ConversationMeta> {
  const ctx = await contextForProject(projectName, ideaRoot);
  return createConversation(ctx, { id: randomUUID(), title: titleFrom(title) }, now);
}

export async function appendForProject(
  projectName: string,
  id: string,
  turn: NewTurn,
  now = new Date(),
  ideaRoot = process.cwd(),
) {
  const ctx = await contextForProject(projectName, ideaRoot);
  return appendConversationTurn(ctx, id, turn, now);
}

/** First line, trimmed to something that fits a sidebar. */
export function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return "Untitled";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}
