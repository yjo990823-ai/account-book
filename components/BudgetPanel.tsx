"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ExpenseLike } from "../lib/expense-stats";

const STORAGE_KEY = "ai-account-book-monthly-budget";

type BudgetPanelProps = {
  expenses: ExpenseLike[];
};

function getCurrentMonthKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  })
    .format(now)
    .slice(0, 7);
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

function getMonthLabel(monthKey: string) {
  if (!monthKey.includes("-")) return "이번 달";
  const [, month] = monthKey.split("-");
  return `${Number(month)}월`;
}

export default function BudgetPanel({ expenses }: BudgetPanelProps) {
  const [monthKey, setMonthKey] = useState("");
  const [budget, setBudget] = useState(0);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMonthKey(getCurrentMonthKey(new Date()));

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { amount?: number };
        if (typeof parsed.amount === "number" && parsed.amount > 0) {
          setBudget(parsed.amount);
          setDraft(String(parsed.amount));
        } else {
          setEditing(true);
        }
      } else {
        setEditing(true);
      }
    } catch {
      setEditing(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ amount: budget }));
  }, [budget, ready]);

  const spent = useMemo(() => {
    if (!monthKey) return 0;
    return expenses
      .filter((item) => item.date.startsWith(monthKey))
      .reduce((sum, item) => sum + item.amount, 0);
  }, [expenses, monthKey]);

  const ratio = budget > 0 ? spent / budget : 0;
  const percent = Math.min(Math.round(ratio * 100), 999);
  const barWidth = Math.min(ratio * 100, 100);
  const isWarning = budget > 0 && ratio >= 0.8;
  const isOver = budget > 0 && ratio >= 1;

  function handleSave(event: FormEvent) {
    event.preventDefault();
    const value = Number(draft.replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) return;
    setBudget(Math.round(value));
    setEditing(false);
  }

  if (!ready) {
    return (
      <div className="rounded-2xl bg-background px-4 py-4 text-sm text-muted">
        예산 정보를 불러오는 중...
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-background px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            {getMonthLabel(monthKey)} 예산
          </h2>
          <p className="mt-0.5 text-xs text-muted">이번 달 지출과 예산을 비교해요</p>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(budget > 0 ? String(budget) : "");
              setEditing(true);
            }}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-black/5 hover:text-foreground"
          >
            수정
          </button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            step="1000"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="예: 500000"
            className="h-11 min-h-[44px] flex-1 rounded-xl bg-surface px-3 text-base text-foreground outline-none placeholder:text-muted focus:ring-2 focus:ring-foreground/10 sm:text-sm"
          />
          <button
            type="submit"
            className="h-11 min-h-[44px] rounded-xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            저장
          </button>
        </form>
      ) : (
        <>
          <div className="mb-2 flex items-end justify-between gap-3">
            <p className="text-sm text-muted">
              <span className="amount text-base font-medium text-foreground">
                {formatAmount(spent)}
              </span>
              <span className="mx-1">/</span>
              <span className="amount">{formatAmount(budget)}원</span>
            </p>
            <p
              className={`amount text-sm font-medium ${
                isWarning ? "text-foreground" : "text-muted"
              }`}
            >
              {percent}%
            </p>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-black/5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isOver ? "bg-accent" : isWarning ? "bg-[#636366]" : "bg-[#aeaeb2]"
              }`}
              style={{ width: `${barWidth}%` }}
            />
          </div>

          {isOver ? (
            <p className="mt-3 rounded-xl bg-black/[0.04] px-3 py-2 text-sm leading-relaxed text-foreground">
              예산을 초과했어요. 이번 달 {formatAmount(spent - budget)}원을 더
              썼습니다.
            </p>
          ) : isWarning ? (
            <p className="mt-3 rounded-xl bg-black/[0.04] px-3 py-2 text-sm leading-relaxed text-foreground">
              주의: 예산의 {percent}%를 사용했어요. 남은 금액은{" "}
              {formatAmount(budget - spent)}원입니다.
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted">
              남은 예산 {formatAmount(Math.max(budget - spent, 0))}원
            </p>
          )}
        </>
      )}
    </div>
  );
}
