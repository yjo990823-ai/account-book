import {
  categorizeByKeywords,
  normalizeCategory,
  type ExpenseCategory,
} from "./categories";

export type ExpenseLike = {
  date: string;
  amount: number;
  description: string;
  category?: string | null;
};

export type MonthlyTotal = {
  month: string;
  label: string;
  total: number;
};

export type CategoryTotal = {
  category: string;
  total: number;
};

export function resolveCategory(expense: ExpenseLike): ExpenseCategory {
  if (expense.category) return normalizeCategory(expense.category);
  return categorizeByKeywords(expense.description);
}

export function buildMonthlyTotals(
  expenses: ExpenseLike[],
  months = 6,
  now?: Date,
): MonthlyTotal[] {
  const reference = now ?? new Date();
  const map = new Map<string, number>();

  for (const item of expenses) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue;
    const key = item.date.slice(0, 7);
    map.set(key, (map.get(key) ?? 0) + item.amount);
  }

  const result: MonthlyTotal[] = [];

  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(reference.getFullYear(), reference.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    result.push({
      month: key,
      label: `${date.getMonth() + 1}월`,
      total: map.get(key) ?? 0,
    });
  }

  return result;
}

export function buildCategoryTotals(expenses: ExpenseLike[]): CategoryTotal[] {
  const map = new Map<string, number>();

  for (const item of expenses) {
    const category = resolveCategory(item);
    map.set(category, (map.get(category) ?? 0) + item.amount);
  }

  return Array.from(map.entries())
    .map(([category, total]) => ({ category, total }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}
