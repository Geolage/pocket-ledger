/* 备份与恢复这一整块：导出要写出真能打开的文件，导入要先预览、确认了才换账本。 */

import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  addExpense,
  armStorageWriteCounter,
  deleteWithConfirm,
  readStorageWrites,
} from "./helpers";

const backupRegion = (page: Page) => page.getByRole("region", { name: "备份与恢复" });

/**
 * 导入会把月份视图跳回当月，所以测试里的记录要落在今天，导完才在屏幕上看得见。
 * 写死一个日期就是给自己埋一颗跨年就会炸的雷。
 */
function todayKey(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 点「导入 JSON」，把内存里这份内容当成用户选中的文件交出去。 */
async function pickBackupFile(page: Page, content: string) {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const chooserPromise = page.waitForEvent("filechooser");
  await backupRegion(page).getByRole("button", { name: "导入 JSON" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(content),
  });
}

/**
 * 点一个导出按钮，并把 Playwright 存下来的那份下载读成文本。
 * 只断言建议文件名等于什么都没测：文件得真被写出来，内容才算数。
 */
async function downloadBackup(page: Page, buttonName: string) {
  const downloadPromise = page.waitForEvent("download");
  await backupRegion(page).getByRole("button", { name: buttonName }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error(`${buttonName} 没有真的写出文件`);
  return { filename: download.suggestedFilename(), text: readFileSync(path, "utf8") };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
});

test("导出 JSON 与 CSV：文件名带上今天日期，内容就是刚记下的那一笔", async ({ page }) => {
  await addExpense(page, "88.50", "导出用的午餐");

  const json = await downloadBackup(page, "导出 JSON");
  expect(json.filename).toMatch(/^pocket-ledger-backup-\d{4}-\d{2}-\d{2}\.json$/);
  // JSON 不套 BOM：它的读者是解析器，而 JSON.parse 见了 BOM 直接抛——那份字节要求只属于 CSV。
  expect(json.text.startsWith("{")).toBe(true);
  const backup = JSON.parse(json.text) as {
    version: number;
    exportedAt: string;
    records: Array<{ note?: string; amount: number }>;
  };
  expect(backup.version).toBe(2);
  expect(Number.isNaN(Date.parse(backup.exportedAt))).toBe(false);
  expect(backup.records.find((record) => record.note === "导出用的午餐")?.amount).toBe(88.5);
  await expect(page.getByText("已导出 JSON 备份")).toBeVisible();

  const csv = await downloadBackup(page, "导出 CSV");
  expect(csv.filename).toMatch(/^pocket-ledger-records-\d{4}-\d{2}-\d{2}\.csv$/);
  // 字节形状一起钉住：BOM 打头、行间 CRLF——这份文件的唯一读者是表格软件（见 recordsToCsv）。
  // BOM 在源码里是个看不见的字符，所以断言写成代码点：读的人看得见它在比什么。
  expect(csv.text.startsWith(String.fromCodePoint(0xfeff))).toBe(true);
  expect(csv.text.slice(1).split("\r\n")[0]).toBe("id,type,amount,category,date,note,createdAt");
  const row = csv.text.split(/\r\n/).find((line) => line.includes("导出用的午餐"));
  expect(row).toBeDefined();
  // 字符串单元格带引号、数字不带：这一行是用户拿到表格软件里要直接看的。
  expect(row).toContain('"餐饮"');
  expect(row).toContain(",88.5,");
});

test("导出的下载交出去之后才收回对象 URL", async ({ page }) => {
  await addExpense(page, "12.00", "要看住收回时机的一笔");
  // anchor.click() 只是把下载交给浏览器，同一趟任务里就 URL.revokeObjectURL，
  // Safari 与 Firefox 真会把这次下载取消掉——而「已导出…」那句已经报出去了，界面说了假话。
  // Chromium 不复现这个竞争，所以这里只能盯收回的时机本身：revoke 必须落在 click 之后的下一趟任务。
  await page.evaluate(() => {
    const trace: string[] = [];
    (window as unknown as { downloadTrace: string[] }).downloadTrace = trace;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (
      this: HTMLAnchorElement,
      ...args: Parameters<typeof click>
    ) {
      trace.push("click");
      // 这一句排在 revoke 之前注册：click 交出去之后、任何延后的收回之前，它必然先落地。
      setTimeout(() => trace.push("next-task"), 0);
      return click.apply(this, args);
    };
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (...args: Parameters<typeof revoke>) => {
      trace.push("revoke");
      return revoke.apply(URL, args);
    };
  });

  for (const button of ["导出 CSV", "导出 JSON"]) {
    await downloadBackup(page, button);
  }

  const trace = await page.evaluate(
    () => (window as unknown as { downloadTrace: string[] }).downloadTrace,
  );
  expect(trace).toEqual(["click", "next-task", "revoke", "click", "next-task", "revoke"]);
});

test("导入 JSON 先给预览，确认后替换账本，撤销还回原来那一屏", async ({ page }) => {
  await addExpense(page, "12.00", "导入前的那笔");
  await pickBackupFile(
    page,
    JSON.stringify({
      version: 2,
      records: [
        {
          id: "imported-1",
          type: "expense",
          amount: 18.88,
          category: "餐饮",
          date: todayKey(),
          note: "导入测试晚餐",
          createdAt: 1,
        },
      ],
      budgets: { 餐饮: 200 },
      theme: "mist",
      categories: [],
    }),
  );

  const preview = backupRegion(page).getByRole("status");
  await expect(preview).toContainText("将导入 1 笔记录、1 个预算");
  // 正常账本没有「保留下来的读不出来的原始数据」，那句话就不能出现在这里。
  await expect(preview).not.toContainText("原始数据");

  await preview.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("导入测试晚餐")).toBeVisible();
  await expect(page.getByText("导入前的那笔")).toHaveCount(0);
  await expect(page.getByText("已导入 1 笔记录")).toBeVisible();
  // 负载里的主题也跟着进来：这是唯一一条「换了主题还留着上一步撤销」的路，撤销快照带上主题就为了它。
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mist");

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("导入前的那笔")).toBeVisible();
  await expect(page.getByText("导入测试晚餐")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "celadon");
});

