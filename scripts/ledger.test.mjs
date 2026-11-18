import test from "node:test";
import assert from "node:assert/strict";
import * as ledger from "../src/lib/ledger.ts";
import { faviconHref } from "../src/lib/themes.ts";

function record(overrides = {}) {
  return {
    id: "r1",
    type: "expense",
    amount: 10,
    category: "餐饮",
    date: "2026-11-05",
    note: "",
    createdAt: 1,
    ...overrides,
  };
}

test("money and cents use two-decimal rounding without float drift", () => {
  assert.equal(ledger.cents(0.1 + 0.2), 30);
  assert.equal(ledger.fromCents(3050), 30.5);
  assert.equal(ledger.money(1234.5), "¥1,234.50");
  assert.equal(ledger.money(-2), "-¥2.00");
  assert.equal(ledger.money(0), "¥0.00");
});

test("categories and colors follow income and expense rules", () => {
  assert.deepEqual(ledger.categoriesFor("expense"), ledger.EXPENSE_CATEGORIES);
  assert.deepEqual(ledger.categoriesFor("income"), ledger.INCOME_CATEGORIES);
  assert.equal(ledger.categoryColor("餐饮"), "var(--cat-1)");
  assert.equal(ledger.categoryColor("不存在"), ledger.DEFAULT_COLOR);
});

test("date helpers reject impossible dates and shift across year boundaries", () => {
  assert.equal(ledger.dateKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(ledger.parseDate("2026-02-29"), null);
  assert.equal(ledger.parseDate("2026-02-31"), null);
  assert.equal(ledger.parseDate("2026-13-01"), null);
  assert.equal(ledger.parseDate("not-a-date"), null);
  assert.equal(ledger.parseDate("2024-02-29")?.getDate(), 29);
  assert.equal(ledger.daysInMonth(2024, 1), 29);
  assert.equal(ledger.daysInMonth(2026, 1), 28);
  assert.equal(ledger.shiftMonth(new Date(2026, 0, 15), -1).getMonth(), 11);
  assert.equal(ledger.shiftMonth(new Date(2026, 0, 15), -1).getFullYear(), 2025);
  assert.equal(ledger.monthLabel(2026, 10), "2026 年 11 月");
});

test("recordsOfMonth keeps only valid records in the requested month", () => {
  const records = [
    record({ id: "a", date: "2026-11-01" }),
    record({ id: "b", date: "2026-11-30" }),
    record({ id: "c", date: "2026-12-01" }),
    record({ id: "d", date: "2026-02-31" }),
  ];
  assert.deepEqual(
    ledger.recordsOfMonth(records, 2026, 10).map((item) => item.id),
    ["a", "b"],
  );
  assert.deepEqual(
    ledger.recordsOfMonth(records, 2026, 11).map((item) => item.id),
    ["c"],
  );
});

test("summarize totals income, expense, balance and counts in integer cents", () => {
  const summary = ledger.summarize([
    record({ id: "a", type: "income", amount: 1000.01 }),
    record({ id: "b", type: "expense", amount: 0.1 }),
    record({ id: "c", type: "expense", amount: 0.2 }),
  ]);
  assert.deepEqual(summary, {
    income: 1000.01,
    expense: 0.3,
    balance: 999.71,
    incomeCount: 1,
    expenseCount: 2,
  });
  assert.deepEqual(ledger.summarize([]), {
    income: 0,
    expense: 0,
    balance: 0,
    incomeCount: 0,
    expenseCount: 0,
  });
});

test("expensesByCategory excludes income, sorts by amount and returns shares", () => {
  const result = ledger.expensesByCategory([
    record({ id: "a", category: "餐饮", amount: 30 }),
    record({ id: "b", category: "交通", amount: 70 }),
    record({ id: "c", category: "收入", type: "income", amount: 999 }),
  ]);
  assert.equal(result.total, 100);
  assert.deepEqual(
    result.slices.map((slice) => slice.category),
    ["交通", "餐饮"],
  );
  assert.deepEqual(
    result.slices.map((slice) => slice.share),
    [0.7, 0.3],
  );
  assert.deepEqual(ledger.expensesByCategory([]), { total: 0, slices: [] });
});

test("dailyExpenses maps every day and ignores income and other months", () => {
  const trend = ledger.dailyExpenses(
    [
      record({ id: "a", date: "2026-11-05", amount: 12.5 }),
      record({ id: "b", date: "2026-11-05", amount: 7.5 }),
      record({ id: "c", date: "2026-11-06", amount: 100, type: "income" }),
      record({ id: "d", date: "2026-10-06", amount: 99 }),
    ],
    2026,
    10,
  );
  assert.equal(trend.length, 30);
  assert.equal(trend[4].amount, 20);
  assert.equal(trend[5].amount, 0);
  assert.equal(
    trend.reduce((sum, day) => sum + day.amount, 0),
    20,
  );
});

test("budgetSummary calculates usage, over/near flags and totals", () => {
  const summary = ledger.budgetSummary(
    [
      record({ id: "a", category: "餐饮", amount: 85 }),
      record({ id: "b", category: "交通", amount: 120 }),
      record({ id: "c", category: "购物", amount: 50 }),
      record({ id: "d", category: "工资", amount: 999, type: "income" }),
    ],
    { 餐饮: 100, 交通: 100, 医疗: 200 },
  );
  assert.deepEqual(
    summary.rows.map((row) => row.category),
    ["交通", "餐饮", "医疗"],
  );
  assert.equal(summary.rows[0].over, true);
  assert.equal(summary.rows[0].pct, 120);
  assert.equal(summary.rows[1].near, true);
  assert.equal(summary.rows[1].remaining, 15);
  assert.equal(summary.rows[2].spent, 0);
  assert.equal(summary.rows[2].pct, 0);
  assert.equal(summary.totalBudget, 400);
  assert.equal(summary.totalSpent, 205);
  assert.equal(summary.remaining, 195);
  assert.equal(summary.overCount, 1);
});

test("budgetSummary ignores zero, negative and malformed budgets", () => {
  const summary = ledger.budgetSummary([record({ id: "a", category: "餐饮", amount: 10 })], {
    餐饮: 0,
    交通: -1,
    购物: Number.NaN,
    娱乐: 50,
  });
  assert.deepEqual(
    summary.rows.map((row) => row.category),
    ["娱乐"],
  );
  assert.equal(summary.totalBudget, 50);
  assert.equal(summary.totalSpent, 0);
});

test("isValidRecord rejects incomplete or impossible records", () => {
  assert.equal(ledger.isValidRecord(record()), true);
  assert.equal(ledger.isValidRecord(record({ amount: 0 })), false);
  assert.equal(ledger.isValidRecord(record({ amount: Number.NaN })), false);
  assert.equal(ledger.isValidRecord(record({ date: "2026-02-31" })), false);
  assert.equal(ledger.isValidRecord(record({ category: "" })), false);
  assert.equal(ledger.isValidRecord(record({ type: "transfer" })), false);
  assert.equal(ledger.isValidRecord(null), false);
});

test("favicon href encodes the selected theme colors", () => {
  const href = faviconHref("#3E7E71", "#A9D3C8");
  assert.ok(href.startsWith("data:image/svg+xml,"));
  assert.ok(href.includes("%233E7E71"));
  assert.ok(href.includes("%23A9D3C8"));
  assert.ok(!href.includes("<"));
});
