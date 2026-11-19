import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_CATEGORIES } from "../src/lib/categories.ts";
import { budgetSummary, dailyExpenses, expensesByCategory } from "../src/lib/ledger.ts";
import { DEFAULT_THEME } from "../src/lib/themes.ts";
import {
  STORAGE_KEY,
  canonicalCategories,
  loadState,
  normalizeLedgerState,
  safeMigratedState,
} from "../src/lib/storage.ts";

const LEGACY_KEY = "xiaozhanben.v1";

const record = (overrides = {}) => ({
  id: "r1",
  type: "expense",
  amount: 10,
  category: "餐饮",
  date: "2026-11-05",
  note: "",
  createdAt: 1,
  ...overrides,
});

// storage.ts 只在函数里访问 window，这里用一份内存实现替掉 localStorage。
const files = new Map();
// 记下每次写入的键，用来证明迁移失败时盘里的原始状态没被覆盖掉。
const writes = [];
let denied = false;

function guard() {
  if (denied) throw new Error("localStorage is denied");
}

globalThis.window = {
  localStorage: {
    getItem: (key) => {
      guard();
      return files.has(key) ? files.get(key) : null;
    },
    setItem: (key, value) => {
      guard();
      writes.push(key);
      files.set(key, String(value));
    },
    removeItem: (key) => {
      guard();
      files.delete(key);
    },
  },
};

function reset() {
  files.clear();
  writes.length = 0;
  denied = false;
}

test("loadState seeds and persists demo data on first run", () => {
  reset();

  const { state, available, degraded } = loadState();
  assert.equal(available, true);
  assert.equal(degraded, false);
  assert.ok(state.records.length > 0);
  assert.deepEqual(state.categories, BUILTIN_CATEGORIES);

  const stored = JSON.parse(files.get(STORAGE_KEY));
  assert.equal(stored.records.length, state.records.length);
});

test("loadState migrates the legacy storage key", () => {
  reset();
  files.set(LEGACY_KEY, JSON.stringify({ records: [record()], budgets: {}, theme: "mist" }));

  const { state, degraded } = loadState();
  assert.equal(state.theme, "mist");
  assert.equal(state.records.length, 1);
  // 迁移成功就不算降级，数据要照常落盘。
  assert.equal(degraded, false);
  assert.equal(files.get(LEGACY_KEY), undefined);
  assert.ok(files.get(STORAGE_KEY).includes("餐饮"));
});

test("loadState falls back to demo data only for unparseable JSON", () => {
  reset();
  files.set(STORAGE_KEY, "{not json");

  const { state, available, degraded } = loadState();
  assert.equal(available, true);
  // 这份 JSON 连内容都读不出来，没有值得保留的原始状态，所以不算降级。
  assert.equal(degraded, false);
  assert.ok(state.records.length > 0);
  assert.notEqual(files.get(STORAGE_KEY), "{not json");
});

test("loadState reports degraded and leaves the raw state unwritten when migration fails", () => {
  reset();
  // 解析成功但不是账本状态：normalizeLedgerState 在这里抛错。
  const raw = "null";
  files.set(STORAGE_KEY, raw);

  const { state, available, degraded } = loadState();
  assert.equal(available, true);
  // 解析成功、迁移失败 → 原始状态还能找回，必须标成降级让调用方别急着落盘。
  assert.equal(degraded, true);
  // 迁移失败是代码的问题，不是数据的问题，原始状态必须原样留在 localStorage 里。
  assert.equal(files.get(STORAGE_KEY), raw);
  assert.ok(!writes.includes(STORAGE_KEY), `loadState wrote ${STORAGE_KEY} on a degraded load`);
  assert.deepEqual(state.records, []);
  assert.deepEqual(state.budgets, {});
  assert.equal(state.theme, DEFAULT_THEME);
  assert.deepEqual(state.categories, BUILTIN_CATEGORIES);
});

test("loadState reports denied storage without losing the state", () => {
  reset();
  denied = true;

  const { state, available, degraded } = loadState();
  // available 说的是浏览器肯不肯读写，不是迁移成不成功。
  assert.equal(available, false);
  assert.equal(degraded, false);
  assert.ok(state.records.length > 0);
});

