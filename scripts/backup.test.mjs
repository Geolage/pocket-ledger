import test from "node:test";
import assert from "node:assert/strict";
import { parseBackupJson, recordsToCsv, stateToBackup } from "../src/lib/backup.ts";
import { normalizeLedgerState } from "../src/lib/storage.ts";
import { BUILTIN_CATEGORIES } from "../src/lib/categories.ts";
import { DEFAULT_THEME } from "../src/lib/themes.ts";

const HEADER = "id,type,amount,category,date,note,createdAt";

const record = (overrides = {}) => ({
  id: "r1",
  type: "expense",
  amount: 12.34,
  category: "餐饮",
  date: "2026-11-05",
  note: "",
  createdAt: 1,
  ...overrides,
});

/**
 * 读回 recordsToCsv 写出的那种单元格：带引号的字符串里 "" 就是引号本身，换行也只是字符。
 * 要证明的是「一条备注里带换行的记录不会被读成两笔」，那只比字符串说不清，得真把它拆开看。
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let cellStarted = false;
  let quoted = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
    cellStarted = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') {
        cell += char;
        continue;
      }
      if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
        continue;
      }
      quoted = false;
      continue;
    }
    if (char === '"' && !cellStarted) {
      quoted = true;
      cellStarted = true;
      continue;
    }
    if (char === ",") {
      pushCell();
      continue;
    }
    if (char === "\n") {
      pushRow();
      continue;
    }
    cell += char;
    cellStarted = true;
  }
  // 文本结束时最后一格后面没有分隔符了，得自己收尾；以换行结尾则不补出一行空的。
  if (cellStarted || row.length) pushRow();
  return rows;
}

test("recordsToCsv escapes quotes and neutralizes formula cells", () => {
  const csv = recordsToCsv([record({ note: '=SUM(A1),"危险"' })]);

  assert.match(csv, new RegExp(`^${HEADER}\\r?\\n`));
  // 整行钉住：公式前缀在引号里面，备注自己的引号成对翻倍，金额这类数字不加引号。
  assert.equal(
    csv.split("\n")[1],
    `"r1","expense",12.34,"餐饮","2026-11-05","'=SUM(A1),""危险""",1`,
  );
});

test("recordsToCsv 给 = + - @ 开头的单元格加前缀，正常内容原样", () => {
  for (const note of ['=HYPERLINK("http://x")', "+1", "-2", "@SUM(A1)"]) {
    const cell = parseCsv(recordsToCsv([record({ note })]))[1][5];
    // 前缀要贴在内容最前面，且仍在引号之内——落在引号外就成了 CSV 语法错误。
    assert.equal(cell, `'${note}`);
  }

  // 反向对照：没有公式前缀的备注不该被莫名加一个引号，否则导出就改掉了用户写的话。
  const plain = parseCsv(recordsToCsv([record({ note: "午饭 3 人 AA" })]))[1][5];
  assert.equal(plain, "午饭 3 人 AA");
});

test("recordsToCsv 里逗号引号换行都关在同一个单元格内", () => {
  const note = '买菜，付了"现金"\n第二行备注';
  const rows = parseCsv(recordsToCsv([record({ note })]));

  // 备注里的换行不是新的一笔：物理行数比业务行数多，正是 CSV 最容易读错的地方。
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], HEADER.split(","));
  assert.equal(rows[1].length, 7);
  assert.equal(rows[1][5], note);
  assert.equal(rows[1][0], "r1");
});

test("没有记录时 CSV 只有表头，没有空行", () => {
  assert.equal(recordsToCsv([]), HEADER);
});

test("stateToBackup writes versioned JSON", () => {
  const json = stateToBackup({ records: [], budgets: {}, theme: "celadon", categories: [] });
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, 2);
  assert.equal(typeof parsed.exportedAt, "string");
  assert.deepEqual(parsed.records, []);
  assert.deepEqual(parsed.budgets, {});
  assert.equal(parsed.theme, "celadon");
  assert.deepEqual(parsed.categories, []);
  // 导出的文件是给用户存的，压成一行就没法 diff、也没人手改。
  assert.ok(json.includes("\n  "), json);
});

test("parseBackupJson accepts valid JSON and rejects malformed payloads", () => {
  const valid = parseBackupJson(
    JSON.stringify({
      records: [record()],
      budgets: { 餐饮: 100 },
      theme: "mist",
      categories: [],
    }),
  );
  assert.ok(valid);
  assert.equal(valid.theme, "mist");

  assert.equal(parseBackupJson("{bad"), null);
  assert.equal(parseBackupJson("[]"), null);
  // 数组与 null 都是合法的 JSON，却没有一份账本可读出来的东西。
  assert.equal(parseBackupJson("null"), null);
  assert.equal(parseBackupJson('"账本"'), null);
  assert.equal(parseBackupJson("42"), null);
  // 没有 records 数组，就不是这份文件想替换账本——宁可说一句格式无效。
  assert.equal(parseBackupJson("{}"), null);
  assert.equal(parseBackupJson('{"records":"全部"}'), null);
  assert.equal(parseBackupJson('{"records":{"a":1}}'), null);
});

test("parseBackupJson 丢掉校验不过的记录，而不是把它们交给状态", () => {
  const state = parseBackupJson(
    JSON.stringify({
      records: [
        record(),
        { id: "missing-fields" },
        record({ id: "bad-type", type: "转账" }),
        record({ id: "bad-amount", amount: "12" }),
        record({ id: "negative", amount: -5 }),
        record({ id: "bad-date", date: "2026-13-45" }),
        null,
        "不是对象",
      ],
    }),
  );

  assert.ok(state);
  // 只留得下那一条真记录：手改过的、恶意拼的负载永远进不了账本。
  assert.deepEqual(
    state.records.map((item) => item.id),
    ["r1"],
  );
});

test("parseBackupJson 交出来的记录是界面与导出都吃得下的形状", () => {
  const state = parseBackupJson(
    JSON.stringify({
      records: [
        record({ id: "note-object", note: { evil: 1 }, smuggled: "跟着落盘的私货" }),
        record({ id: "bad-stamp", createdAt: "yesterday" }),
      ],
    }),
  );

  assert.ok(state);
  // 这两笔都还是有效记录，该留着：备注与时间戳写错形状就当没写过，未知的键不带进状态。
  // 少这一道，账单列表会把对象当 React child 渲染而整页崩掉。
  assert.deepEqual(state.records, [
    {
      id: "note-object",
      type: "expense",
      amount: 12.34,
      category: "餐饮",
      date: "2026-11-05",
      createdAt: 1,
    },
    {
      id: "bad-stamp",
      type: "expense",
      amount: 12.34,
      category: "餐饮",
      date: "2026-11-05",
      note: "",
    },
  ]);
  // 导出那一侧对备注直接调 .replace（见 csvCell），所以它拿到的只可能是字符串或没有这一项。
  assert.equal(
    recordsToCsv(state.records).split("\n")[1],
    '"note-object","expense",12.34,"餐饮","2026-11-05","",1',
  );
});

test("parseBackupJson 归一化可疑的 theme、budgets 与 categories", () => {
  const state = parseBackupJson(
    JSON.stringify({
      records: [record(), record({ id: "r2", category: " 猫咖 " })],
      budgets: { 餐饮: -1, 交通: "abc", 购物: 50 },
      theme: "不存在的主题",
      categories: [
        // 自称内置项、还自带颜色的负载：内置与否由代码里的规范表说了算，不能由文件说了算。
        {
          id: "cat-餐饮",
          type: "expense",
          name: "餐饮",
          color: "#000000",
          disabled: false,
          builtin: true,
        },
        { id: 42, type: "expense", name: "自定义" },
      ],
    }),
  );

  assert.ok(state);
  assert.equal(state.theme, DEFAULT_THEME);
  assert.deepEqual(state.budgets, { 购物: 50 });

  const dining = state.categories.find(
    (category) => category.name === "餐饮" && category.type === "expense",
  );
  const canonical = BUILTIN_CATEGORIES.find(
    (category) => category.name === "餐饮" && category.type === "expense",
  );
  assert.deepEqual(dining, canonical);

  // 文件里没写过的分类也可能被记录用到：导入完不能留下一笔挂在没有定义的分类上的账。
  const cafe = state.categories.find((category) => category.name === "猫咖");
  assert.ok(cafe, "记录用到的分类要被补进列表");
  assert.equal(
    state.categories.some((category) => category.name === " 猫咖 "),
    false,
  );
  // 内置身份不认文件里那句 builtin：normalizeCategories 交出的是规范表的新拷贝，所以按键比而不是按引用。
  const builtinKeys = new Set(BUILTIN_CATEGORIES.map((item) => `${item.type}:${item.name}`));
  assert.equal(
    state.categories
      .filter((category) => !builtinKeys.has(`${category.type}:${category.name}`))
      .every((category) => category.builtin === false),
    true,
  );
});

test("stateToBackup 写出的文件原样读得回来", () => {
  // 先过一遍 normalizeLedgerState，比较的两端才是同一种形状：真实导入也是这个入口。
  const state = normalizeLedgerState({
    records: [
      record({ note: "导出再导回" }),
      record({ id: "r2", type: "income", category: "工资" }),
    ],
    budgets: { 餐饮: 4000 },
    theme: "mist",
    categories: normalizeLedgerState({ records: [] }).categories,
  });

  assert.deepEqual(parseBackupJson(stateToBackup(state)), state);
});
