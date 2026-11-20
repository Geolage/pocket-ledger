import test from "node:test";
import assert from "node:assert/strict";
import * as ledger from "../src/lib/ledger.ts";
import { BUILTIN_CATEGORIES } from "../src/lib/categories.ts";
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

/** 与 record() 同默认值的表单草稿：两个都不给 overrides 时就是一次「原样存回去」。 */
function draft(overrides = {}) {
  return {
    type: "expense",
    amount: 10,
    category: "餐饮",
    date: "2026-11-05",
    note: "",
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
  assert.deepEqual(ledger.categoriesFor("expense", BUILTIN_CATEGORIES), ledger.EXPENSE_CATEGORIES);
  assert.deepEqual(ledger.categoriesFor("income", BUILTIN_CATEGORIES), ledger.INCOME_CATEGORIES);

  const colors = ledger.categoryColorIndex(BUILTIN_CATEGORIES);
  assert.equal(ledger.colorOf(colors, "餐饮", "expense"), "var(--cat-1)");
  assert.equal(ledger.colorOf(colors, "不存在", "expense"), ledger.DEFAULT_COLOR);
});

test("shared category constants cannot be mutated by consumers", () => {
  // 这三份是记录、预算与图表取值的共同键，被哪个模块原地改一下就全对不上了。
  assert.ok(Object.isFrozen(ledger.EXPENSE_CATEGORIES));
  assert.ok(Object.isFrozen(ledger.INCOME_CATEGORIES));
  assert.ok(Object.isFrozen(ledger.CATEGORY_COLOR));

  // 严格模式下原地赋值直接抛错，谁都改不动内置清单。
  assert.throws(() => ledger.EXPENSE_CATEGORIES.push("宠物"), TypeError);
  assert.throws(() => (ledger.CATEGORY_COLOR.餐饮 = "#f00"), TypeError);
  assert.deepEqual([...ledger.EXPENSE_CATEGORIES].slice(0, 2), ["餐饮", "交通"]);

  // 复制出来改是安全的：下发的是新数组，不影响模块里那一份。
  const copy = [...ledger.EXPENSE_CATEGORIES];
  copy.length = 0;
  assert.equal(ledger.EXPENSE_CATEGORIES.length, 8);
});

test("the color index resolves by type so a shared name keeps two colors", () => {
  // 预算与颜色都按名字取值，同名跨类型必须靠 type 才分得开。
  const mixed = [
    {
      id: "expense:宠物",
      type: "expense",
      name: "宠物",
      color: "var(--cat-1)",
      disabled: false,
      builtin: false,
    },
    {
      id: "income:宠物",
      type: "income",
      name: "宠物",
      color: "var(--cat-6)",
      disabled: false,
      builtin: false,
    },
  ];

  const colors = ledger.categoryColorIndex(mixed);
  assert.equal(ledger.colorOf(colors, "宠物", "expense"), "var(--cat-1)");
  assert.equal(ledger.colorOf(colors, "宠物", "income"), "var(--cat-6)");
  assert.equal(
    ledger.colorOf(ledger.categoryColorIndex(BUILTIN_CATEGORIES), "宠物", "expense"),
    ledger.DEFAULT_COLOR,
  );
});

test("enabledNames skips disabled categories and the other type", () => {
  const categories = BUILTIN_CATEGORIES.map((category) =>
    category.name === "交通" || category.name === "副业"
      ? { ...category, disabled: true }
      : category,
  );

  assert.deepEqual(ledger.enabledNames(categories, "expense"), [
    "餐饮",
    "购物",
    "居住",
    "娱乐",
    "医疗",
    "教育",
    "其他",
  ]);
  assert.deepEqual(ledger.enabledNames(categories, "income"), ["工资", "奖金", "理财", "其他收入"]);
  assert.deepEqual(ledger.enabledNames([], "expense"), []);
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
    BUILTIN_CATEGORIES,
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
  const summary = ledger.budgetSummary(
    [record({ id: "a", category: "餐饮", amount: 10 })],
    {
      餐饮: 0,
      交通: -1,
      购物: Number.NaN,
      娱乐: 50,
    },
    BUILTIN_CATEGORIES,
  );
  assert.deepEqual(
    summary.rows.map((row) => row.category),
    ["娱乐"],
  );
  assert.equal(summary.totalBudget, 50);
  assert.equal(summary.totalSpent, 0);
});

test("budgetSummary skips disabled categories in rows, totals and over count", () => {
  const categories = BUILTIN_CATEGORIES.map((category) =>
    category.name === "交通" || category.name === "工资"
      ? { ...category, disabled: true }
      : category,
  );

  const summary = ledger.budgetSummary(
    [
      record({ id: "a", category: "餐饮", amount: 40 }),
      // 停用分类里的超支记录不能再进预算行。
      record({ id: "b", category: "交通", amount: 500 }),
      record({ id: "c", category: "工资", amount: 999, type: "income" }),
    ],
    { 餐饮: 100, 交通: 100 },
    categories,
  );

  assert.deepEqual(
    summary.rows.map((row) => row.category),
    ["餐饮"],
  );
  assert.equal(summary.totalBudget, 100);
  assert.equal(summary.totalSpent, 40);
  assert.equal(summary.remaining, 60);
  assert.equal(summary.overCount, 0);
});

