import test from "node:test";
import assert from "node:assert/strict";
import { parseBackupJson, recordsToCsv, stateToBackup } from "../src/lib/backup.ts";
import { normalizeLedgerState } from "../src/lib/storage.ts";
import { BUILTIN_CATEGORIES } from "../src/lib/categories.ts";
import { DEFAULT_THEME } from "../src/lib/themes.ts";

const HEADER = "id,type,amount,category,date,note,createdAt";

/** 写出去的那个字节序标记：源码里它是个看不见的字符，所以只在这一处出现。 */
const BOM = "\ufeff";

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
function parseCsv(raw) {
  // 导出写出去的是表格软件认的那份字节：开头一个 BOM、行间 CRLF（见下面的形状测试）。
  // 这里先把它们还原成「一行一行」，因为下面这台状态机只认 \n。
  const text = raw.replace(/^\ufeff/, "").replace(/\r\n/g, "\n");
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

  // 整行钉住：公式前缀在引号里面，备注自己的引号成对翻倍，金额这类数字不加引号。
  assert.equal(
    csv.split(/\r\n/)[1],
    `"r1","expense",12.34,"餐饮","2026-11-05","'=SUM(A1),""危险""",1`,
  );
});

test("CSV 以 BOM 打头、行间用 CRLF：这份文件的唯一读者是表格软件", () => {
  // text/csv;charset=utf-8 那层声明只活在 MIME 头里，落到磁盘上的文件谁也不知道它声明过；
  // 中文 Windows 上的 Excel 于是按 GBK 去猜，餐饮与备注一律变乱码，而 BOM 是它唯一认得的 UTF-8 记号。
  // 行分隔同理：RFC 4180 把 CRLF 定为行尾，Excel 和 Windows 记事本都按它读，光给一个 LF 能被连成一行。
  // 整份文件钉住一次，BOM、CRLF 与「末行不补空行」三件事一起说清。
  assert.equal(
    recordsToCsv([record()]),
    BOM + HEADER + "\r\n" + '"r1","expense",12.34,"餐饮","2026-11-05","",1',
  );
  assert.equal(recordsToCsv([record()]).split(/\r\n/).length, 2);
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
  // BOM 照旧要有：一份只有表头的文件也是拿去 Excel 里开的；但行尾不补 CRLF，
  // 否则表头下面多出一行空的，Excel 里看着就像一笔没写内容的账。
  assert.equal(recordsToCsv([]), BOM + HEADER);
});

test("没有写入时刻的记录在 CSV 里留一个空数字格，而不是写着 undefined", () => {
  // createdAt 在旧数据与手改的备份里可能压根没有这一项（见 keepNormalizedRecords）。
  // String(undefined) 会把「undefined」这七个字母写进一列本该是数字的格子里，
  // 用户拿它做表就当成一个值去读；空着才是「这份文件没写过时刻」的说法。
  const stampless = {
    id: "r9",
    type: "expense",
    amount: 8.5,
    category: "交通",
    date: "2026-11-05",
    note: "地铁",
  };

  assert.equal(parseCsv(recordsToCsv([stampless]))[1][6], "");
  // 整行钉住：那一格一个字符都没有，行尾直接是逗号。
  assert.equal(
    recordsToCsv([stampless]).split(/\r?\n/)[1],
    '"r9","expense",8.5,"交通","2026-11-05","地铁",',
  );

  // 反向对照：同一份记录补上时刻，那一格就写数字，说明上面那个空格测的确实是缺项。
  assert.equal(
    recordsToCsv([{ ...stampless, createdAt: 1732500000000 }]).split(/\r?\n/)[1],
    '"r9","expense",8.5,"交通","2026-11-05","地铁",1732500000000',
  );
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
  // JSON 不套 BOM：它的读者是解析器，而 JSON.parse 见了 BOM 直接抛——那个记号只有表格软件要。
  assert.equal(json.startsWith(BOM), false);
});

test("parseBackupJson 只读自己认得的版本：比当前格式新的文件一律拒掉", () => {
  // version 这一行存在的唯一理由，就是让以后改了字段形状时能把话说清楚：这份我不认识，别硬读。
  // 现在的文件写的是 2（见 BACKUP_VERSION），所以任何比它新的号都落在读得懂的范围之外。
  assert.equal(parseBackupJson(JSON.stringify({ version: 3, records: [record()] })), null);
  // 手改过的文件常把数字写成字符串：写着 "3" 的文件和写着 3 的是同一句话。
  assert.equal(parseBackupJson(JSON.stringify({ version: "3", records: [record()] })), null);

  // 反向对照：更老的文件、压根没写版本的文件照样读得懂——归一化这道门本来就是为它们开的。
  const older = parseBackupJson(JSON.stringify({ version: 1, records: [record()] }));
  assert.ok(older);
  assert.deepEqual(
    older.records.map((item) => item.id),
    ["r1"],
  );
  assert.ok(parseBackupJson(JSON.stringify({ records: [record()] })));
  // 写成一串读不出数字的东西也不在这道门上拦：能落进状态的字段自有 normalizeLedgerState 把关。
  assert.ok(parseBackupJson(JSON.stringify({ version: "昨天", records: [record()] })));
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
    recordsToCsv(state.records).split(/\r\n/)[1],
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
