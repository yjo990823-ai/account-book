"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildCategoryTotals,
  buildMonthlyTotals,
  type ExpenseLike,
} from "../lib/expense-stats";

const PIE_COLORS = ["#191919", "#3a3a3c", "#636366", "#8e8e93", "#aeaeb2", "#c7c7cc"];

type ExpenseChartsProps = {
  expenses: ExpenseLike[];
};

function formatWon(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

export default function ExpenseCharts({ expenses }: ExpenseChartsProps) {
  const monthly = buildMonthlyTotals(expenses);
  const categories = buildCategoryTotals(expenses);
  const hasData = expenses.length > 0;

  if (!hasData) {
    return (
      <div className="rounded-2xl bg-background px-4 py-5 text-sm text-muted">
        지출이 쌓이면 월별·카테고리 차트가 여기에 보여요.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl bg-background px-3 pb-2 pt-3">
        <p className="mb-2 px-1 text-sm font-medium text-foreground">월별 총 지출</p>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e5e5ea" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#8e8e93", fontSize: 12 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tick={{ fill: "#8e8e93", fontSize: 11 }}
                tickFormatter={(value: number) =>
                  value >= 10000 ? `${Math.round(value / 10000)}만` : `${value}`
                }
              />
              <Tooltip
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
                formatter={(value) => [formatWon(Number(value ?? 0)), "합계"]}
                contentStyle={{
                  border: "none",
                  borderRadius: 12,
                  background: "#fff",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                  fontSize: 13,
                }}
              />
              <Bar dataKey="total" fill="#191919" radius={[8, 8, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl bg-background px-3 pb-2 pt-3">
        <p className="mb-2 px-1 text-sm font-medium text-foreground">카테고리별 지출</p>
        <div className="flex h-44 items-center gap-2">
          <div className="h-full min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories}
                  dataKey="total"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius={38}
                  outerRadius={62}
                  paddingAngle={2}
                >
                  {categories.map((entry, index) => (
                    <Cell
                      key={entry.category}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatWon(Number(value ?? 0))}
                  contentStyle={{
                    border: "none",
                    borderRadius: 12,
                    background: "#fff",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                    fontSize: 13,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="max-h-40 w-[42%] shrink-0 space-y-1.5 overflow-y-auto pr-1">
            {categories.map((item, index) => (
              <li key={item.category} className="flex items-start gap-2 text-xs">
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-foreground">{item.category}</span>
                  <span className="amount text-muted">{formatWon(item.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
