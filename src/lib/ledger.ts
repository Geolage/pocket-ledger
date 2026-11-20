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
  /** 用户没写备注时就是没有这一项：账单里渲染成「无备注」，筛选与「改没改」的比对都按空串算。 */
  note?: string;
  /**
   * 同一天里的上下排列依据，旧数据与手改过的备份都可能没有这一项，所以这里刻意不给默认值：
   * 写 Date.now() 会把用户的账本重新排一遍，写 0 是凭空捏一个 1970 年，
   * 从 date 现推又只是把 compareRecordsForDisplay 要排的那个键抄一遍。
   * 缺着怎么排，是那条规则的事。
   */
  createdAt?: number;
}

export type Budgets = Record<string, number>;

/**
 * 记一笔 / 编辑这笔的表单交给领域层的那五项：用户在对话框里能改的就这些。
 * 金额还是用户输入的元、分类名也可能带空格，所以写回记录前要统一按分与去空格归一化，
 * 这份归一化连着「这次保存到底改了什么」的判定一起放在这里，见 applyRecordDraftById。
 */
export interface RecordDraft {
  type: RecordType;
  amount: number;
  category: string;
  date: string;
  note: string;
}

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

/** 颜色索引的键：type 与 name 一起才算一个身份，历史记录里两种类型可能撞名。 */
function colorKey(type: RecordType, name: string): string {
  return `${type}:${name}`;
}

/**
 * 分类色索引。自定义分类能一直加，账单又是一笔一笔渲染的，
 * 每次现查一遍列表会让长账单页每次刷新都白扫好几遍分类表。
 * 调用方用 useMemo 把它跟 categories 一起缓存，见 src/hooks/use-ledger.ts。
 */
export type CategoryColorIndex = ReadonlyMap<string, string>;

export function categoryColorIndex(categories: readonly CategoryDefinition[]): CategoryColorIndex {
  const index = new Map<string, string>();
  for (const category of categories) {
    index.set(colorKey(category.type, category.name), category.color);
  }
  return index;
}

/** 从索引里取色；查不到照旧回落默认色，与旧的一次性 find 行为一致。 */
export function colorOf(index: CategoryColorIndex, category: string, type: RecordType): string {
  return index.get(colorKey(type, category)) ?? DEFAULT_COLOR;
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

/**
 * 账单那一列的排列规则：日期新的在上，同一天里写入时刻新的在上。
 * 放在领域层而不是 hook 的 sort 里，是因为「缺了 createdAt」这一种输入必须由这条规则自己交代：
 * 直接减 `b.createdAt - a.createdAt` 会减出 NaN，Array#sort 当作没收到比较结果，
 * 同月的上下顺序就退化成进场顺序，同一份账本两次刷新能排出两屏。
 * 没有时刻的那些按 id 定序、并且一律排在有时刻的那些之后——「不知道什么时候记的」
 * 不该靠随机 id 或数组顺序蒙到已知的新账前面；时刻相同（连点两笔时 Date.now() 会撞在同一毫秒）
 * 同样按 id 收口，所以同一批记录无论什么进场顺序，排出来都是同一屏。
 */
export function compareRecordsForDisplay(a: LedgerRecord, b: LedgerRecord): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const left = a.createdAt ?? Number.NEGATIVE_INFINITY;
  const right = b.createdAt ?? Number.NEGATIVE_INFINITY;
  if (left !== right) return right - left;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * 按 id 删掉一笔：真的删掉了才返回新列表，找不到就返回 null。
 * `filter` 每次都造一个新数组，光比引用分不出「删掉了一笔」和「压根没有这一笔」，
 * 而调用方要靠这个区别决定给不给撤销动作，所以判定得留在这里。
 */
export function removeRecordById(records: LedgerRecord[], id: string): LedgerRecord[] | null {
  const next = records.filter((record) => record.id !== id);
  return next.length === records.length ? null : next;
}

/**
 * 把草稿套到那个 id 上：用户看得见的五项（类型、按分算的金额、去空格的分类、日期、备注）
 * 写进去的值和已有的值一模一样才算没改，那时返回 null。id 不在列表里也算「什么都没改」——
 * 一次碰不到任何记录的保存没资格改动账本。
 * 和 removeRecordById 一样，「改没改」必须由领域层说清楚：`map` 每次都造新数组和新对象，
 * 光比引用分不出「改了一笔」和「原样存回去」，而调用方要靠这个区别决定落不落盘、
 * 放不放行降级状态、留不留得上一步的撤销。
 * 既然判的是「这次保存会不会写下不一样的字节」，就得逐项比要写进去的那份值，不能按分凑近似：
 * 存着的金额从来不过两位小数校验（见 isValidRecord），所以 0.145 真的可能存在盘里，
 * 而草稿归一化成 0.14 —— 落盘的字节会变，那就是一次真改动，顺带把这种脏值归一化掉。
 */
export function applyRecordDraftById(
  records: LedgerRecord[],
  id: string,
  draft: RecordDraft,
): LedgerRecord[] | null {
  const category = draft.category.trim();
  const amount = fromCents(cents(draft.amount));
  const changed = records.some(
    (record) =>
      record.id === id &&
      (record.type !== draft.type ||
        record.amount !== amount ||
        record.category !== category ||
        record.date !== draft.date ||
        // 备注在旧数据里可能压根没有这一项，界面上渲染的就是空串，所以按空串比。
        (record.note ?? "") !== draft.note),
  );
  if (!changed) return null;
  // 只覆盖用户看得见的那五项：createdAt 是排序依据，编辑不该把它推到最新。
  return records.map((record) =>
    record.id === id ? { ...record, ...draft, amount, category } : record,
  );
}

/**
 * 给某个分类定下每月预算：那个键里已经存着的值，和这次要写进去的值一模一样，才返回 null。
 * 判定和写入共用同一份归一化（分类名去空格、金额按分），比的是「这次保存会写下什么」，
 * 不是「这两个数是不是同一笔钱」：`{ 餐饮: "100" }` 里那个字符串落成的字节和数字 100 不同，
 * 所以那仍然是一次真改动，顺带把它归一化成干净的数字。NaN 之类的脏值同理。
 * `{ ...current }` 每次都换新引用，writeBudgets 只认引用，于是原样保存
 * 也会落盘、放行降级状态、关掉上一步的撤销——一笔没改动的点击不该有这些代价。
 */
export function setBudgetAmount(
  budgets: Budgets,
  category: string,
  amount: number,
): Budgets | null {
  const name = category.trim();
  const value = cents(amount);
  // 有键才算「本来就是这个数」：还没有这条预算时，即便要写 0 也是一次真改动。
  // 比的是 fromCents(value)，也就是这次真正落盘的那个数：键里存着别的写法（字符串、三位小数）都算改动。
  if (Object.hasOwn(budgets, name) && budgets[name] === fromCents(value)) return null;
  return { ...budgets, [name]: fromCents(value) };
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
