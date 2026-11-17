"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import BudgetPanel from "../components/BudgetPanel";
import ExpenseCharts from "../components/ExpenseCharts";
import {
  EXPENSE_CATEGORIES,
  normalizeCategory,
  type ExpenseCategory,
} from "../lib/categories";
import { resolveCategory } from "../lib/expense-stats";
import { supabase, type ExpenseRow } from "../lib/supabase";

type Expense = {
  id: number;
  date: string;
  amount: number;
  description: string;
  category: ExpenseCategory;
};

type CategoryFilter = "전체" | ExpenseCategory;

type ChatMessage = {
  id: string;
  role: "user" | "ai";
  text: string;
};

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: ((event: Event) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(new Date(date + "T00:00:00"));
}

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    description: row.description,
    category: row.category
      ? normalizeCategory(row.category)
      : resolveCategory(row),
  };
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "ai",
      text: "안녕하세요! 글·음성·영수증 사진으로 지출을 기록하거나 통계를 물어보세요.\n예: 오늘 점심 12000원\n예: 이번달 총 지출이 얼마야?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [error, setError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("전체");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldSendRef = useRef(false);
  const transcriptRef = useRef("");
  const sendMessageRef = useRef<(text: string) => Promise<void>>(async () => {});

  const loadExpenses = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("expenses")
      .select("id, created_at, date, amount, description, category")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setExpenses([]);
      return;
    }

    setExpenses((data ?? []).map(toExpense));
  }, []);

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || sending) return;

      if (recognitionRef.current && listening) {
        shouldSendRef.current = false;
        recognitionRef.current.stop();
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          text,
        },
      ]);
      setInput("");
      setSending(true);
      setError("");

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        const data = (await response.json()) as {
          reply?: string;
          expense?: ExpenseRow | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            data.error || "AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
          );
        }

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "ai",
            text: data.reply || "저장을 확인했어요.",
          },
        ]);

        if (data.expense) {
          setExpenses((prev) => [toExpense(data.expense as ExpenseRow), ...prev]);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "오류가 발생했습니다.";
        setError(message);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "ai",
            text: `잠시 문제가 생겼어요. ${message}`,
          },
        ]);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [listening, sending],
  );

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    loadExpenses().finally(() => setLoadingExpenses(false));
  }, [loadExpenses]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, listening]);

  useEffect(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setListening(true);
      setError("");
      transcriptRef.current = "";
    };

    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTranscript += piece;
        } else {
          interimTranscript += piece;
        }
      }

      if (finalTranscript) {
        transcriptRef.current = `${transcriptRef.current} ${finalTranscript}`.trim();
      }

      const display = (transcriptRef.current || interimTranscript).trim();
      if (display) {
        setInput(display);
      }
    };

    recognition.onerror = (event) => {
      setListening(false);
      shouldSendRef.current = false;

      if (event.error === "not-allowed") {
        setError("마이크 권한을 허용해 주세요.");
      } else if (event.error === "no-speech") {
        setError("음성이 감지되지 않았어요. 다시 말해 주세요.");
      } else if (event.error !== "aborted") {
        setError("음성 인식 중 문제가 생겼어요.");
      }
    };

    recognition.onend = () => {
      setListening(false);
      const text = transcriptRef.current.trim() || inputRef.current?.value.trim() || "";
      const shouldSend = shouldSendRef.current || Boolean(text);
      shouldSendRef.current = false;

      if (shouldSend && text) {
        void sendMessageRef.current(text);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  async function handleReceiptUpload(file: File | null) {
    if (!file || sending || listening) return;

    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있어요.");
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: `영수증 사진 업로드: ${file.name}`,
      },
    ]);
    setSending(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("/api/receipt", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as {
        reply?: string;
        expense?: ExpenseRow | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || "영수증을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "ai",
          text: data.reply || "영수증을 확인했어요.",
        },
      ]);

      if (data.expense) {
        setExpenses((prev) => [toExpense(data.expense as ExpenseRow), ...prev]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "오류가 발생했습니다.";
      setError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "ai",
          text: `영수증 처리 중 문제가 생겼어요. ${message}`,
        },
      ]);
    } finally {
      setSending(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function toggleListening() {
    if (!speechSupported) {
      setError("이 브라우저는 음성 인식을 지원하지 않아요. Chrome을 사용해 주세요.");
      return;
    }

    if (sending) return;

    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (listening) {
      shouldSendRef.current = true;
      recognition.stop();
      return;
    }

    try {
      transcriptRef.current = "";
      shouldSendRef.current = false;
      recognition.start();
    } catch {
      setError("마이크를 시작할 수 없어요. 잠시 후 다시 시도해 주세요.");
      setListening(false);
    }
  }

  async function removeExpense(id: number) {
    const { error: deleteError } = await supabase.from("expenses").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setExpenses((prev) => prev.filter((item) => item.id !== id));
  }

  const filteredExpenses = useMemo(() => {
    if (categoryFilter === "전체") return expenses;
    return expenses.filter((item) => item.category === categoryFilter);
  }, [categoryFilter, expenses]);

  const filterOptions: CategoryFilter[] = ["전체", ...EXPENSE_CATEGORIES];

  return (
    <div className="mx-auto flex h-dvh w-full max-w-lg flex-col bg-background">
      <header className="shrink-0 border-b border-black/5 bg-surface px-5 py-4">
        <h1 className="text-center text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          AI 가계부 챗봇
        </h1>
      </header>

      <section className="chat-scroll shrink-0 space-y-3 overflow-y-auto bg-surface px-4 pb-3 pt-4 max-h-[46vh]">
        <BudgetPanel expenses={expenses} />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">저장된 지출</h2>
            <p className="text-xs text-muted">
              {loadingExpenses
                ? "불러오는 중"
                : filteredExpenses.length === 0
                  ? "없음"
                  : `${filteredExpenses.length}건`}
            </p>
          </div>

          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {filterOptions.map((option) => {
              const active = categoryFilter === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategoryFilter(option)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-accent text-white"
                      : "bg-background text-muted hover:text-foreground"
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>

          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {expenses.length === 0 && !loadingExpenses ? (
              <div className="w-full rounded-2xl bg-background px-4 py-5 text-sm text-muted">
                아직 저장된 지출이 없어요. 채팅·음성·영수증 사진으로 알려 주세요.
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="w-full rounded-2xl bg-background px-4 py-5 text-sm text-muted">
                {categoryFilter} 카테고리 지출이 없어요.
              </div>
            ) : (
              filteredExpenses.map((item) => (
                <article
                  key={item.id}
                  className="min-w-[148px] max-w-[180px] shrink-0 rounded-2xl bg-background px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.description}
                    </p>
                    <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] text-muted">
                      {item.category}
                    </span>
                  </div>
                  <p className="amount mt-2 text-lg font-medium text-foreground">
                    {formatAmount(item.amount)}
                    <span className="ml-0.5 text-xs font-normal text-muted">원</span>
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted">{formatDate(item.date)}</p>
                    <button
                      type="button"
                      onClick={() => removeExpense(item.id)}
                      className="text-xs text-muted transition-colors hover:text-foreground"
                    >
                      삭제
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">지출 차트</h2>
          <ExpenseCharts expenses={expenses} />
        </div>
      </section>

      <section className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[15px] leading-relaxed sm:text-base ${
                  message.role === "user"
                    ? "rounded-br-md bg-bubble-user text-foreground"
                    : "rounded-bl-md bg-bubble-ai text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                }`}
              >
                {message.text}
              </div>
            </div>
          ))}

          {listening ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-bubble-ai px-4 py-3 text-sm text-muted shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                듣고 있어요... 말씀해 주세요.
              </div>
            </div>
          ) : null}

          {sending ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-bubble-ai px-4 py-3 text-sm text-muted shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                처리 중...
              </div>
            </div>
          ) : null}

          <div ref={chatEndRef} />
        </div>
      </section>

      {error ? (
        <p className="shrink-0 px-4 pb-2 text-center text-xs text-muted">{error}</p>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-black/5 bg-surface px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              void handleReceiptUpload(file);
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || listening}
            aria-label="영수증 사진 업로드"
            className="flex h-12 min-h-[48px] w-12 shrink-0 items-center justify-center rounded-full bg-background text-foreground transition-colors duration-200 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 sm:h-11 sm:w-11"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 7h3l2-2h6l2 2h3v12H4V7Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>

          <button
            type="button"
            onClick={toggleListening}
            disabled={sending}
            aria-label={listening ? "음성 인식 종료" : "음성 인식 시작"}
            aria-pressed={listening}
            className={`flex h-12 min-h-[48px] w-12 shrink-0 items-center justify-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 sm:h-11 sm:w-11 ${
              listening
                ? "bg-accent text-white"
                : "bg-background text-foreground hover:bg-black/5"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
              <path d="M19 11a7 7 0 0 1-14 0" />
              <path d="M12 18v3" />
            </svg>
          </button>

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? "말씀해 주세요..." : "지출 입력 또는 질문해 보세요"}
            disabled={sending}
            className="h-12 min-h-[48px] flex-1 rounded-full bg-background px-4 text-base text-foreground outline-none placeholder:text-muted disabled:opacity-60 sm:h-11 sm:text-[15px]"
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || listening}
            className="h-12 min-h-[48px] min-w-[72px] rounded-full bg-accent px-4 text-[15px] font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 sm:h-11"
          >
            전송
          </button>
        </div>
      </form>
    </div>
  );
}
