"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase, type ExpenseRow } from "../lib/supabase";

type Expense = {
  id: number;
  date: string;
  amount: number;
  description: string;
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
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

const fieldClassName =
  "box-border h-14 w-full min-h-[56px] rounded-xl bg-background px-4 text-lg text-foreground outline-none transition placeholder:text-muted/70 focus:bg-white focus:ring-2 focus:ring-foreground/10 sm:h-12 sm:min-h-[48px] sm:text-[15px]";

export default function Home() {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadExpenses = useCallback(async () => {
    setError("");
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
    const today = new Date().toISOString().slice(0, 10);
    setDate(today);

    loadExpenses().finally(() => setLoading(false));
  }, [loadExpenses]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount.replace(/,/g, ""));
    if (!date || !description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    setSaving(true);
    setError("");

    const { data, error: insertError } = await supabase
      .from("expenses")
      .insert({
        date,
        amount: parsedAmount,
        description: description.trim(),
      })
      .select("id, created_at, date, amount, description")
      .single();

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    if (data) {
      setExpenses((prev) => [toExpense(data), ...prev]);
    }

    setAmount("");
    setDescription("");
  }

  async function removeExpense(id: number) {
    setError("");
    const { error: deleteError } = await supabase.from("expenses").delete().eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setExpenses((prev) => prev.filter((item) => item.id !== id));
  }

  const total = expenses.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="box-border flex w-full flex-1 flex-col bg-background px-5 py-12 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-20">
      <main className="mx-auto flex w-full max-w-lg flex-col gap-12 sm:gap-16">
        <header className="animate-fade-up space-y-3">
          <h1 className="text-[2rem] font-semibold tracking-tight text-foreground sm:text-4xl">
            나의 스마트 가계부
          </h1>
          <p className="max-w-sm text-lg leading-relaxed text-muted sm:text-[15px]">
            날짜, 금액, 내용을 입력하고 지출을 기록하세요.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="animate-fade-up-delay box-border w-full rounded-2xl bg-surface p-6 sm:p-8"
        >
          <div className="flex flex-col gap-8 sm:gap-6">
            <label className="flex flex-col gap-3 sm:gap-2">
              <span className="text-base font-medium text-foreground sm:text-sm">
                날짜
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className={fieldClassName}
              />
            </label>

            <label className="flex flex-col gap-3 sm:gap-2">
              <span className="text-base font-medium text-foreground sm:text-sm">
                금액
              </span>
              <div className="relative w-full">
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="15000"
                  required
                  className={`amount ${fieldClassName} pr-12`}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base text-muted sm:text-sm">
                  원
                </span>
              </div>
            </label>

            <label className="flex flex-col gap-3 sm:gap-2">
              <span className="text-base font-medium text-foreground sm:text-sm">
                내용
              </span>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="점심 식사"
                required
                maxLength={80}
                className={fieldClassName}
              />
            </label>

            <button
              type="submit"
              disabled={saving}
              className="mt-1 h-14 min-h-[56px] w-full rounded-xl bg-accent text-lg font-medium text-white transition-colors duration-200 hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:cursor-not-allowed disabled:opacity-40 sm:h-11 sm:min-h-[44px] sm:text-[15px]"
            >
              {saving ? "저장 중..." : "저장하기"}
            </button>
          </div>
        </form>

        {error ? (
          <p className="text-base leading-relaxed text-muted sm:text-sm">{error}</p>
        ) : null}

        <section className="animate-fade-up-delay w-full space-y-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-lg">
                지출 내역
              </h2>
              <p className="text-base text-muted sm:text-sm">
                {loading
                  ? "불러오는 중..."
                  : expenses.length === 0
                    ? "아직 기록된 지출이 없습니다."
                    : `${expenses.length}건 기록됨`}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="mb-1 text-sm text-muted sm:text-xs">합계</p>
              <p className="amount text-3xl font-medium text-foreground sm:text-2xl">
                {formatAmount(total)}
                <span className="ml-1 text-lg font-normal text-muted sm:text-base">
                  원
                </span>
              </p>
            </div>
          </div>

          <ul className="flex w-full flex-col gap-3">
            {expenses.map((item) => (
              <li
                key={item.id}
                className="flex w-full items-start justify-between gap-4 rounded-2xl bg-surface px-5 py-5 sm:px-6 sm:py-5"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-lg font-medium tracking-tight text-foreground sm:text-[15px]">
                    {item.description}
                  </p>
                  <p className="text-base text-muted sm:text-sm">
                    {formatDate(item.date)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <p className="amount text-xl font-medium text-foreground sm:text-lg">
                    {formatAmount(item.amount)}
                    <span className="ml-0.5 text-sm font-normal text-muted">원</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => removeExpense(item.id)}
                    className="min-h-[44px] rounded-lg px-2 text-base text-muted transition-colors duration-200 hover:text-foreground sm:min-h-0 sm:text-sm"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
