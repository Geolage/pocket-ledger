/* 持久化与演示数据：只写本机 localStorage，不发任何网络请求。 */

import { BUILTIN_CATEGORIES, normalizeCategories } from "./categories";
import {
  type Budgets,
  type CategoryDefinition,
  type LedgerRecord,
  cents,
  dateKey,
  daysInMonth,
  fromCents,
  isValidRecord,
  newId,
} from "./ledger";
import { DEFAULT_THEME, type ThemeId, isThemeId } from "./themes";

export const STORAGE_KEY = "pocket-ledger.v1";
const LEGACY_STORAGE_KEY = "xiaozhanben.v1";

export interface LedgerState {
  records: LedgerRecord[];
  budgets: Budgets;
  theme: ThemeId;
  categories: CategoryDefinition[];
}

interface StorageResult {
  state: LedgerState;
  /** 浏览器拒绝读写时，UI 需要如实提示 */
  available: boolean;
}

function readRaw(): string | null {
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current !== null) return current;
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === null) return null;
    try {
      window.localStorage.setItem(STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {}
    return legacy;
  } catch {
    return null;
  }
}

/** 任何来源的状态（本机存储、导入文件）都先过这一道，保证分类与记录齐全。 */
export function normalizeLedgerState(input: Partial<LedgerState>): LedgerState {
  const records = Array.isArray(input.records) ? input.records.filter(isValidRecord) : [];
  return {
    records,
    budgets: sanitizeBudgets(input.budgets),
    theme: isThemeId(input.theme) ? input.theme : DEFAULT_THEME,
    categories: normalizeCategories(input.categories, records),
  };
}

export function loadState(): StorageResult {
  const raw = readRaw();

  if (raw === null) {
    const seeded = demoState(DEFAULT_THEME);
    writeState(seeded);
    return { state: seeded, available: storageWorks() };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LedgerState>;
    return { state: normalizeLedgerState(parsed), available: true };
  } catch {
    const fallback = demoState(DEFAULT_THEME);
    writeState(fallback);
    return { state: fallback, available: storageWorks() };
  }
}

export function saveState(state: LedgerState): boolean {
  return writeState(state);
}

function writeState(state: LedgerState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function storageWorks(): boolean {
  try {
    const probe = `${STORAGE_KEY}.probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function storedBytes(): number {
  const raw = readRaw();
  return raw ? raw.length : 0;
}

function sanitizeBudgets(input: unknown): Budgets {
  if (!input || typeof input !== "object") return {};
  const out: Budgets = {};
  for (const [category, value] of Object.entries(input as Record<string, unknown>)) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) out[category] = fromCents(cents(amount));
  }
  return out;
}

/* ---------------- 演示数据（人物、商户、金额全部虚构） ---------------- */

const NOTE_POOL: Record<string, string[]> = {
  餐饮: [
    "巷口面馆",
    "楼下便利店",
    "社区超市买菜",
    "同事聚餐",
    "早餐豆浆",
    "水果摊",
    "外卖午餐",
    "咖啡",
  ],
  交通: ["地铁通勤", "公交充值", "网约车", "共享单车月卡", "高铁票"],
  购物: ["换季衣物", "日用品补货", "线上超市", "耳机配件", "书籍", "洗护用品"],
  娱乐: ["电影票", "健身房次卡", "演出门票", "游戏充值", "展览"],
  医疗: ["感冒药", "牙科复诊", "体检"],
  教育: ["线上课程", "考试报名"],
  其他: ["理发", "快递代收", "宠物用品", "红包"],
  副业: ["周末拍摄兼职", "翻译稿件"],
  奖金: ["季度奖金"],
  理财: ["基金分红"],
};

/** 固定种子：同一月份每次恢复都得到同一套账本，便于比对界面。 */
function lcg(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function pick<T>(random: () => number, list: T[]): T {
  return list[Math.floor(random() * list.length)];
}

function buildDemoMonth(
  random: () => number,
  year: number,
  month: number,
  partial: boolean,
): LedgerRecord[] {
  const out: LedgerRecord[] = [];
  const total = daysInMonth(year, month);
  const now = new Date();
  const lastDay = partial ? now.getDate() : total;

  const add = (
    type: LedgerRecord["type"],
    category: string,
    amount: number,
    day: number,
    note: string,
  ) => {
    if (day > lastDay) return;
    out.push({
      id: newId(),
      type,
      amount: fromCents(cents(amount)),
      category,
      date: dateKey(new Date(year, month, day)),
      note,
      createdAt: new Date(year, month, day).getTime(),
    });
  };

  add("expense", "居住", 2600, 1, "房租");
  add("expense", "居住", 168, Math.min(5, lastDay), "水电燃气");
  add("income", "工资", 12480, Math.min(10, lastDay), "月薪");

  const plan: Array<[string, number, number, number]> = [
    ["餐饮", 20, 14, 88],
    ["交通", 12, 6, 46],
    ["购物", 6, 96, 226],
    ["娱乐", 5, 38, 168],
    ["其他", 3, 26, 120],
  ];

  for (const [category, count, min, max] of plan) {
    const scale = partial ? lastDay / total : 1;
    const entries = Math.max(1, Math.round(count * scale * (0.8 + random() * 0.4)));
    for (let i = 0; i < entries; i += 1) {
      add(
        "expense",
        category,
        min + random() * (max - min),
        1 + Math.floor(random() * total),
        pick(random, NOTE_POOL[category] ?? [""]),
      );
    }
  }

  if (random() > 0.45)
    add(
      "expense",
      "医疗",
      28 + random() * 180,
      1 + Math.floor(random() * total),
      pick(random, NOTE_POOL["医疗"]),
    );
  if (random() > 0.6)
    add(
      "expense",
      "教育",
      99 + random() * 300,
      1 + Math.floor(random() * total),
      pick(random, NOTE_POOL["教育"]),
    );
  if (random() > 0.5)
    add(
      "income",
      "副业",
      480 + random() * 900,
      1 + Math.floor(random() * total),
      pick(random, NOTE_POOL["副业"]),
    );

  return out;
}

export function demoState(theme: ThemeId = DEFAULT_THEME): LedgerState {
  const now = new Date();
  const random = lcg(20261027);
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  return {
    records: [
      ...buildDemoMonth(random, previous.getFullYear(), previous.getMonth(), false),
      ...buildDemoMonth(random, now.getFullYear(), now.getMonth(), true),
    ],
    budgets: { 居住: 2800, 餐饮: 4000, 交通: 1500, 购物: 400, 娱乐: 1200, 其他: 600 },
    theme,
    categories: BUILTIN_CATEGORIES.map((category) => ({ ...category })),
  };
}