test("导入与当前账本一模一样的备份：不落盘、不说成功、不给撤销", async ({ page }) => {
  await addExpense(page, "66.00", "导出再导回的那笔");
  const exported = await downloadBackup(page, "导出 JSON");
  // 导回来的就是这份文件本身：里面那句 exportedAt 每次导出都不同，可落盘的那四份状态一个字没变。

  await armStorageWriteCounter(page);
  const writesBefore = await readStorageWrites(page);

  await pickBackupFile(page, exported.text);
  await expect(backupRegion(page).getByRole("status")).toContainText("将导入");
  await backupRegion(page).getByRole("button", { name: "确认导入" }).click();

  await expect(page.getByText("这份备份与当前账本一模一样，没有导入任何内容")).toBeVisible();
  await expect(page.getByText(/^已导入/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await expect(page.getByText("导出再导回的那笔")).toBeVisible();

  // 断言「没有多出一次落盘」要等 React 把那一次提交走完，否则读得早点晚点都一样。
  await page.waitForTimeout(250);
  expect(await readStorageWrites(page)).toBe(writesBefore);

  // 反向对照：同一份文件改掉一笔金额再导一次，这个计数器就看见了——上面那句「一次都没多」不是空断言。
  const changed = JSON.parse(exported.text) as { records: Array<{ amount: number }> };
  changed.records[0].amount += 1;
  await pickBackupFile(page, JSON.stringify(changed));
  await backupRegion(page).getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText(/^已导入/)).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();
  await expect.poll(() => readStorageWrites(page)).toBeGreaterThan(writesBefore);
});

test("降级视图下导入：先说清覆盖的是保留下来的原始数据，取消则一个字不动", async ({ page }) => {
  const readStored = () => page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));

  const poisoned = "null";
  await page.addInitScript((raw) => {
    localStorage.setItem("pocket-ledger.v1", raw);
  }, poisoned);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();

  const backup = JSON.stringify({
    records: [
      {
        id: "imported-1",
        type: "expense",
        amount: 18.88,
        category: "餐饮",
        date: todayKey(),
        note: "降级视图导进来的那笔",
        createdAt: 1,
      },
    ],
    budgets: {},
    theme: "celadon",
    categories: [],
  });

  await pickBackupFile(page, backup);
  const preview = backupRegion(page).getByRole("status");
  await expect(preview).toContainText("将导入 1 笔记录、0 个预算");
  // 警告那一句自己是 alert，预览整块不是：标成 assertive 的容器会连两颗按钮的名字一起打断用户念出来。
  await expect(backupRegion(page).getByRole("alert")).toContainText(
    "确认导入会覆盖系统保留的那份无法读取的原始数据，覆盖后无法找回；之后的「撤销」只把账本还原成导入之前那样。",
  );

  await backupRegion(page).getByRole("button", { name: "取消" }).click();
  await expect(preview).toHaveCount(0);
  // 没按下确认，那句「系统不会自动覆盖原始数据」就还是真话。
  await expect(readStored()).resolves.toBe(poisoned);
  await expect(page.getByRole("status").filter({ hasText: "安全恢复视图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);

  // 反向对照：同一份文件真确认下去，警告里说的覆盖当场发生——它不是写在界面上的装饰。
  await pickBackupFile(page, backup);
  await backupRegion(page).getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("降级视图导进来的那笔")).toBeVisible();
  await expect(readStored()).resolves.not.toBe(poisoned);
  await expect(page.getByText(/安全恢复视图/)).toHaveCount(0);

  // 撤销照旧给，但它给的只有「导入前那一屏」：这一笔退回去了，盘里那份原始数据却回不来。
  // 警告后半句说的就是这个分工，这两行断言就是它的凭据——按钮不是「覆盖也能退回去」的意思。
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("降级视图导进来的那笔")).toHaveCount(0);
  await expect(readStored()).resolves.not.toBe(poisoned);
});