test("normalizeLedgerState migrates legacy state and drops invalid records", () => {
  const state = normalizeLedgerState({
    records: [record(), { id: "bad", type: "expense" }],
    budgets: { 餐饮: 4000, 交通: "x", 购物: -2 },
    theme: "sage",
  });

  assert.deepEqual(state.records, [record()]);
  assert.deepEqual(state.budgets, { 餐饮: 4000 });
  assert.equal(state.theme, "sage");
  assert.deepEqual(state.categories, BUILTIN_CATEGORIES);
});

test("normalizeLedgerState trims record categories so they hit the budget", () => {
  const state = normalizeLedgerState({
    records: [record({ id: "a", category: " 餐饮 ", amount: 60 })],
    budgets: { 餐饮: 100 },
    theme: "sage",
  });

  // 记录带着空格存下去，就会和 "餐饮" 各算一份，预算那行永远缺一半。
  assert.deepEqual(state.records, [record({ id: "a", category: "餐饮", amount: 60 })]);

  const rows = budgetSummary(state.records, state.budgets, state.categories).rows;
  const dining = rows.find((row) => row.category === "餐饮");
  assert.equal(dining.spent, 60);
  assert.equal(dining.remaining, 40);

  // 环形图与每日趋势同样按名字聚合，规范化后只剩一片。
  const ring = expensesByCategory(state.records);
  assert.deepEqual(
    ring.slices.map((slice) => slice.category),
    ["餐饮"],
  );
  assert.equal(dailyExpenses(state.records, 2026, 10)[4].amount, 60);
});

test("normalizeLedgerState merges budget keys that differ only by spaces", () => {
  const state = normalizeLedgerState({
    budgets: { 餐饮: 100.5, " 餐饮 ": 40.25, "交通 ": 10, "   ": 5 },
  });

  // 按分相加再还原，100.5 + 40.25 不会漂成 140.74999999999997；只有空格的键丢掉。
  assert.deepEqual(state.budgets, { 餐饮: 140.75, 交通: 10 });
});

test("normalizeLedgerState discards records whose category is only spaces", () => {
  const state = normalizeLedgerState({
    records: [record({ id: "a", category: "   " }), record({ id: "b" })],
  });

  assert.deepEqual(state.records, [record({ id: "b" })]);
  // 被丢掉的记录也不该在分类列表里留下只由空格组成的幽灵分类。
  assert.deepEqual(state.categories, BUILTIN_CATEGORIES);
});

test("safeMigratedState trims records and budgets the same way", () => {
  const state = safeMigratedState({
    records: [record({ id: "a", category: " 餐饮 " }), record({ id: "b", category: "  " })],
    budgets: { 餐饮: 30, " 餐饮 ": 20.5 },
  });

  assert.deepEqual(state.records, [record({ id: "a", category: "餐饮" })]);
  assert.deepEqual(state.budgets, { 餐饮: 50.5 });
});

test("safeMigratedState keeps readable data and restores built-in categories", () => {
  const readable = record({ id: "ok" });
  const unreadable = {
    id: "boom",
    get type() {
      throw new Error("poisoned getter");
    },
  };

  const state = safeMigratedState({
    records: [readable, unreadable, { id: "partial", type: "expense" }],
    budgets: { 餐饮: "120.5", 交通: -1, 购物: "abc" },
    theme: "not-a-theme",
    categories: "不是数组",
  });

  assert.deepEqual(state.records, [readable]);
  assert.deepEqual(state.budgets, { 餐饮: 120.5 });
  assert.equal(state.theme, DEFAULT_THEME);
  assert.deepEqual(state.categories, BUILTIN_CATEGORIES);
});

test("safeMigratedState tolerates input that is not an object", () => {
  for (const input of [null, undefined, "text", 42, []]) {
    const state = safeMigratedState(input);
    assert.deepEqual(state.records, []);
    assert.deepEqual(state.budgets, {});
    assert.equal(state.theme, DEFAULT_THEME);
    assert.deepEqual(state.categories, BUILTIN_CATEGORIES);
  }
});

test("canonicalCategories hands out mutable copies of the built-ins", () => {
  const list = canonicalCategories();

  assert.notEqual(list, BUILTIN_CATEGORIES);
  assert.ok(!Object.isFrozen(list[0]));
  list[0].disabled = true;
  assert.equal(BUILTIN_CATEGORIES[0].disabled, false);
});
