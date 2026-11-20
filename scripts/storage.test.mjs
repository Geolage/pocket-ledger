import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_CATEGORIES } from "../src/lib/categories.ts";
import { budgetSummary, dailyExpenses, expensesByCategory } from "../src/lib/ledger.ts";
import { DEFAULT_THEME } from "../src/lib/themes.ts";
import {
  STORAGE_KEY,
  canonicalCategories,
  demoState,
  ledgerStatesEqual,
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

/**
 * isValidRecord 只认 id/type/amount/category/date（见 ledger.ts），备注与时间戳写着什么它不管，
 * 而账单列表直接渲染 record.note、同一天还按 createdAt 排序。所以「校验得过」和「用得上」之间
 * 差着 keepNormalizedRecords 这一道：记录要按已知的键重建，而不是原样摊进状态。
 * loadState 与 parseBackupJson 走的都是这一道，本机存储与用户手改的备份因此是同一套判法。
 */
test("normalizeLedgerState 只按已知的键重建记录，脏备注与脏时间戳都进不了状态", () => {
  const state = normalizeLedgerState({
    records: [
      {
        id: "dirty",
        type: "expense",
        amount: 10,
        category: "餐饮",
        date: "2026-11-05",
        note: { evil: 1 }, // 对象会被 React 当成 child 直接抛错，整页下线
        createdAt: "yesterday", // 排序时是 NaN，同月的上下排列就全乱了
        smuggled: "跟着落盘的私货",
        ["__proto__"]: { polluted: true }, // 手改的文件里什么键都可能多出来一个
      },
    ],
  });

  // 那一笔本身是有效数据，该留着——只是脏字段要当成没写过、未知键一个不带。
  assert.deepEqual(state.records, [
    { id: "dirty", type: "expense", amount: 10, category: "餐饮", date: "2026-11-05" },
  ]);
  assert.equal(Object.hasOwn(state.records[0], "smuggled"), false);
});

test("normalizeLedgerState 不替缺了备注或时间戳的旧记录补值", () => {
  const legacy = { id: "legacy", type: "expense", amount: 8, category: "交通", date: "2026-11-05" };
  const state = normalizeLedgerState({ records: [legacy] });

  // 没有 note 这一项本身就是合法形状（界面渲染成「无备注」，关键词筛选也按空串算），
  // 补一个 "" 等于往用户的旧数据里写字；createdAt 缺着同理，两处必须是同一种处理。
  assert.deepEqual(state.records, [legacy]);
  assert.equal(Object.hasOwn(state.records[0], "note"), false);
  assert.equal(Object.hasOwn(state.records[0], "createdAt"), false);
});

test("normalizeLedgerState 丢掉算不出分的金额，落盘的字节因此导得回来", () => {
  // 1e308 是有限正数，可 cents() 乘 100 会溢出成 Infinity：统计里加出 Infinity，
  // JSON.stringify 又把 Infinity 写成 null，下一次读回来这条预算就凭空消失了。
  // 「导出去再导回来对不上」不能成为界面的既定行为。
  const state = normalizeLedgerState({
    records: [record({ id: "ok", amount: 10 }), record({ id: "overflow", amount: 1e308 })],
    budgets: { 餐饮: 1e308, 交通: 50, 住房: Number.NaN, 购物: "35.5" },
  });

  assert.deepEqual(
    state.records.map((item) => item.id),
    ["ok"],
  );
  // 字符串写法照样收（Number 转得动、分也算得出），过界与读不出数的才被丢掉。
  assert.deepEqual(state.budgets, { 交通: 50, 购物: 35.5 });
});

test("loadState 也不让盘里那份脏备注进状态", () => {
  reset();
  // 备份导入这条路是新的，本机存储这条路一直如此：同一个 normaliser，缺的正是这一条。
  files.set(
    STORAGE_KEY,
    '{"records":[{"id":"a","type":"expense","amount":1,"category":"餐饮","date":"2026-11-05","note":{"evil":1}}]}',
  );

  const { state } = loadState();
  assert.deepEqual(state.records, [
    { id: "a", type: "expense", amount: 1, category: "餐饮", date: "2026-11-05" },
  ]);
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

/* 恢复演示/清空是不是真的没得可换，全靠 ledgerStatesEqual 说话，所以它自己得先说得准。 */
const stateSlice = (overrides = {}) => ({
  records: [record({ id: "a" }), record({ id: "b", category: "交通", amount: 20 })],
  budgets: { 餐饮: 100 },
  theme: DEFAULT_THEME,
  categories: canonicalCategories(),
  ...overrides,
});

test("ledgerStatesEqual 只看用户看得见的内容，不看每次重新生成的 id", () => {
  const freshIds = stateSlice({
    records: [record({ id: "x" }), record({ id: "y", category: "交通", amount: 20 })],
    categories: canonicalCategories(),
  });
  assert.equal(ledgerStatesEqual(stateSlice(), freshIds), true);

  // 演示数据每调一次就换一批 id：比 id 的话这里永远说「换了东西」，
  // 于是「恢复演示」即便什么都没改动也照样留一个撤不回来的按钮。
  assert.equal(ledgerStatesEqual(demoState(), demoState()), true);
});

test("ledgerStatesEqual 分得清金额、备注、顺序、预算、分类与主题的改动", () => {
  const base = stateSlice();
  const [first, second] = base.records;

  const changes = [
    stateSlice({ records: [record({ id: "a", amount: 11 }), second] }),
    stateSlice({ records: [record({ id: "a", note: "改了备注" }), second] }),
    // 顺序同样算内容：账单列表就按这个顺序排。
    stateSlice({ records: [second, first] }),
    stateSlice({ records: [first] }),
    stateSlice({ records: [] }),
    stateSlice({ budgets: { 餐饮: 100, 交通: 50 } }),
    stateSlice({ budgets: {} }),
    stateSlice({ theme: "mist" }),
  ];
  for (const next of changes) assert.equal(ledgerStatesEqual(base, next), false);

  const disabled = stateSlice();
  disabled.categories[0].disabled = true;
  assert.equal(ledgerStatesEqual(base, disabled), false);
});

test("ledgerStatesEqual 把「没写备注」与「备注是空串」看成同一份内容", () => {
  // 备注这一项缺着、还是写着 ""，在界面上都是「无备注」，编辑与 CSV 也一律按空串算
  // （见 applyRecordDraftById 与 recordsToCsv）。这份比较要是把两者当成两种内容，
  // 一次什么都没改动的导入就会被判成改动：白落一笔盘，顺带放行降级状态里唯一留着的那份原始数据。
  const noted = record({ id: "b", category: "交通", amount: 20 });
  const noteless = stateSlice({
    records: [
      { id: "a", type: "expense", amount: 10, category: "餐饮", date: "2026-11-05", createdAt: 1 },
      noted,
    ],
  });
  assert.equal(ledgerStatesEqual(noteless, stateSlice()), true);

  // 反向对照：真写了字的备注照样算一次改动，这条不是把比较松成一律相等。
  assert.equal(
    ledgerStatesEqual(
      noteless,
      stateSlice({ records: [record({ id: "a", note: "午餐" }), noted] }),
    ),
    false,
  );
});

test("demoState 给同一天的每一笔都留了不一样的写入时刻", () => {
  // 同日排序碰到并列只能按 id 收口，而 id 是随机生成的：演示数据一天里常有几笔，
  // 时刻要是全撞在同一毫秒，用户每次按「恢复演示」都会看到一屏顺序不同的账单。
  const stamps = demoState().records.map((item) => `${item.date}#${item.createdAt}`);
  assert.ok(stamps.length > 0);
  assert.equal(new Set(stamps).size, stamps.length);
  assert.ok(stamps.every((stamp) => !stamp.endsWith("#undefined")));
});

test("ledgerStatesEqual 把两份空状态看成一致", () => {
  const empty = stateSlice({ records: [], budgets: {} });
  assert.equal(ledgerStatesEqual(empty, stateSlice({ records: [], budgets: {} })), true);
});