test("格式无效的备份文件只说一句无效，账本与提示外的界面都不动", async ({ page }) => {
  await addExpense(page, "33.00", "不该被导入动到的一笔");
  const storedBefore = await page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));

  // 读不出内容的、内容不是账本的、缺 records 的：三样都只能换来同一句话。
  for (const content of ["{not json", "[]", '{"budgets":{"餐饮":100}}']) {
    await pickBackupFile(page, content);
    await expect(page.getByText("备份文件格式无效，请重新导出")).toBeVisible();
    await expect(backupRegion(page).getByRole("status")).toHaveCount(0);
  }

  // 反向对照：同一颗按钮换一份读得懂的文件，预览就在那里——上面那句「没有预览」不是定位器空转。
  await pickBackupFile(
    page,
    JSON.stringify({
      records: [
        {
          id: "valid-1",
          type: "expense",
          amount: 6,
          category: "餐饮",
          date: todayKey(),
          note: "读得懂的那份",
          createdAt: 1,
        },
      ],
      budgets: {},
    }),
  );
  await expect(backupRegion(page).getByRole("status")).toContainText("将导入 1 笔记录");
  await backupRegion(page).getByRole("button", { name: "取消" }).click();

  await expect(page.getByText("不该被导入动到的一笔")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await expect(page.evaluate(() => localStorage.getItem("pocket-ledger.v1"))).resolves.toBe(
    storedBefore,
  );
});