test("removeRecordById 找不到那笔时返回 null，而不是一个内容相同的新数组", () => {
  const records = [record({ id: "a" }), record({ id: "b" })];

  // filter 每次都造新数组，光比引用分不出「删掉了一笔」和「压根没有这一笔」。
  // 给不给撤销动作就看这个区别，所以判定得留在领域层。
  assert.equal(ledger.removeRecordById(records, "missing"), null);
  assert.equal(ledger.removeRecordById([], "a"), null);
  assert.equal(records.length, 2);
});

test("removeRecordById 只去掉命中的那一笔，不动传进去的列表", () => {
  const records = [record({ id: "a" }), record({ id: "b" })];
  const next = ledger.removeRecordById(records, "a");

  assert.ok(next);
  assert.deepEqual(
    next.map((item) => item.id),
    ["b"],
  );
  assert.equal(records.length, 2);
});

test("applyRecordDraftById 原样存回去时返回 null，而不是内容相同的新列表", () => {
  const records = [record({ id: "a" }), record({ id: "b" })];

  // map 每次都造新数组和新对象，光比引用分不出「改了一笔」和「一个字没改的保存」。
  // 落不落盘、放行不放行降级状态、上一步撤销留不留全看这个区别，所以判定得留在领域层。
  assert.equal(ledger.applyRecordDraftById(records, "a", draft()), null);
  // 金额按分比：浮点噪声与表单的两位小数归一化都不该被当成改动。
  assert.equal(
    ledger.applyRecordDraftById(
      [record({ id: "a", amount: 0.3 })],
      "a",
      draft({ amount: 0.1 + 0.2 }),
    ),
    null,
  );
  // 分类名先去空格再比：输入框里手打的空格不算改名。
  assert.equal(
    ledger.applyRecordDraftById(
      [record({ id: "a", category: "餐饮" })],
      "a",
      draft({ category: " 餐饮 " }),
    ),
    null,
  );
  // 旧数据里没有备注这一项时界面渲染的就是空串，所以这句「没改动」照旧成立。
  assert.equal(
    ledger.applyRecordDraftById(
      [
        {
          id: "a",
          type: "expense",
          amount: 10,
          category: "餐饮",
          date: "2026-11-05",
          createdAt: 1,
        },
      ],
      "a",
      draft(),
    ),
    null,
  );
  // id 不在列表里同样一笔都没改到：一次碰不到任何记录的保存没资格改动账本。
  assert.equal(ledger.applyRecordDraftById(records, "missing", draft({ amount: 99 })), null);
  assert.equal(ledger.applyRecordDraftById([], "a", draft()), null);
  assert.equal(records.length, 2);
});

test("applyRecordDraftById 改到内容才给新列表，并保住 createdAt 与其余每一笔", () => {
  const records = [record({ id: "a", note: "午餐" }), record({ id: "b" })];
  const next = ledger.applyRecordDraftById(
    records,
    "a",
    draft({ amount: 42.5, category: " 交通 ", note: "晚餐" }),
  );

  assert.ok(next);
  assert.notEqual(next, records);
  assert.deepEqual(next[0], {
    id: "a",
    type: "expense",
    amount: 42.5,
    category: "交通",
    date: "2026-11-05",
    note: "晚餐",
    // createdAt 是同日排序的依据，编辑一笔不该把它推到最新。
    createdAt: 1,
  });
  // 没命中的那笔连引用都没换，React 因此不会为它重渲染。
  assert.equal(next[1], records[1]);
  // 传进去的列表不被原地修改。
  assert.equal(records[0].note, "午餐");

  // 类型、日期也是用户看得见的一项，换掉它们就算一次改动。
  assert.ok(ledger.applyRecordDraftById([record({ id: "a" })], "a", draft({ type: "income" })));
  assert.ok(ledger.applyRecordDraftById([record({ id: "a" })], "a", draft({ date: "2026-11-06" })));
});

test("setBudgetAmount 预算没变时返回 null，而不是内容相同的新对象", () => {
  const budgets = { 餐饮: 100, 交通: 50 };

  // 预算表每次都造新对象，而 writer 只认引用：原样保存也算「改过了」，
  // 于是白落一笔盘、放行降级状态、关掉撤销窗口——判定的口径要和写入口径一致。
  assert.equal(ledger.setBudgetAmount(budgets, "餐饮", 100), null);
  assert.equal(ledger.setBudgetAmount(budgets, " 餐饮 ", 100), null);
  assert.equal(ledger.setBudgetAmount({ 餐饮: 0.3 }, "餐饮", 0.1 + 0.2), null);
  // 0 本来就写在那里，原样保存同样没改任何东西。
  assert.equal(ledger.setBudgetAmount({ 餐饮: 0 }, "餐饮", 0), null);
  assert.deepEqual(budgets, { 餐饮: 100, 交通: 50 });
});

test("setBudgetAmount 写出归一化后的预算，其余键原样保留", () => {
  const budgets = { 餐饮: 100, 交通: 50 };
  const next = ledger.setBudgetAmount(budgets, " 购物 ", 10.111);

  assert.ok(next);
  assert.notEqual(next, budgets);
  assert.deepEqual(next, { 餐饮: 100, 交通: 50, 购物: 10.11 });
  // 传进去的对象不被原地修改。
  assert.equal(Object.keys(budgets).length, 2);

  // 还没有这条预算时，即便要写 0 也是一次真改动：表里从此多了这个键。
  assert.deepEqual(ledger.setBudgetAmount({}, "餐饮", 0), { 餐饮: 0 });
  // 盘里读回来的脏值按分比不出数，就照改动重写一遍归一化后的值。
  assert.deepEqual(ledger.setBudgetAmount({ 餐饮: Number.NaN }, "餐饮", 100), { 餐饮: 100 });
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
