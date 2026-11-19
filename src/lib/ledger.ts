/* 领域层：类型、分类、金额/日期工具与派生计算。全部是纯函数，不碰 DOM。 */

export type RecordType = "expense" | "income";

export interface CategoryDefinition {
  id: string;
  type: RecordType;
  name: string;
  color: string;
  disabled: boolean;
  builtin: boolean;
}

export interface LedgerRecord {
  id: string;
  type: RecordType;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  note: string;
  createdAt: number;
}

export type Budgets = Record<string, number>;

/**
 * 下面三份常量是记录、预算与图表取值的共同键，全模块共享。
 * 冻结之后谁都改不动：项目是 ESM（严格模式），原地赋值直接抛 TypeError。
 */
export const EXPENSE_CATEGORIES: readonly string[] = Object.freeze([
  "餐饮",
  "交通",
  "购物",
  "居住",
  "娱乐",
  "医疗",
  "教育",
  "其他",
]);

export const INCOME_CATEGORIES: readonly string[] = Object.freeze([
  "工资",
  "副业",
  "奖金",
  "理财",
  "其他收入",
]);

/** 分类 → 主题令牌。换主题时图表颜色自动跟随。 */
export const CATEGORY_COLOR: Readonly<Record<string, string>> = Object.freeze({
  餐饮: "var(--cat-1)",
  交通: "var(--cat-2)",
  购物: "var(--cat-3)",
  居住: "var(--cat-4)",
  娱乐: "var(--cat-5)",
  医疗: "var(--cat-6)",
  教育: "var(--cat-1)",
  其他: "var(--cat-2)",
  工资: "var(--cat-1)",
  副业: "var(--cat-5)",
  奖金: "var(--cat-4)",
  理财: "var(--cat-3)",
  其他收入: "var(--cat-2)",
});

export const DEFAULT_COLOR = "var(--cat-3)";

export const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * 某个类型下「可以选用」的分类名。预算行、选择器与分类候选共用这一份口径，
 * 免得各处的过滤条件各写各的。
 */
export function enabledNames(
  categories: readonly CategoryDefinition[],
  type: RecordType,
): string[] {
  return categories
    .filter((category) => category.type === type && !category.disabled)
    .map((category) => category.name);
}

export function categoriesFor(
  type: RecordType,
  categories: readonly CategoryDefinition[],
): string[] {
  return enabledNames(categories, type);
}

/** 颜色按 type + name 查：分类名全局唯一只是约定，历史记录里仍可能两边同名。 */
export function categoryColor(
  category: string,
  type: RecordType,
  categories: readonly CategoryDefinition[],
): string {
  return (
    categories.find((item) => item.type === type && item.name === category)?.color ?? DEFAULT_COLOR
  );
}

/* ---------------- 金额：一律按分计算，避免浮点误差 ---------------- */

export function cents(value: number): number {
  return Math.round(value * 100);
}

export function fromCents(value: number): number {
  return value / 100;
}

