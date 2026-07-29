"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import { FileTree } from "@/components/file-tree";

type Repo = { full_name: string; private: boolean; default_branch: string; updated_at: string | null };
type TreeFile = { path: string; size: number };

export default function ChatWorkspace() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [activeRepo, setActiveRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [files, setFiles] = useState<TreeFile[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [attached, setAttached] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const [projects, setProjects] = useState<{ name: string; title: string }[]>([]);
  const [project, setProject] = useState("");
  const [convos, setConvos] = useState<{ id: string; title: string; updatedAt?: string }[]>([]);
  const [convoId, setConvoId] = useState("");

  const { messages, setMessages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";

  const contextString = useMemo(
    () =>
      Object.entries(attached)
        .map(([p, c]) => `--- ${p} ---\n${c}`)
        .join("\n\n"),
    [attached],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    void loadRepos();
    void (async () => {
      try {
        const r = await fetch("/api/projects").then((x) => x.json());
        setProjects(r.projects ?? []);
      } catch {
        // The picker simply stays empty; chat still works unsaved.
      }
    })();
  }, []);

  /**
   * Switch project.
   *
   * Conversations belong to a project, so this drops the current one and loads
   * that project's list. Carrying a conversation across projects silently is the
   * one wrong answer — it is how a chat about project A ends up filed under B.
   *
   * Done in the event handler rather than an effect on `project`: the switch is
   * a user action with a clear moment, and an effect would also fire on every
   * unrelated re-render that happened to change the dependency.
   */
  async function switchProject(next: string) {
    setProject(next);
    setConvoId("");
    setConvos([]);
    setMessages([]);
    if (!next) return;
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(next)}/conversations`).then((x) =>
        x.json(),
      );
      if (r.conversations) setConvos(r.conversations);
      else if (r.error) setNotice(r.error);
    } catch (e) {
      setNotice(String(e));
    }
  }

  /**
   * Open a stored conversation and put its turns back on screen.
   *
   * Only text parts are restored. `repo_context` turns record *which* file at
   * which SHA was attached — replaying them as chat bubbles would show a wall
   * of source. The attachment record stays in the archive, where replay reads
   * it; the screen shows the conversation.
   */
  async function openConversation(id: string) {
    setConvoId(id);
    if (!id) {
      setMessages([]);
      return;
    }
    try {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(project)}/conversations/${encodeURIComponent(id)}`,
      ).then((x) => x.json());

      if (r.error) {
        setNotice(r.error);
        return;
      }
      type StoredTurn = { role: string; content: { type: string; text?: string }[] };
      setMessages(
        (r.turns as StoredTurn[])
          .filter((t) => t.role === "user" || t.role === "assistant")
          .map((t, i) => ({
            id: `stored-${i}`,
            role: t.role as "user" | "assistant",
            parts: t.content
              .filter((p) => p.type === "text")
              .map((p) => ({ type: "text" as const, text: p.text ?? "" })),
          })),
      );
    } catch (e) {
      setNotice(String(e));
    }
  }

  async function loadRepos() {
    setReposLoading(true);
    setNotice("");
    try {
      const r = await fetch("/api/repos").then((x) => x.json());
      if (r.error) setNotice(r.error);
      else setRepos(r.repos ?? []);
    } catch (e) {
      setNotice(String(e));
    }
    setReposLoading(false);
  }

  async function openRepo(full: string) {
    setActiveRepo(full);
    setFiles([]);
    setAttached({});
    setFileFilter("");
    setTreeLoading(true);
    setNotice("");
    const [owner, repo] = full.split("/");
    try {
      const r = await fetch(
        `/api/repos/tree?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
      ).then((x) => x.json());
      if (r.error) setNotice(r.error);
      else {
        setBranch(r.branch ?? "");
        setFiles(r.files ?? []);
        if (r.truncated) setNotice("File list truncated by GitHub (very large repo).");
      }
    } catch (e) {
      setNotice(String(e));
    }
    setTreeLoading(false);
  }

  async function toggleAttach(path: string) {
    if (attached[path]) {
      setAttached((a) => {
        const c = { ...a };
        delete c[path];
        return c;
      });
      return;
    }
    const [owner, repo] = activeRepo.split("/");
    try {
      const q = `owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}&branch=${encodeURIComponent(branch)}`;
      const r = await fetch(`/api/repos/file?${q}`).then((x) => x.json());
      if (r.error) setNotice(r.error);
      else setAttached((a) => ({ ...a, [path]: r.content }));
    } catch (e) {
      setNotice(String(e));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");

    // Start the conversation on the first message rather than up front, so a
    // project you merely clicked into does not accumulate empty conversations.
    // The title is the opening message — a sidebar of "New chat" is unusable.
    let id = convoId;
    if (project && !id) {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(project)}/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: text.slice(0, 200) }),
        }).then((x) => x.json());

        if (r.conversation) {
          id = r.conversation.id;
          setConvoId(id);
          setConvos((c) => [r.conversation, ...c]);
        } else if (r.error) {
          // Say it now. Discovering later that nothing was saved is the failure
          // this whole story exists to fix.
          setNotice(`Not saving: ${r.error}`);
        }
      } catch (err) {
        setNotice(`Not saving: ${String(err)}`);
      }
    }

    sendMessage(
      { text },
      {
        body: {
          context: contextString || undefined,
          project: project || undefined,
          conversationId: id || undefined,
        },
      },
    );
  }

  const shownFiles = fileFilter
    ? files.filter((f) => f.path.toLowerCase().includes(fileFilter.toLowerCase()))
    : files;
  const attachedCount = Object.keys(attached).length;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Sidebar: repos + file tree */}
      <aside className="flex w-80 flex-none flex-col border-r border-neutral-800">
        <div className="flex items-center justify-between px-3 py-2 text-xs uppercase tracking-wide text-neutral-500">
          <span>Repositories</span>
          <button onClick={loadRepos} className="hover:text-neutral-300" title="Refresh">
            ↻
          </button>
        </div>

        {!activeRepo ? (
          <div className="min-h-0 flex-1 overflow-auto">
            {reposLoading && <div className="px-3 py-2 text-sm text-neutral-500">Loading…</div>}
            {repos.map((r) => (
              <button
                key={r.full_name}
                onClick={() => openRepo(r.full_name)}
                className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-neutral-900"
              >
                {r.full_name}
                {r.private && <span className="ml-1 text-[10px] text-neutral-500">private</span>}
              </button>
            ))}
            {!reposLoading && repos.length === 0 && (
              <div className="px-3 py-2 text-sm text-neutral-500">No repositories.</div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <button onClick={() => setActiveRepo("")} className="text-neutral-500 hover:text-neutral-300">
                ←
              </button>
              <span className="truncate font-medium">{activeRepo}</span>
              <span className="ml-auto text-[10px] text-neutral-500">{branch}</span>
            </div>
            <input
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="filter files…"
              className="mx-3 mb-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-neutral-600"
            />
            <div className="min-h-0 flex-1 overflow-auto">
              {treeLoading && <div className="px-3 py-2 text-sm text-neutral-500">Loading tree…</div>}
              <FileTree
                files={shownFiles.slice(0, 800)}
                attached={attached}
                onToggle={toggleAttach}
                filtering={fileFilter.trim().length > 0}
              />
            </div>
          </div>
        )}

        {attachedCount > 0 && (
          <div className="border-t border-neutral-800 px-3 py-2 text-xs text-neutral-400">
            {attachedCount} file{attachedCount > 1 ? "s" : ""} attached ·{" "}
            <button onClick={() => setAttached({})} className="text-neutral-500 hover:text-neutral-300">
              clear
            </button>
          </div>
        )}
      </aside>

      {/* Chat pane */}
      <section className="flex min-h-0 flex-1 flex-col">
        {/* Where this conversation is saved. Without a project there is nowhere
            to put it, so the bar says so rather than letting you find out by
            losing a chat. */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5 text-xs">
          <select
            value={project}
            onChange={(e) => void switchProject(e.target.value)}
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-neutral-600"
          >
            <option value="">No project — this chat won&apos;t be saved</option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.title || p.name}
              </option>
            ))}
          </select>

          {project && (
            <>
              <select
                value={convoId}
                onChange={(e) => void openConversation(e.target.value)}
                className="min-w-0 flex-1 truncate rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-neutral-600"
              >
                <option value="">New conversation</option>
                {convos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void openConversation("")}
                className="shrink-0 rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
                title="Start a new conversation in this project"
              >
                + New
              </button>
            </>
          )}

          <span className="ml-auto shrink-0 text-neutral-600">
            {project ? (convoId ? "saving to project" : "starts on first message") : "not saved"}
          </span>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {messages.length === 0 && (
            <div className="mx-auto mt-16 max-w-md text-center text-sm text-neutral-500">
              Ask anything. Attach repo files on the left to give Claude context.
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-blue-600 text-white" : "bg-neutral-900 text-neutral-100"
                }`}
              >
                {m.parts.map((part, i) => (part.type === "text" ? <span key={i}>{part.text}</span> : null))}
              </div>
            </div>
          ))}
          {error && <div className="text-sm text-red-400">Error: {error.message}</div>}
        </div>

        {notice && (
          <div className="border-t border-neutral-800 bg-neutral-900 px-4 py-1.5 text-xs text-amber-400">
            {notice}
          </div>
        )}

        <form onSubmit={submit} className="flex items-end gap-2 border-t border-neutral-800 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            rows={1}
            placeholder={attachedCount > 0 ? `Ask about ${attachedCount} attached file(s)…` : "Message IDEA…"}
            className="max-h-40 min-h-[40px] flex-1 resize-y rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            {busy ? "…" : "Send"}
          </button>
        </form>
      </section>
    </div>
  );
}