test("带着关键词导入内容相同的备份：重置的是这一屏，不是盘里那份原始数据", async ({ page }) => {
  const readStored = () => page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));

  const poisoned = "null";
  await page.addInitScript((raw) => {
    localStorage.setItem("pocket-ledger.v1", raw);
  }, poisoned);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();

  // 这份文件和降级视图读出来的状态一模一样：没有记录、没有预算、主题与内置分类都是规范那套。
  await pickBackupFile(page, '{"records":[]}');
  const keyword = page.locator("#filter-keyword");
  await keyword.fill("房租");
  await expect(backupRegion(page).getByRole("status")).toContainText("将导入 0 笔记录");

  await backupRegion(page).getByRole("button", { name: "确认导入" }).click();
  // 关键词被这一步清掉了，所以它是一次真改动、值得留一步撤销；但它一个字都没往盘里写，
  // 也就没有资格放行降级状态——解析出来的对象每次都是新的，比内容而不是比引用才拦得住这一笔。
  await expect(keyword).toHaveValue("");
  await expect(readStored()).resolves.toBe(poisoned);
  await expect(page.getByRole("status").filter({ hasText: "安全恢复视图" })).toBeVisible();

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(keyword).toHaveValue("房租");
  await expect(readStored()).resolves.toBe(poisoned);

  // 反向对照：同一颗按钮换一份真有内容的文件，原始数据当场被盖掉——上面那两句「还是 null」不是死局。
  await pickBackupFile(
    page,
    JSON.stringify({
      records: [
        {
          id: "real-1",
          type: "expense",
          amount: 9,
          category: "餐饮",
          date: todayKey(),
          note: "真的换了账本的那笔",
          createdAt: 1,
        },
      ],
      budgets: {},
    }),
  );
  await backupRegion(page).getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("真的换了账本的那笔")).toBeVisible();
  await expect(readStored()).resolves.not.toBe(poisoned);
});

test("导入备注写着对象的备份：这一笔按空备注显示，界面不整页崩掉", async ({ page }) => {
  const stored = () => page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));
  const record = (note: unknown) => ({
    id: "hostile-note",
    type: "expense",
    amount: 6.5,
    category: "餐饮",
    date: todayKey(),
    note,
    // 备注坏、时间戳好：这一笔过了 isValidRecord（它压根不看备注），要防的就是备注自己。
    createdAt: 1,
    smuggled: "文件里多出来的键",
  });

  // 反向对照先走同一条记录写着正常备注的那份：账单里读得到那句话，也读不到「无备注」，
  // 所以下面那句「显示无备注」测的确实是被丢掉的那一项，而不是定位器一直匹配不到东西。
  await pickBackupFile(page, JSON.stringify({ records: [record("正常备注")], budgets: {} }));
  await backupRegion(page).getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "正常备注" })).toHaveCount(1);
  await expect(page.getByText("无备注")).toHaveCount(0);

  await pickBackupFile(page, JSON.stringify({ records: [record({ evil: 1 })], budgets: {} }));
  await backupRegion(page).getByRole("button", { name: "确认导入" }).click();

  // 整页崩掉的现场是组件树被 React 卸载：连最上面那个标题都不会在，下面每一步都无从谈起。
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  // 备注只能算「没有写」，走界面本来就有那句「无备注」，不是新加的一种占位。
  const noteless = page.getByRole("listitem").filter({ hasText: "无备注" });
  await expect(noteless).toHaveCount(1);
  await expect(noteless).toContainText("−¥6.50");

  // 界面还活着：记一笔这条路照旧走得通。
  await addExpense(page, "7.00", "崩掉之后还能记一笔");
  await expect(page.getByText("崩掉之后还能记一笔")).toBeVisible();

  // 导出也写得出来（csvCell 对备注直接调 .replace），脏备注与多出来的键都不落盘。
  const csv = await downloadBackup(page, "导出 CSV");
  const row = csv.text.split(/\r\n/).find((line) => line.includes("hostile-note"));
  expect(row).toBeDefined();
  expect(row).toContain('"hostile-note","expense",6.5,"餐饮"');
  await expect(stored()).resolves.not.toContain("evil");
  await expect(stored()).resolves.not.toContain("smuggled");
});

