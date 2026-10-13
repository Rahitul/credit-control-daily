"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  Eraser,
  List,
  Loader2,
  Search,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { askAssistant, type ChatActionResult } from "@/app/actions/chat";
import { allQuestions, WELCOME_EXAMPLES } from "@/lib/chat/intents";
import { useTheme } from "@/components/ThemeProvider";

type Msg = {
  role: "user" | "bot";
  text: string;
};

const WELCOME: Msg = {
  role: "bot",
  text:
    "Hi — I can answer live questions about outstanding, overdue, sales, and payments.\n\n" +
    "Try one of the suggestions below, or type your own.",
};

export function ChatWidget() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [open, setOpen] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [questionSearch, setQuestionSearch] = useState("");
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const [nudgeVisible, setNudgeVisible] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [seenState, setSeenState] = useState<ChatActionResult | undefined>(undefined);

  const [state, formAction, pending] = useActionState<ChatActionResult | undefined, FormData>(
    askAssistant,
    undefined
  );

  // Append each new action result once (render-time adjustment; no effect)
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok && state.answer) {
      setMessages((prev) => [...prev, { role: "bot", text: state.answer! }]);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, state, open, showQuestions]);

  useEffect(() => {
    if (!nudgeVisible || open) return;
    const timer = window.setTimeout(() => setNudgeVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [nudgeVisible, open]);

  const submitText = (text: string) => {
    const t = text.trim();
    if (!t || pending) return;
    setMessages((prev) => [...prev, { role: "user", text: t }]);
    setDraft("");
    setShowQuestions(false);
    setQuestionSearch("");
    const fd = new FormData();
    fd.set("message", t);
    formAction(fd);
  };

  const clearChat = () => {
    setMessages([WELCOME]);
    setDraft("");
  };

  const catalog = useMemo(() => allQuestions(), []);
  const filteredQuestions = useMemo(() => {
    const q = questionSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (item) =>
        item.example.toLowerCase().includes(q) || item.family.toLowerCase().includes(q)
    );
  }, [catalog, questionSearch]);

  const questionGroups = useMemo(() => {
    const map = new Map<string, typeof filteredQuestions>();
    for (const item of filteredQuestions) {
      const list = map.get(item.family) ?? [];
      list.push(item);
      map.set(item.family, list);
    }
    return [...map.entries()];
  }, [filteredQuestions]);

  const panelBg = isDark ? "bg-zinc-900 border-zinc-700" : "bg-white border-zinc-200";
  const userBubble = isDark
    ? "bg-indigo-600 text-white"
    : "bg-indigo-600 text-white";
  const botBubble = isDark
    ? "bg-zinc-800 text-zinc-100 border-zinc-700"
    : "bg-zinc-100 text-zinc-800 border-zinc-200";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";
  const headerBg = isDark ? "border-zinc-700 bg-zinc-800/80" : "border-zinc-200 bg-zinc-50";
  const titleColor = isDark ? "text-zinc-100" : "text-zinc-900";
  const borderSoft = isDark ? "border-zinc-600 bg-zinc-900 text-zinc-200" : "border-zinc-300 bg-white text-zinc-700";

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-3">
      {open ? (
        <div
          className={`flex h-[min(560px,calc(100vh-6rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-2xl ${panelBg}`}
        >
          <div
            className={`flex items-center justify-between border-b px-4 py-3 ${headerBg}`}
          >
            <div className="flex min-w-0 items-center gap-2">
              {showQuestions ? (
                <button
                  type="button"
                  onClick={() => setShowQuestions(false)}
                  className={`icon-btn !p-1.5 ${isDark ? "" : "!border-zinc-300 !text-zinc-600"}`}
                  aria-label="Back to chat"
                  title="Back to chat"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-white">
                  <Sparkles className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0">
                <p className={`truncate text-sm font-semibold ${titleColor}`}>
                  {showQuestions ? "All questions" : "Credit Assistant"}
                </p>
                <p className={`text-[11px] ${muted}`}>
                  {showQuestions
                    ? `${filteredQuestions.length} example${filteredQuestions.length === 1 ? "" : "s"}`
                    : "Live data · your credit books"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {!showQuestions ? (
                <button
                  type="button"
                  onClick={() => setShowQuestions(true)}
                  className={`icon-btn !p-1.5 ${isDark ? "" : "!border-zinc-300 !text-zinc-600"}`}
                  aria-label="All questions"
                  title="All questions"
                >
                  <List className="h-4 w-4" />
                </button>
              ) : null}
              {!showQuestions ? (
                <button
                  type="button"
                  onClick={clearChat}
                  disabled={messages.length <= 1 && !draft}
                  className={`icon-btn !p-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${
                    isDark ? "" : "!border-zinc-300 !text-zinc-600"
                  }`}
                  aria-label="Clear chat"
                  title="Clear chat"
                >
                  <Eraser className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (showQuestions) {
                    setShowQuestions(false);
                    setQuestionSearch("");
                  } else {
                    setOpen(false);
                  }
                }}
                className={`icon-btn !p-1.5 ${isDark ? "" : "!border-zinc-300 !text-zinc-600"}`}
                aria-label={showQuestions ? "Close questions" : "Close chat"}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {showQuestions ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className={`border-b px-3 py-2.5 ${isDark ? "border-zinc-800" : "border-zinc-200"}`}>
                <div className="relative">
                  <Search
                    className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${muted}`}
                  />
                  <input
                    value={questionSearch}
                    onChange={(e) => setQuestionSearch(e.target.value)}
                    maxLength={120}
                    autoComplete="off"
                    placeholder="Search questions…"
                    className="input-field w-full !py-2 pl-8 text-xs"
                    aria-label="Search questions"
                  />
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
                {questionGroups.length === 0 ? (
                  <p className={`text-xs ${muted}`}>
                    No questions match “{questionSearch.trim()}”.
                  </p>
                ) : (
                  questionGroups.map(([family, items]) => (
                    <div key={family}>
                      <p
                        className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${muted}`}
                      >
                        {family} ({items.length})
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {items.map((item) => (
                          <button
                            key={`${item.intent}-${item.example}`}
                            type="button"
                            disabled={pending}
                            onClick={() => submitText(item.example)}
                            className={`rounded-lg border px-2.5 py-2 text-left text-xs leading-snug transition-colors disabled:opacity-50 ${borderSoft} hover:border-indigo-500/60 hover:text-indigo-400`}
                          >
                            {item.example}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
                {messages.map((m, i) => (
                  <div
                    key={`${i}-${m.text.slice(0, 24)}`}
                    className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {m.role === "bot" ? (
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                          isDark ? "bg-zinc-700 text-indigo-300" : "bg-indigo-100 text-indigo-700"
                        }`}
                      >
                        <Bot className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.role === "user" ? userBubble : botBubble} ${
                        m.role === "user" ? "rounded-br-md" : "rounded-bl-md"
                      }`}
                    >
                      {renderBold(m.text)}
                    </div>
                    {m.role === "user" ? (
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                          isDark ? "bg-zinc-700 text-zinc-300" : "bg-zinc-200 text-zinc-600"
                        }`}
                      >
                        <User className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </div>
                ))}

                {pending ? (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Calculating…
                  </div>
                ) : null}

                {state && !state.ok && state.error ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      isDark
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {state.error}
                  </div>
                ) : null}

                {messages.length <= 2 ? (
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowQuestions(true)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                        isDark
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:border-indigo-400"
                          : "border-indigo-300 bg-indigo-50 text-indigo-700 hover:border-indigo-400"
                      }`}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      All questions
                    </button>
                    <div className="flex flex-wrap gap-1.5">
                      {WELCOME_EXAMPLES.slice(0, 8).map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          disabled={pending}
                          onClick={() => submitText(ex)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                            isDark
                              ? "border-zinc-600 bg-zinc-800 text-zinc-300 hover:border-indigo-500/50 hover:text-indigo-300"
                              : "border-zinc-300 bg-zinc-50 text-zinc-700 hover:border-indigo-400 hover:text-indigo-700"
                          }`}
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div ref={bottomRef} />
              </div>

              <form
                action={(formData) => {
                  const text = String(formData.get("message") ?? "").trim();
                  if (!text) return;
                  setMessages((prev) => [...prev, { role: "user", text }]);
                  setDraft("");
                  formAction(formData);
                }}
                className={`flex items-center gap-2 border-t px-3 py-2.5 ${
                  isDark ? "border-zinc-700 bg-zinc-900" : "border-zinc-200 bg-white"
                }`}
              >
                <input
                  name="message"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={500}
                  autoComplete="off"
                  placeholder="Ask about outstanding, overdue…"
                  className="input-field min-w-0 flex-1 !py-2 text-xs"
                />
                <button
                  type="submit"
                  disabled={pending || !draft.trim()}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Send"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          {nudgeVisible ? (
            <button
              type="button"
              onClick={() => {
                setNudgeVisible(false);
                setOpen(true);
              }}
              className="relative z-[1] max-w-[12.5rem] rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-500 via-violet-500 to-amber-400 px-3 py-2 text-left text-xs leading-snug text-white shadow-lg shadow-indigo-500/40 transition hover:from-indigo-400 hover:via-violet-400 hover:to-amber-300"
            >
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-white!">
                Credit Assistant
              </span>
              <span>Chat with me — ask about outstanding, overdue, sales…</span>
              <span
                aria-hidden
                className="absolute -bottom-1.5 right-3 h-3 w-3 rotate-45 bg-amber-400"
              />
            </button>
          ) : null}
          <div className="chat-fab-ring-wrap rounded-full">
            <span aria-hidden className="chat-fab-ring" />
            <button
              type="button"
              onClick={() => {
                setNudgeVisible(false);
                setOpen(true);
              }}
              className="group relative z-[1] flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-500"
              aria-label="Open credit assistant"
              title="Credit assistant"
            >
              <Bot className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function renderBold(text: string): React.ReactNode {
  // Split on **bold** segments
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