export function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}¥${Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ---------------- 日期 ---------------- */

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null;
  return date;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function isSameMonth(date: Date, year: number, month: number): boolean {
  return date.getFullYear() === year && date.getMonth() === month;
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month + 1} 月`;
}

export function shiftMonth(view: Date, delta: number): Date {
  return new Date(view.getFullYear(), view.getMonth() + delta, 1);
}

/* ---------------- 派生计算 ---------------- */

export function recordsOfMonth(
  records: LedgerRecord[],
  year: number,
  month: number,
): LedgerRecord[] {
  return records.filter((r) => {
    const date = parseDate(r.date);
    return date !== null && isSameMonth(date, year, month);
  });
}

export interface Summary {
  income: number;
  expense: number;
  balance: number;
  incomeCount: number;
  expenseCount: number;
}

export function summarize(records: LedgerRecord[]): Summary {
  let income = 0;
  let expense = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  for (const record of records) {
    if (record.type === "income") {
      income += cents(record.amount);
      incomeCount += 1;
    } else {
      expense += cents(record.amount);
      expenseCount += 1;
    }
  }
  return {
    income: fromCents(income),
    expense: fromCents(expense),
    balance: fromCents(income - expense),
    incomeCount,
    expenseCount,
  };
}

export interface CategorySlice {
  category: string;
  amount: number;
  share: number; // 0–1
}

export function expensesByCategory(records: LedgerRecord[]): {
  total: number;
  slices: CategorySlice[];
} {
  const totals = new Map<string, number>();
  let total = 0;
  for (const record of records) {
    if (record.type !== "expense") continue;
    const value = cents(record.amount);
    totals.set(record.category, (totals.get(record.category) ?? 0) + value);
    total += value;
  }
  const slices = [...totals.entries()]
    .map(([category, value]) => ({
      category,
      amount: fromCents(value),
      share: total > 0 ? value / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  return { total: fromCents(total), slices };
}

export interface DayBar {
  day: number;
  amount: number;
}

export function dailyExpenses(records: LedgerRecord[], year: number, month: number): DayBar[] {
  const days: DayBar[] = Array.from({ length: daysInMonth(year, month) }, (_, i) => ({
    day: i + 1,
    amount: 0,
  }));
  for (const record of records) {
    if (record.type !== "expense") continue;
    const date = parseDate(record.date);
    if (!date || !isSameMonth(date, year, month)) continue;
    days[date.getDate() - 1].amount += cents(record.amount);
  }
  return days.map((d) => ({ day: d.day, amount: fromCents(d.amount) }));
}

export interface BudgetRow {
  category: string;
  budget: number;
  spent: number;
  remaining: number;
  pct: number;
  over: boolean;
  near: boolean;
}

export interface BudgetSummary {
  rows: BudgetRow[];
  totalBudget: number;
  totalSpent: number;
  remaining: number;
  overCount: number;
}

export function budgetSummary(
  records: LedgerRecord[],
  budgets: Budgets,
  categories: readonly CategoryDefinition[],
): BudgetSummary {
  const spent = new Map<string, number>();
  for (const record of records) {
    if (record.type !== "expense") continue;
    spent.set(record.category, (spent.get(record.category) ?? 0) + cents(record.amount));
  }

  const rows: BudgetRow[] = [];
  let totalBudget = 0;
  let totalSpent = 0;

  for (const name of enabledNames(categories, "expense")) {
    const budget = Number(budgets[name]) || 0;
    if (budget <= 0) continue;
    const used = fromCents(spent.get(name) ?? 0);
    totalBudget += cents(budget);
    totalSpent += cents(used);
    rows.push({
      category: name,
      budget,
      spent: used,
      remaining: fromCents(cents(budget) - cents(used)),
      pct: (used / budget) * 100,
      over: used > budget,
      near: used <= budget && used / budget >= 0.85,
    });
  }

  rows.sort((a, b) => b.pct - a.pct);

  return {
    rows,
    totalBudget: fromCents(totalBudget),
    totalSpent: fromCents(totalSpent),
    remaining: fromCents(totalBudget - totalSpent),
    overCount: rows.filter((row) => row.over).length,
  };
}

export function isValidRecord(value: unknown): value is LedgerRecord {
  const r = value as Partial<LedgerRecord>;
  if (!r || typeof r !== "object") return false;
  return (
    typeof r.id === "string" &&
    (r.type === "expense" || r.type === "income") &&
    typeof r.amount === "number" &&
    Number.isFinite(r.amount) &&
    r.amount > 0 &&
    typeof r.category === "string" &&
    r.category.length > 0 &&
    typeof r.date === "string" &&
    parseDate(r.date) !== null
  );
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function describeRecord(record: LedgerRecord): string {
  return `${record.category} ${money(record.amount)}（${record.date}）`;
}