test("导出 CSV 不花掉正在计时的撤销，导入照样把它顶掉", async ({ page }) => {
  await addExpense(page, "31.00", "导出期间还想撤的那笔");
  await deleteWithConfirm(page, "导出期间还想撤的那笔");

  const csv = await downloadBackup(page, "导出 CSV");
  expect(csv.filename).toMatch(/^pocket-ledger-records-\d{4}-\d{2}-\d{2}\.csv$/);

  // 导出没写任何数据，也没撤掉任何东西：屏幕上那颗「撤销」还是上一步删除的，而且只有一颗。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(1);

  // 导出那句话自己收起（它不带按钮），收起后那颗按钮照旧点得动。
  await expect(page.getByText(/^已导出/)).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("导出期间还想撤的那笔")).toBeVisible();

  // 反向对照：真换了账本的那一步（导入）就该接管撤销——它把删除那一步顶掉，只留撤销导入的这颗。
  await deleteWithConfirm(page, "导出期间还想撤的那笔");
  await pickBackupFile(
    page,
    JSON.stringify({
      records: [
        {
          id: "takes-over-undo",
          type: "expense",
          amount: 3,
          category: "餐饮",
          date: todayKey(),
          note: "导进来的那笔",
          createdAt: 1,
        },
      ],
      budgets: {},
    }),
  );
  await backupRegion(page).getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("导进来的那笔")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(1);

  await page.getByRole("button", { name: "撤销" }).click();
  // 还回来的是导入之前那一屏：那笔删除并没有被这颗按钮撤回来，它已经不属于这一步了。
  await expect(page.getByText("导进来的那笔")).toHaveCount(0);
  await expect(page.getByText("导出期间还想撤的那笔")).toHaveCount(0);
});

test("导入预览进出时焦点有着落：不去抢首屏焦点，也不把人丢在看不见文件的 input 上", async ({
  page,
}) => {
  const importButton = backupRegion(page).getByRole("button", { name: "导入 JSON" });
  const confirmButton = backupRegion(page).getByRole("button", { name: "确认导入" });

  // 首屏：预览并不存在，那颗按钮也就不能因为「没有预览要交还焦点」被顺手抢亮。
  await expect(importButton).not.toBeFocused();

  await pickBackupFile(page, '{"records":[]}');
  // 选完文件，焦点本来停在那个 sr-only 的 input 上：读屏用户既看不见自己选中了什么文件，
  // 也摸不到紧接着那颗确认。预览一亮起来，焦点就该落在能做下一步的地方。
  await expect(backupRegion(page).getByRole("status")).toContainText("将导入 0 笔记录");
  await expect(confirmButton).toBeFocused();

  // 键盘确认这一步：焦点此刻在「确认导入」上，按下回车它自己就被卸载了，
  // 不显式交还的话焦点掉回 <body>，用户连自己在哪儿都摸不到。
  await page.keyboard.press("Enter");
  await expect(page.getByText("已导入 0 笔记录")).toBeVisible();
  await expect(backupRegion(page).getByRole("status")).toHaveCount(0);
  await expect(importButton).toBeFocused();

  // 取消这条路单独走一遍：Tab 到「取消」再回车，预览同样要把人送回「导入 JSON」，
  // 而预览里说的那一笔一个字都不该进账本。
  await pickBackupFile(
    page,
    JSON.stringify({
      records: [
        {
          id: "cancel-keeps-it-out",
          type: "expense",
          amount: 5,
          category: "餐饮",
          date: todayKey(),
          note: "取消不该带进来的那笔",
          createdAt: 1,
        },
      ],
      budgets: {},
    }),
  );
  await expect(backupRegion(page).getByRole("status")).toContainText("将导入 1 笔记录");
  await expect(confirmButton).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(backupRegion(page).getByRole("status")).toHaveCount(0);
  await expect(importButton).toBeFocused();
  await expect(page.getByText("取消不该带进来的那笔")).toHaveCount(0);

  // 反向对照：预览开着的时候换一份读不懂的文件，预览要一起关掉、人也要送回这颗按钮。
  // 只挑一份坏文件测不出这一条——那种情况下本来就没有预览可关。
  await pickBackupFile(page, '{"records":[]}');
  await expect(backupRegion(page).getByRole("status")).toContainText("将导入 0 笔记录");
  await pickBackupFile(page, "{not json");
  await expect(page.getByText("备份文件格式无效，请重新导出")).toBeVisible();
  await expect(backupRegion(page).getByRole("status")).toHaveCount(0);
  await expect(importButton).toBeFocused();
});
