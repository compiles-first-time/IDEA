"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import { FileTree } from "@/components/file-tree";
import { Markdown } from "@/components/markdown";
import {
  describeDecision,
  reconcileSelection,
  turnBody,
  type ChatMode,
  type PickableModel,
} from "@/lib/chat-routing";

type TreeFile = { path: string; size: number };

export default function ChatWorkspace() {
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
  const [models, setModels] = useState<PickableModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<ChatMode>("auto");

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
    void (async () => {
      try {
        const r = await fetch("/api/projects").then((x) => x.json());
        setProjects(r.projects ?? []);
      } catch {
        // The picker simply stays empty; chat still works unsaved.
      }
    })();
    void (async () => {
      try {
        const r = await fetch("/api/models").then((x) => x.json());
        const list: PickableModel[] = r.models ?? [];
        setModels(list);
        // A stored selection that no longer exists would fail every turn
        // (BR_02_BE-02); reconcile against what this build can actually reach.
        const stored = localStorage.getItem("idea.modelId") ?? "";
        const { modelId: next, reset } = reconcileSelection(stored, list, r.defaultId);
        setModelId(next);
        if (reset) setNotice(stored + " is no longer available — using " + next + ".");
      } catch {
        setNotice("Could not load the model list. Chat still works with the default model.");
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
    setFiles([]);
    setAttached({});
    setFileFilter("");
    if (!next) return;

    // The sidebar shows THIS project's files. Previously it listed GitHub repos
    // independently of the selection, so browsing a repo there looked like
    // picking a project and changed nothing about the answer.
    setTreeLoading(true);
    try {
      const t = await fetch(`/api/projects/${encodeURIComponent(next)}/files`).then((x) => x.json());
      if (t.error) setNotice(t.error);
      else {
        setFiles(t.files ?? []);
        if (t.truncated) setNotice("Large project — file list truncated. The model can still search all of it.");
      }
    } catch (e) {
      setNotice(String(e));
    }
    setTreeLoading(false);
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

  async function toggleAttach(path: string) {
    if (attached[path]) {
      setAttached((a) => {
        const c = { ...a };
        delete c[path];
        return c;
      });
      return;
    }
    if (!project) return;
    try {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(project)}/files?path=${encodeURIComponent(path)}`,
      ).then((x) => x.json());
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
          ...turnBody({ mode, modelId, models }),
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
      {/*
        Sidebar: projects, then the selected project's files.

        It used to list GitHub repositories, independently of the project
        dropdown — two controls that both read as "choose what we're working
        on", where only the dropdown affected the answer. Opening a repo here
        felt like picking a project and did nothing. Now it *is* the project
        picker.
      */}
      <aside className="flex w-80 flex-none flex-col border-r border-neutral-800">
        <div className="flex items-center justify-between px-3 py-2 text-xs uppercase tracking-wide text-neutral-500">
          <span>{project ? project : "Projects"}</span>
          {project && (
            <button
              onClick={() => void switchProject("")}
              className="hover:text-neutral-300"
              title="Back to projects"
            >
              ←
            </button>
          )}
        </div>

        {!project ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <p className="px-3 pb-2 text-xs text-neutral-500">
              Pick a project. The model can read and search it, and the chat is saved there.
            </p>
            {projects.map((p) => (
              <button
                key={p.name}
                onClick={() => void switchProject(p.name)}
                className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-neutral-900"
              >
                {p.title || p.name}
              </button>
            ))}
            {projects.length === 0 && (
              <div className="px-3 py-2 text-sm text-neutral-500">
                No projects registered. Add one on the Projects page.
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="px-3 pb-1 text-[10px] text-neutral-600">
              Attaching is optional — the model can search this project itself.
            </p>
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

        {/* Routing (BR_01, BR_02). Before this, chat sent neither mode nor model,
            so the chain and the budget were never consulted. */}
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5 text-xs">
          <div className="flex overflow-hidden rounded border border-neutral-800">
            {(["auto", "manual"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  mode === m
                    ? "bg-neutral-800 px-2 py-1 text-neutral-100"
                    : "px-2 py-1 text-neutral-500 hover:text-neutral-300"
                }
                title={
                  m === "auto"
                    ? "IDEA picks a model using your fallback chain and budget"
                    : "You pick the model"
                }
              >
                {m}
              </button>
            ))}
          </div>

          <select
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value);
              localStorage.setItem("idea.modelId", e.target.value);
            }}
            // In auto mode the router chooses; an enabled control that changes
            // nothing would misrepresent what the turn does (BR_02_Picker).
            disabled={mode === "auto" || models.length === 0}
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-neutral-600 disabled:opacity-40"
          >
            {models.length === 0 && <option value="">no models available</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <span className="ml-auto truncate text-neutral-600">
            {mode === "auto" ? "chain + budget decide" : "your choice"}
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
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "whitespace-pre-wrap bg-blue-600 text-white"
                    : "bg-neutral-900 text-neutral-100"
                }`}
              >
                {/* The users own words render as typed; the models answer is
                    markdown, which is what it writes. */}
                {m.role === "user" ? (
                  m.parts.map((part, i) => (part.type === "text" ? <span key={i}>{part.text}</span> : null))
                ) : (
                  <Markdown
                    text={m.parts
                      .map((part) => (part.type === "text" ? part.text : ""))
                      .join("")}
                  />
                )}

                {/* Which model answered, and what the router skipped to get
                    there. This was computed and streamed all along; nothing
                    read it (BR_01_ShowDecision). */}
                {m.role === "assistant" && (() => {
                  const meta = m.metadata as { routing?: Parameters<typeof describeDecision>[0] } | undefined;
                  const line = describeDecision(meta?.routing);
                  return line ? (
                    <div className="mt-1.5 border-t border-neutral-800 pt-1 text-[10px] text-neutral-500">
                      {line}
                    </div>
                  ) : null;
                })()}
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
