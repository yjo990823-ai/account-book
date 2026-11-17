"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { supabase, type ExpenseRow } from "../lib/supabase";

type Expense = {
  id: number;
  date: string;
  amount: number;
  description: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "ai";
  text: string;
};

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
  };
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "ai",
      text: "안녕하세요! 지출을 말하거나 통계를 물어보세요.\n예: 오늘 점심 12000원\n예: 이번달 총 지출이 얼마야?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadExpenses = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("expenses")
      .select("id, created_at, date, amount, description")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setExpenses([]);
      return;
    }

    setExpenses((data ?? []).map(toExpense));
  }, []);

  useEffect(() => {
    loadExpenses().finally(() => setLoadingExpenses(false));
  }, [loadExpenses]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };

    setMessages((prev) => [...prev, userMessage]);
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
  }

  async function removeExpense(id: number) {
    const { error: deleteError } = await supabase.from("expenses").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setExpenses((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-lg flex-col bg-background">
      <header className="shrink-0 border-b border-black/5 bg-surface px-5 py-4">
        <h1 className="text-center text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          AI 가계부 챗봇
        </h1>
      </header>

      <section className="shrink-0 bg-surface px-4 pb-3 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">저장된 지출</h2>
          <p className="text-xs text-muted">
            {loadingExpenses
              ? "불러오는 중"
              : expenses.length === 0
                ? "없음"
                : `${expenses.length}건`}
          </p>
        </div>

        <div className="chat-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {expenses.length === 0 && !loadingExpenses ? (
            <div className="w-full rounded-2xl bg-background px-4 py-5 text-sm text-muted">
              아직 저장된 지출이 없어요. 채팅으로 알려 주세요.
            </div>
          ) : (
            expenses.map((item) => (
              <article
                key={item.id}
                className="min-w-[148px] max-w-[180px] shrink-0 rounded-2xl bg-background px-4 py-3"
              >
                <p className="truncate text-sm font-medium text-foreground">
                  {item.description}
                </p>
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

          {sending ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-bubble-ai px-4 py-3 text-sm text-muted shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                입력 중...
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
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="지출 입력 또는 질문해 보세요"
            disabled={sending}
            className="h-12 min-h-[48px] flex-1 rounded-full bg-background px-4 text-base text-foreground outline-none placeholder:text-muted disabled:opacity-60 sm:h-11 sm:text-[15px]"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="h-12 min-h-[48px] min-w-[72px] rounded-full bg-accent px-4 text-[15px] font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 sm:h-11"
          >
            전송
          </button>
        </div>
      </form>
    </div>
  );
}
