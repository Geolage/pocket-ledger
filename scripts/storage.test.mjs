import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_CATEGORIES } from "../src/lib/categories.ts";
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
  denied = false;
}

test("loadState seeds and persists demo data on first run", () => {
  reset();

  const { state, available } = loadState();
  assert.equal(available, true);
  assert.ok(state.records.length > 0);
  assert.deepEqual(state.categories, BUILTIN_CATEGORIES);

  const stored = JSON.parse(files.get(STORAGE_KEY));
  assert.equal(stored.records.length, state.records.length);
});

test("loadState migrates the legacy storage key", () => {
  reset();
  files.set(LEGACY_KEY, JSON.stringify({ records: [record()], budgets: {}, theme: "mist" }));

  const { state } = loadState();
  assert.equal(state.theme, "mist");
  assert.equal(state.records.length, 1);
  assert.equal(files.get(LEGACY_KEY), undefined);
  assert.ok(files.get(STORAGE_KEY).includes("餐饮"));
});

test("loadState falls back to demo data only for unparseable JSON", () => {
  reset();
  files.set(STORAGE_KEY, "{not json");

  const { state, available } = loadState();
  assert.equal(available, true);
  assert.ok(state.records.length > 0);
  assert.notEqual(files.get(STORAGE_KEY), "{not json");
});

test("loadState keeps the raw state when migration fails", () => {
  reset();
  // 解析成功但不是账本状态：normalizeLedgerState 在这里抛错。
  const raw = "null";
  files.set(STORAGE_KEY, raw);

  const { state, available } = loadState();
  assert.equal(available, true);
  // 迁移失败是代码的问题，不是数据的问题，原始状态必须原样留在 localStorage 里。
  assert.equal(files.get(STORAGE_KEY), raw);
  assert.deepEqual(state.records, []);
  assert.deepEqual(state.budgets, {});
  assert.equal(state.theme, DEFAULT_THEME);
  assert.deepEqual(state.categories, BUILTIN_CATEGORIES);
});

test("loadState reports denied storage without losing the state", () => {
  reset();
  denied = true;

  const { state, available } = loadState();
  // available 说的是浏览器肯不肯读写，不是迁移成不成功。
  assert.equal(available, false);
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
