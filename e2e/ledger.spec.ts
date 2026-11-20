import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function addExpense(page: Page, amount: string, note: string) {
  await page.getByRole("button", { name: "记一笔" }).first().click();
  const dialog = page.getByRole("dialog", { name: "记一笔" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/金额/).fill(amount);
  await dialog.getByLabel(/备注/).fill(note);
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();
}

/**
 * 开始数真正写进 `pocket-ledger.v1` 的次数。
 * 一次什么都没改到的点击不该有资格落盘：降级状态下多落这一笔，盖掉的正是盘里唯一那份原始数据，
 * 而这件事在界面上根本看不出来，所以只能从写入这一侧取证。
 */
async function armStorageWriteCounter(page: Page) {
  await page.evaluate(() => {
    const counter = { writes: 0 };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key === "pocket-ledger.v1") counter.writes += 1;
      setItem.call(this, key, value);
    };
    (window as unknown as { ledgerStorageWrites: typeof counter }).ledgerStorageWrites = counter;
  });
}

const readStorageWrites = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { ledgerStorageWrites: { writes: number } }).ledgerStorageWrites.writes,
  );

/** 设置页走一遍「清空所有数据」的确认流程。 */
async function wipeFromSettings(page: Page) {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "清空所有数据" }).click();
  await page
    .getByRole("dialog", { name: "清空所有数据？" })
    .getByRole("button", { name: "清空" })
    .click();
}

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

test("演示数据加载，新增支出写入 localStorage 并在刷新后保留", async ({ page }) => {
  await expect(page.getByText("本月收入", { exact: true })).toBeVisible();
  await addExpense(page, "88.50", "自动化测试午餐");

  const row = page.getByRole("listitem").filter({ hasText: "自动化测试午餐" });
  await expect(row).toContainText("−¥88.50");
  await expect(page.getByText("已记一笔支出")).toBeVisible();

  const stored = await page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));
  expect(stored).toContain("自动化测试午餐");

  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await expect(page.getByText("自动化测试午餐")).toBeVisible();
});

test("记录表单校验金额非空、上限和两位小数", async ({ page }) => {
  await page.getByRole("button", { name: "记一笔" }).first().click();
  const dialog = page.getByRole("dialog", { name: "记一笔" });
  const amount = dialog.getByLabel(/金额/);
  const save = dialog.getByRole("button", { name: "保存" });

  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("请输入大于 0 的金额");

  await amount.fill("1000000");
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("单笔金额请不超过 ¥999,999");

  await amount.fill("12.345");
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("金额最多保留两位小数");

  await amount.fill("12.34");
  await dialog.getByLabel(/备注/).fill("校验通过");
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("校验通过")).toBeVisible();
});

test("编辑与删除记录，删除前必须确认", async ({ page }) => {
  await addExpense(page, "88.50", "待编辑午餐");

  let row = page.getByRole("listitem").filter({ hasText: "待编辑午餐" });
  await row.getByRole("button", { name: /^编辑/ }).click();
  const editor = page.getByRole("dialog", { name: "编辑这笔" });
  await editor.getByLabel(/金额/).fill("99.99");
  await editor.getByLabel(/备注/).fill("已编辑晚餐");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(editor).toBeHidden();

  row = page.getByRole("listitem").filter({ hasText: "已编辑晚餐" });
  await expect(row).toContainText("−¥99.99");
  await expect(page.getByText("待编辑午餐")).toHaveCount(0);

  await row.getByRole("button", { name: /^删除/ }).click();
  const confirm = page.getByRole("dialog", { name: "确认删除？" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "取消" }).click();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: /^删除/ }).click();
  await page
    .getByRole("dialog", { name: "确认删除？" })
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.getByText("已编辑晚餐")).toHaveCount(0);
});

test("关键词与类型筛选、空态和清除筛选", async ({ page }) => {
  await addExpense(page, "23.00", "筛选目标午餐");

  const keyword = page.locator("#filter-keyword");
  await keyword.fill("筛选目标");
  await expect(page.getByRole("listitem").filter({ hasText: "筛选目标午餐" })).toBeVisible();

  await keyword.fill("不存在的关键词");
  await expect(page.getByText("没有符合筛选条件的账单")).toBeVisible();

  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(keyword).toHaveValue("");
  await expect(page.getByText("筛选目标午餐")).toBeVisible();

  await page.locator("#filter-type").click();
  await page.getByRole("option", { name: "收入" }).click();
  await expect(page.getByText("筛选目标午餐")).toHaveCount(0);

  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.getByText("筛选目标午餐")).toBeVisible();
});

test("缺了备注这一项的旧记录，不会被当成写着 undefined 的备注", async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    localStorage.setItem(
      "pocket-ledger.v1",
      JSON.stringify({
        // 记录校验（isValidRecord）不看备注，所以旧数据里 note 这一项可能压根不存在。
        records: [
          {
            id: "no-note",
            type: "expense",
            amount: 12.34,
            category: "餐饮",
            date,
            createdAt: Date.now(),
          },
          {
            id: "with-note",
            type: "expense",
            amount: 8.5,
            category: "交通",
            date,
            note: "地铁通勤",
            createdAt: Date.now() + 1,
          },
        ],
        budgets: {},
      }),
    );
  });
  await page.goto("/");

  const noteless = page.getByRole("listitem").filter({ hasText: "无备注" });
  await expect(noteless).toHaveCount(1);

  const keyword = page.locator("#filter-keyword");
  // 反向对照：没有备注这一项的那笔照样按分类名筛得出来，所以下面那句「筛不到」不是空断言。
  await keyword.fill("餐饮");
  await expect(noteless).toHaveCount(1);
  await expect(page.getByRole("listitem").filter({ hasText: "地铁通勤" })).toHaveCount(0);

  // 界面上这条就是空备注，可关键词一旦拼的是 `${record.note}`，
  // undefined 就成了备注内容的一部分，搜这个词会命中一条什么都没写的账单。
  await keyword.fill("undefined");
  await expect(page.getByText("没有符合筛选条件的账单")).toBeVisible();
  await expect(noteless).toHaveCount(0);

  // 真写了备注的那笔照常筛得到。
  await keyword.fill("地铁");
  await expect(page.getByRole("listitem").filter({ hasText: "地铁通勤" })).toHaveCount(1);
});

test("分类被改名后账单筛选退回全部分类，不会留下筛不出东西的旧名字", async ({ page }) => {
  const trigger = page.locator("#filter-category");

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });
  await manager.getByLabel("新分类名称").fill("宠物");
  await manager.getByRole("button", { name: "添加分类" }).click();

  // 按这条没人用过的分类筛：本月账单全被筛掉，这正是陈旧条件最容易伤人的地方。
  await trigger.click();
  await page.getByRole("option", { name: "宠物", exact: true }).click();
  await expect(trigger).toContainText("宠物");
  await expect(page.getByText("没有符合筛选条件的账单")).toBeVisible();

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await manager.getByRole("button", { name: /重命名 宠物/ }).click();
  await manager.getByLabel("编辑 宠物").fill("猫粮");
  await manager.getByRole("button", { name: "保存重命名" }).click();
  await expect(manager.getByText("猫粮", { exact: true })).toBeVisible();

  // 旧名字已经不在候选项里了：筛选条件退回「全部分类」，本月账单重新看得见。
  await expect(trigger).toContainText("全部分类");
  await expect(page.getByText("没有符合筛选条件的账单")).toHaveCount(0);
  await expect(page.getByText(/^显示 \d+ \/ \d+ 笔/)).not.toContainText("显示 0 /");
});

test("设置分类预算后出现超支提示，取消预算后恢复", async ({ page }) => {
  const budget = page.locator("#budget");
  await budget.getByLabel("每月预算（元）").fill("1");
  await budget.getByRole("button", { name: "保存预算" }).click();

  await expect(budget.getByText(/已超支/).first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "已超出预算" })).toContainText(
    "餐饮 超出",
  );

  await budget.getByRole("button", { name: "取消该分类预算" }).click();
  const confirm = page.getByRole("dialog", { name: "取消该分类预算？" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "取消预算" }).click();
  await expect(page.getByText(/餐饮 超出/)).toHaveCount(0);
});

test("没有可用的支出分类时，预算表单不硬写预算也不取消别人的预算", async ({ page }) => {
  await page.evaluate(() => {
    interface StoredCategory {
      type: "expense" | "income";
      disabled: boolean;
    }
    const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
      categories: StoredCategory[];
    };
    // 脏存储能把整个支出类型停光，界面上是删不出这种状态的。
    state.categories = state.categories.map((category) =>
      category.type === "expense" ? { ...category, disabled: true } : category,
    );
    localStorage.setItem("pocket-ledger.v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();

  const budget = page.locator("#budget");
  const categoryTrigger = budget.locator("#budget-category");
  const amount = budget.getByLabel("每月预算（元）");

  await budget.getByRole("button", { name: "保存预算" }).click();
  // 缺的是分类，报错就该挂在分类选择器上，金额框不能跟着一起被标成无效。
  await expect(budget.locator("#budget-category-error")).toContainText("启用至少一个支出分类");
  await expect(categoryTrigger).toHaveAttribute("aria-invalid", "true");
  await expect(amount).not.toHaveAttribute("aria-invalid", "true");
  await expect(budget.locator("#budget-amount-error")).toHaveCount(0);

  // 没有分类可取消预算：按钮 disable，而不是把 undefined 递出去。
  await expect(budget.getByRole("button", { name: "取消该分类预算" })).toBeDisabled();
});

test("主题切换立即生效并在刷新后保留", async ({ page }) => {
  const favicon = page.locator('link[rel="icon"]');
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByText("L2 淡雾蓝", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mist");
  await expect(favicon).toHaveAttribute("href", /%23457693/);

  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mist");
  await expect(favicon).toHaveAttribute("href", /%23457693/);
});

test("清空数据后显示空态，恢复演示数据可重新载入", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();

  await page.getByRole("button", { name: "清空所有数据" }).click();
  await page
    .getByRole("dialog", { name: "清空所有数据？" })
    .getByRole("button", { name: "清空" })
    .click();
  await expect(page.getByText(/还没有记录/).first()).toBeVisible();

  await page.getByRole("button", { name: "恢复演示数据" }).click();
  await page
    .getByRole("dialog", { name: "恢复演示数据？" })
    .getByRole("button", { name: "恢复演示" })
    .click();
  await expect(page.getByText(/显示 \d+ \/ \d+ 笔/)).toBeVisible();
  await expect(page.getByText(/显示 0 \/ 0 笔/)).toHaveCount(0);
});

test("恢复演示数据把分类还原成内置项，改名与停用状态不残留", async ({ page }) => {
  interface StoredCategory {
    id: string;
    type: "expense" | "income";
    name: string;
    color: string;
    disabled: boolean;
    builtin: boolean;
  }

  const readCategories = () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
        categories: StoredCategory[];
      };
      const shopping = state.categories.find((category) => category.name === "购物");
      return {
        custom: state.categories.filter((category) => !category.builtin).length,
        disabled: state.categories.filter((category) => category.disabled).length,
        shoppingEnabled: shopping?.disabled === false,
      };
    });

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
      categories: StoredCategory[];
    };
    state.categories = state.categories.map((category) =>
      category.name === "购物" ? { ...category, disabled: true } : category,
    );
    state.categories.push({
      id: "custom-pet",
      type: "expense",
      name: "宠物咖啡",
      color: "var(--cat-2)",
      disabled: false,
      builtin: false,
    });
    localStorage.setItem("pocket-ledger.v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();

  // 先确认脏分类真的活过了迁移，否则下面的断言会空过。
  await expect.poll(readCategories).toEqual({ custom: 1, disabled: 1, shoppingEnabled: false });

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "恢复演示数据" }).click();
  await page
    .getByRole("dialog", { name: "恢复演示数据？" })
    .getByRole("button", { name: "恢复演示" })
    .click();
  await expect(page.getByText(/显示 \d+ \/ \d+ 笔/)).toBeVisible();

  // 演示账本换掉记录与预算的同时也要换回规范分类，否则自定义项和停用状态会一直留着。
  await expect.poll(readCategories).toEqual({ custom: 0, disabled: 0, shoppingEnabled: true });
});

test("旧存储键 xiaozhanben.v1 会迁移到 pocket-ledger.v1", async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    localStorage.removeItem("pocket-ledger.v1");
    localStorage.setItem(
      "xiaozhanben.v1",
      JSON.stringify({
        records: [
          {
            id: "legacy-1",
            type: "expense",
            amount: 12.34,
            category: "餐饮",
            date,
            note: "旧键迁移午餐",
            createdAt: Date.now(),
          },
        ],
        budgets: { 餐饮: 100 },
        theme: "mist",
      }),
    );
  });

  await page.goto("/");
  await expect(page.getByText("旧键迁移午餐")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mist");

  const keys = await page.evaluate(() => ({
    legacy: localStorage.getItem("xiaozhanben.v1"),
    current: localStorage.getItem("pocket-ledger.v1"),
  }));
  expect(keys.legacy).toBeNull();
  expect(keys.current).toContain("旧键迁移午餐");
});

test("迁移失败的原始状态不会被首次挂载覆盖，用户改动后恢复落盘", async ({ page }) => {
  const readStored = () => page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));

  // 解析得出来、迁移不了的脏状态：问题出在代码而不是数据，盘里那份原始内容要留着。
  const poisoned = "null";
  await page.addInitScript((raw) => {
    localStorage.setItem("pocket-ledger.v1", raw);
  }, poisoned);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  // 迁移失败退回安全状态：没有记录，但界面照常可用。
  await expect(page.getByText(/还没有记录/).first()).toBeVisible();
  await expect(readStored()).resolves.toBe(poisoned);

  // 只换月份（不改状态、不该落盘）之后再确认一次，StrictMode 重复挂载也不会提前写。
  await page.getByRole("button", { name: "上一个月" }).click();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await expect(readStored()).resolves.toBe(poisoned);

  // 用户真的改动账本之后，正常持久化恢复。
  await addExpense(page, "12.00", "降级后恢复落盘");
  await expect.poll(readStored).toContain("降级后恢复落盘");
});

test("降级提示只在原始状态被覆盖之前显示", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pocket-ledger.v1", "null");
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();

  const warning = page.getByRole("status").filter({ hasText: "安全恢复视图" });
  await expect(warning).toBeVisible();

  // 记第一笔就把盘里那份原始状态覆盖掉了：这句「系统不会自动覆盖原始数据」立刻不再成立，
  // 提示得跟着收掉，不能让整场会话都挂着一条已经说过头的话。
  await addExpense(page, "18.00", "降级后的第一笔");
  await expect(page.getByText(/安全恢复视图/)).toHaveCount(0);

  // 收掉提示的不该只是界面：落盘也同时恢复。
  const stored = await page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));
  expect(stored).toContain("降级后的第一笔");

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await expect(page.getByText(/安全恢复视图/)).toHaveCount(0);
});

test("主要可点击控件显示 pointer 光标", async ({ page }) => {
  const cursor = (locator: ReturnType<typeof page.locator>) =>
    locator.evaluate((element) => getComputedStyle(element).cursor);

  await expect(cursor(page.getByRole("button", { name: "记一笔" }).first())).resolves.toBe(
    "pointer",
  );
  await expect(cursor(page.getByRole("button", { name: "上一个月" }))).resolves.toBe("pointer");
  await expect(cursor(page.locator("#filter-type"))).resolves.toBe("pointer");
  await expect(cursor(page.getByRole("link", { name: "预算" }).first())).resolves.toBe("pointer");

  await page.locator("#filter-type").click();
  await expect(cursor(page.getByRole("option", { name: "支出" }))).resolves.toBe("pointer");
  await page.keyboard.press("Escape");

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await expect(cursor(page.getByText("L2 淡雾蓝", { exact: true }))).resolves.toBe("pointer");

  await page.getByRole("button", { name: "记一笔" }).first().click();
  const dialog = page.getByRole("dialog", { name: "记一笔" });
  await expect(cursor(dialog.getByRole("button", { name: "Close" }))).resolves.toBe("pointer");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
});

test("自定义分类可以新增、重命名和停用", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();

  const manager = page.getByRole("region", { name: "分类管理" });
  await manager.getByLabel("分类类型").click();
  await page.getByRole("option", { name: "支出" }).click();
  await manager.getByLabel("新分类名称").fill("宠物");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(manager.getByText("宠物", { exact: true })).toBeVisible();

  await manager.getByRole("button", { name: /重命名 宠物/ }).click();
  await manager.getByLabel("编辑 宠物").fill("猫粮");
  await manager.getByRole("button", { name: "保存重命名" }).click();
  await expect(manager.getByText("猫粮", { exact: true })).toBeVisible();

  await manager.getByRole("button", { name: /停用 猫粮/ }).click();
  await expect(manager.getByRole("button", { name: /启用 猫粮/ })).toBeVisible();
});

test("分类管理的新增、重命名与停用会落盘并在刷新后保留", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  await manager.getByLabel("新分类名称").fill("宠物");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(manager.getByText("宠物", { exact: true })).toBeVisible();

  await manager.getByRole("button", { name: /重命名 宠物/ }).click();
  await manager.getByLabel("编辑 宠物").fill("猫粮");
  await manager.getByRole("button", { name: "保存重命名" }).click();
  await manager.getByRole("button", { name: /停用 猫粮/ }).click();

  const stored = await page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));
  expect(stored).toContain("猫粮");

  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await expect(manager.getByText("猫粮", { exact: true })).toBeVisible();
  await expect(manager.getByRole("button", { name: /启用 猫粮/ })).toBeVisible();
});

test("分类类型切到收入后只列收入分类", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  await expect(manager.getByText("餐饮", { exact: true })).toBeVisible();

  await manager.getByLabel("分类类型").click();
  await page.getByRole("option", { name: "收入" }).click();
  await expect(manager.getByText("工资", { exact: true })).toBeVisible();
  await expect(manager.getByText("餐饮", { exact: true })).toHaveCount(0);
});

test("停用最后一个启用分类会被拒绝，并给出可读提示", async ({ page }) => {
  await page.evaluate(() => {
    interface StoredCategory {
      type: "expense" | "income";
      disabled: boolean;
    }
    const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
      categories: StoredCategory[];
    };
    // 支出只留第一项可用，其余全停用：这样停用按钮就只剩一个，点它必然被拒。
    let kept = false;
    state.categories = state.categories.map((category) => {
      if (category.type !== "expense") return category;
      const next = { ...category, disabled: kept };
      kept = true;
      return next;
    });
    localStorage.setItem("pocket-ledger.v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();

  const manager = page.getByRole("region", { name: "分类管理" });
  const onlyEnabled = manager.getByRole("button", { name: /^停用/ });
  await expect(onlyEnabled).toHaveCount(1);
  await onlyEnabled.click();
  await expect(manager.getByRole("alert")).toContainText("至少保留一个启用分类");
  await expect(onlyEnabled).toBeVisible();
});

test("自定义分类的校验：重名与空名报错，内置项无改名删除，使用中不可删", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  // 内置分类只给停用，不给改名与删除。
  await expect(manager.getByRole("button", { name: /^停用 餐饮$/ })).toBeVisible();
  await expect(manager.getByRole("button", { name: /^重命名/ })).toHaveCount(0);
  await expect(manager.getByRole("button", { name: /^删除/ })).toHaveCount(0);

  await manager.getByLabel("新分类名称").fill("猫粮");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(manager.getByText("猫粮", { exact: true })).toBeVisible();

  await manager.getByLabel("新分类名称").fill("  ");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(manager.getByRole("alert")).toContainText("请输入分类名称");

  await manager.getByLabel("新分类名称").fill("猫粮");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(manager.getByRole("alert")).toContainText("已有同名分类");
  await expect(manager.getByText("猫粮", { exact: true })).toHaveCount(1);

  await manager.getByLabel("新分类名称").fill("餐饮");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(manager.getByRole("alert")).toContainText("已有同名分类");
  await expect(manager.getByText("餐饮", { exact: true })).toHaveCount(1);

  // 没人用过的自定义分类可以直接删掉。
  await manager.getByLabel("新分类名称").fill("宠物");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await manager.getByRole("button", { name: /删除 宠物/ }).click();
  await expect(manager.getByText("宠物", { exact: true })).toHaveCount(0);

  // 记过账的自定义分类不能删，只能停用。
  await page.getByRole("button", { name: "记一笔" }).first().click();
  const dialog = page.getByRole("dialog", { name: "记一笔" });
  await dialog.getByLabel(/金额/).fill("30.00");
  await dialog.getByLabel(/备注/).fill("猫粮试用");
  await dialog.locator("#record-category").click();
  await page.getByRole("option", { name: "猫粮", exact: true }).click();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await expect(manager.getByRole("button", { name: /^删除/ })).toHaveCount(0);
  await expect(manager.getByText("已有账单使用，无法删除")).toBeVisible();
});

test("删掉最后一个启用的支出分类会被拒绝，类型里至少留一个", async ({ page }) => {
  interface StoredCategory {
    type: "expense" | "income";
    disabled: boolean;
  }
  const enabledExpenseCount = () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
        categories: StoredCategory[];
      };
      return state.categories.filter(
        (category) => category.type === "expense" && !category.disabled,
      ).length;
    });

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  // 1. 加一条没人用的自定义支出分类。
  await manager.getByLabel("新分类名称").fill("宠物");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(manager.getByText("宠物", { exact: true })).toBeVisible();

  // 2. 自定义项还启用着，所以内置支出分类可以一条条停用到底。
  for (const name of ["餐饮", "交通", "购物", "居住", "娱乐", "医疗", "教育", "其他"]) {
    await manager.getByRole("button", { name: new RegExp(`^停用 ${name}$`) }).click();
    await expect(manager.getByRole("button", { name: new RegExp(`^启用 ${name}$`) })).toBeVisible();
  }
  await expect.poll(enabledExpenseCount).toBe(1);

  // 3+4. 删除唯一还启用的那条：必须被拒，并且一个启用分类都不许少。
  await manager.getByRole("button", { name: /^删除 宠物$/ }).click();
  await expect(manager.getByRole("alert")).toContainText(
    "删除失败：每个类型至少需要保留一个启用分类",
  );
  await expect(manager.getByText("宠物", { exact: true })).toBeVisible();
  await expect(manager.getByRole("button", { name: /^停用 宠物$/ })).toBeVisible();
  await expect.poll(enabledExpenseCount).toBe(1);
  await expect(manager.getByText(/其中 1 个可用/)).toBeVisible();
});

test("停用中且没人用过的自定义分类可以直接删，哪怕这个类型已经没有启用项", async ({ page }) => {
  await page.evaluate(() => {
    interface StoredCategory {
      id: string;
      type: "expense" | "income";
      name: string;
      color: string;
      disabled: boolean;
      builtin: boolean;
    }
    const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
      categories: StoredCategory[];
    };
    // 界面造不出「整个类型零启用」的状态，脏存储可以：这条停用中的分类不该再被启用数量拦住。
    state.categories = state.categories.map((category) =>
      category.type === "expense" ? { ...category, disabled: true } : category,
    );
    state.categories.push({
      id: "custom-pet",
      type: "expense",
      name: "宠物",
      color: "var(--cat-2)",
      disabled: true,
      builtin: false,
    });
    localStorage.setItem("pocket-ledger.v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();

  const manager = page.getByRole("region", { name: "分类管理" });
  await expect(manager.getByText("宠物", { exact: true })).toBeVisible();

  await manager.getByRole("button", { name: /^删除 宠物$/ }).click();
  await expect(manager.getByRole("alert")).toHaveCount(0);
  await expect(manager.getByText("宠物", { exact: true })).toHaveCount(0);
});

test("记一笔在分类缺失时拒绝保存，不会写出没有分类的账单", async ({ page }) => {
  const recordCount = () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
        records: unknown[];
      };
      return state.records.length;
    });

  await page.evaluate(() => {
    interface StoredCategory {
      type: "expense" | "income";
    }
    const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
      categories: StoredCategory[];
    };
    // 直接把整个支出类型停光：界面上删不出这种状态，但脏存储能带进来，表单得自己拦住。
    state.categories = state.categories.map((category) =>
      category.type === "expense" ? { ...category, disabled: true } : category,
    );
    localStorage.setItem("pocket-ledger.v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();

  const before = await recordCount();
  await page.getByRole("button", { name: "记一笔" }).first().click();
  const dialog = page.getByRole("dialog", { name: "记一笔" });
  await dialog.getByLabel(/金额/).fill("20.00");
  await dialog.getByLabel(/备注/).fill("没有分类的一笔");
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(dialog.getByRole("alert")).toContainText("请选择分类");
  await expect(dialog.locator("#record-category")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog).toBeVisible();
  await expect(page.getByText("已记一笔支出")).toHaveCount(0);
  await expect.poll(recordCount).toBe(before);

  // 切到收入就有候选项，说明报错只卡在缺分类这一步。
  await dialog.getByText("收入", { exact: true }).click();
  await expect(dialog.locator("#record-category")).not.toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
});

test("改名没有变化时提示「分类名称未变化」，不再误报同名", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  await manager.getByLabel("新分类名称").fill("宠物");
  await manager.getByRole("button", { name: "添加分类" }).click();

  await manager.getByRole("button", { name: /^重命名 宠物$/ }).click();
  await manager.getByLabel("编辑 宠物").fill(" 宠物 ");
  await manager.getByRole("button", { name: "保存重命名" }).click();

  await expect(manager.getByRole("alert")).toContainText("分类名称未变化");
  await expect(manager.getByText(/已有同名分类/)).toHaveCount(0);
  // 编辑器留在原地：报错之后还能继续改，不用重新点开。
  await expect(manager.getByLabel("编辑 宠物")).toBeVisible();

  await manager.getByLabel("编辑 宠物").fill("猫粮");
  await expect(manager.getByRole("alert")).toHaveCount(0);
  await manager.getByRole("button", { name: "保存重命名" }).click();
  await expect(manager.getByText("猫粮", { exact: true })).toBeVisible();
});

test("分类名限长 12 个字，两个表单的报错互不污染", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });
  const newName = manager.getByLabel("新分类名称");
  const addAlert = manager.locator("#category-add-error");
  const renameAlert = manager.locator("#category-rename-error");

  await manager.getByLabel("新分类名称").fill("宠物");
  await manager.getByRole("button", { name: "添加分类" }).click();

  // 13 个字：新增报错，且这个框自己标成无效。
  await newName.fill("一二三四五六七八九十一二三");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(addAlert).toContainText("分类名称请不超过 12 个字");
  await expect(newName).toHaveAttribute("aria-invalid", "true");
  await expect(manager.getByText("一二三四五六七八九十一二三", { exact: true })).toHaveCount(0);

  // 新增的报错不该让改名输入框看起来无效。
  await manager.getByRole("button", { name: /^重命名 宠物$/ }).click();
  await expect(manager.getByLabel("编辑 宠物")).not.toHaveAttribute("aria-invalid", "true");
  await expect(newName).toHaveAttribute("aria-invalid", "true");

  await manager.getByLabel("编辑 宠物").fill("一二三四五六七八九十一二三四五");
  await manager.getByRole("button", { name: "保存重命名" }).click();
  await expect(renameAlert).toContainText("分类名称请不超过 12 个字");
  await expect(manager.getByLabel("编辑 宠物")).toHaveAttribute("aria-invalid", "true");

  // 反过来也一样：改名的报错不影响新增框，且取消改名会把它一起收掉。
  await newName.fill("猫粮");
  await expect(addAlert).toHaveCount(0);
  await expect(renameAlert).toBeVisible();
  await manager.getByRole("button", { name: "取消" }).click();
  await expect(manager.getByRole("alert")).toHaveCount(0);
  await expect(manager.getByText("宠物", { exact: true })).toBeVisible();
});

test("停用或删除别的分类不会弄丢正在编辑的改名草稿", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  for (const name of ["宠物", "健身"]) {
    await manager.getByLabel("新分类名称").fill(name);
    await manager.getByRole("button", { name: "添加分类" }).click();
  }

  await manager.getByRole("button", { name: /^重命名 宠物$/ }).click();
  const editor = manager.getByLabel("编辑 宠物");
  await editor.fill("猫粮");

  // 旁边的停用与删除照点不误，草稿得留在原处，不能悄悄丢掉用户正在写的名字。
  await manager.getByRole("button", { name: /^停用 餐饮$/ }).click();
  await expect(manager.getByRole("button", { name: /^启用 餐饮$/ })).toBeVisible();
  await manager.getByRole("button", { name: /^删除 健身$/ }).click();
  await expect(manager.getByText("健身", { exact: true })).toHaveCount(0);

  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue("猫粮");
  await manager.getByRole("button", { name: "保存重命名" }).click();
  await expect(manager.getByText("猫粮", { exact: true })).toBeVisible();
});

test("降级视图只如实说明安全恢复，不在这句提示里改口承诺别的恢复路径", async ({ page }) => {
  await page.addInitScript(() => {
    // 解析得了、迁移走不完的状态：这才是真正会触发 degraded 的输入。
    localStorage.setItem("pocket-ledger.v1", "null");
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();

  const warning = page.getByRole("status").filter({ hasText: "安全恢复视图" });
  await expect(warning).toHaveText(
    "当前账本处于安全恢复视图，系统不会自动覆盖原始数据；请谨慎修改。",
  );
  await expect(warning).not.toContainText("导出");
  await expect(warning).not.toContainText("备份");
});

test("正常加载时不显示降级提示", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await expect(page.getByText(/安全恢复视图/)).toHaveCount(0);
});

test("分类改动驱动记一笔与预算的候选项，停用分类不影响已有记录", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  await manager.getByLabel("新分类名称").fill("宠物");
  await manager.getByRole("button", { name: "添加分类" }).click();

  // 新分类马上出现在记一笔里；同时先记一笔「购物」，稍后停用它来验证旧记录仍可编辑。
  await page.getByRole("button", { name: "记一笔" }).first().click();
  const dialog = page.getByRole("dialog", { name: "记一笔" });
  await dialog.getByLabel(/金额/).fill("66.00");
  await dialog.getByLabel(/备注/).fill("停用后仍可编辑");
  await dialog.locator("#record-category").click();
  await expect(page.getByRole("option", { name: "宠物", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "购物", exact: true }).click();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await manager.getByRole("button", { name: /^停用 购物$/ }).click();
  await expect(manager.getByRole("button", { name: /^启用 购物$/ })).toBeVisible();

  await page.getByRole("button", { name: "记一笔" }).first().click();
  await dialog.locator("#record-category").click();
  await expect(page.getByRole("option", { name: "购物", exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "宠物", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();

  const budget = page.locator("#budget");
  await budget.locator("#budget-category").click();
  await expect(page.getByRole("option", { name: "购物", exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "餐饮", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // 账单筛选跟着分类定义走：新分类筛得出，停用但本月还有账单的分类也要筛得出来。
  await page.locator("#filter-category").click();
  await expect(page.getByRole("option", { name: "宠物", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "购物", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const row = page.getByRole("listitem").filter({ hasText: "停用后仍可编辑" });
  await row.getByRole("button", { name: /^编辑/ }).click();
  const editor = page.getByRole("dialog", { name: "编辑这笔" });
  await expect(editor.locator("#record-category")).toContainText("购物");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("listitem").filter({ hasText: "停用后仍可编辑" })).toContainText(
    "−¥66.00",
  );
});

test("删除记录后可以撤销", async ({ page }) => {
  await addExpense(page, "31.00", "待撤销午餐");
  const row = page.getByRole("listitem").filter({ hasText: "待撤销午餐" });
  await row.getByRole("button", { name: /^删除/ }).click();
  await page
    .getByRole("dialog", { name: "确认删除？" })
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.getByText("待撤销午餐")).toHaveCount(0);

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("待撤销午餐")).toBeVisible();
});

test("清空数据后可以撤销", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "清空所有数据" }).click();
  await page
    .getByRole("dialog", { name: "清空所有数据？" })
    .getByRole("button", { name: "清空" })
    .click();
  await expect(page.getByText(/还没有记录/).first()).toBeVisible();

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText(/显示 \d+ \/ \d+ 笔/)).toBeVisible();
});

test("撤销只顶一步：连删两笔后还回来的是最后一次删除", async ({ page }) => {
  await addExpense(page, "11.00", "先删的第一笔");
  await addExpense(page, "22.00", "后删的第二笔");

  const remove = async (note: string) => {
    await page
      .getByRole("listitem")
      .filter({ hasText: note })
      .getByRole("button", { name: /^删除/ })
      .click();
    await page
      .getByRole("dialog", { name: "确认删除？" })
      .getByRole("button", { name: "删除" })
      .click();
    await expect(page.getByText(note)).toHaveCount(0);
  };

  await remove("先删的第一笔");
  await remove("后删的第二笔");

  // 后一次改动顶掉前一次的提示：屏幕上永远只有一个「撤销」，也就点不到更远的那一步。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(1);
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("后删的第二笔")).toBeVisible();
  await expect(page.getByText("先删的第一笔")).toHaveCount(0);
});

test("普通提示顶掉撤销提示时，撤销按钮跟着一起消失", async ({ page }) => {
  await addExpense(page, "27.00", "只留一条提示的记录");
  const row = page.getByRole("listitem").filter({ hasText: "只留一条提示的记录" });
  await row.getByRole("button", { name: /^删除/ }).click();
  await page
    .getByRole("dialog", { name: "确认删除？" })
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();

  // 屏幕上只留最新那一条提示：没有可撤改动的新提示不该把上一步的按钮留在原地。
  await addExpense(page, "18.00", "后来的普通一笔");
  await expect(page.getByText("已记一笔支出")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("恢复演示数据后可以撤销", async ({ page }) => {
  await addExpense(page, "45.00", "自定义拿铁");
  await expect(page.getByText("自定义拿铁")).toBeVisible();

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "恢复演示数据" }).click();
  await page
    .getByRole("dialog", { name: "恢复演示数据？" })
    .getByRole("button", { name: "恢复演示" })
    .click();
  await expect(page.getByText("自定义拿铁")).toHaveCount(0);

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("自定义拿铁")).toBeVisible();
});

test("撤销会把正在看的月份与筛选条件一起还原", async ({ page }) => {
  const range = page.getByText(/^统计范围：/);
  const keyword = page.locator("#filter-keyword");
  const rentRow = page.getByRole("listitem").filter({ hasText: "房租" });

  await page.getByRole("button", { name: "上一个月" }).click();
  const previousMonth = await range.textContent();
  expect(previousMonth).not.toBeNull();
  await keyword.fill("房租");
  await expect(rentRow).toBeVisible();

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "恢复演示数据" }).click();
  await page
    .getByRole("dialog", { name: "恢复演示数据？" })
    .getByRole("button", { name: "恢复演示" })
    .click();

  // 恢复演示顺手把月份跳回本月、筛选清空：这两处正是撤销要一起还回来的界面状态。
  await expect(range).not.toHaveText(previousMonth as string);
  await expect(keyword).toHaveValue("");

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(range).toHaveText(previousMonth as string);
  await expect(keyword).toHaveValue("房租");
  await expect(rentRow).toBeVisible();
});

test("取消分类预算后可以撤销", async ({ page }) => {
  const budget = page.locator("#budget");
  await budget.getByLabel("每月预算（元）").fill("1");
  await budget.getByRole("button", { name: "保存预算" }).click();
  const notice = page.getByRole("status").filter({ hasText: "已超出预算" });
  await expect(notice).toContainText("餐饮 超出");

  await budget.getByRole("button", { name: "取消该分类预算" }).click();
  await page
    .getByRole("dialog", { name: "取消该分类预算？" })
    .getByRole("button", { name: "取消预算" })
    .click();
  await expect(page.getByText(/餐饮 超出/)).toHaveCount(0);

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(notice).toContainText("餐饮 超出");
});

test("新增分类后可以撤销，落盘的分类跟着一起回去", async ({ page }) => {
  const customCount = () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
        categories: { builtin: boolean }[];
      };
      return state.categories.filter((category) => !category.builtin).length;
    });

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  await manager.getByLabel("新分类名称").fill("潜水");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(manager.getByText("潜水", { exact: true })).toBeVisible();
  await expect.poll(customCount).toBe(1);

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(manager.getByText("潜水", { exact: true })).toHaveCount(0);
  await expect.poll(customCount).toBe(0);
});

test("分类改名后可以撤销，用过它的账单跟着名字一起回来", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });
  await manager.getByLabel("新分类名称").fill("猫粮");
  await manager.getByRole("button", { name: "添加分类" }).click();

  await page.getByRole("button", { name: "记一笔" }).first().click();
  const dialog = page.getByRole("dialog", { name: "记一笔" });
  await dialog.getByLabel(/金额/).fill("20.00");
  await dialog.getByLabel(/备注/).fill("跟着改名的那笔");
  await dialog.locator("#record-category").click();
  await page.getByRole("option", { name: "猫粮", exact: true }).click();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("listitem").filter({ hasText: "跟着改名的那笔" });
  await expect(row).toContainText("猫粮");

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await manager.getByRole("button", { name: /^重命名 猫粮$/ }).click();
  await manager.getByLabel("编辑 猫粮").fill("宠物餐");
  await manager.getByRole("button", { name: "保存重命名" }).click();
  await expect(row).toContainText("宠物餐");

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(manager.getByText("猫粮", { exact: true })).toBeVisible();
  await expect(manager.getByText("宠物餐", { exact: true })).toHaveCount(0);
  await expect(row).toContainText("猫粮");
});

test("停用分类后可以撤销", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  await manager.getByRole("button", { name: /^停用 餐饮$/ }).click();
  await expect(manager.getByRole("button", { name: /^启用 餐饮$/ })).toBeVisible();

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(manager.getByRole("button", { name: /^停用 餐饮$/ })).toBeVisible();
});

test("删除分类后可以撤销", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  await manager.getByLabel("新分类名称").fill("潜水");
  await manager.getByRole("button", { name: "添加分类" }).click();

  await manager.getByRole("button", { name: /^删除 潜水$/ }).click();
  await expect(manager.getByText("潜水", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(manager.getByText("潜水", { exact: true })).toBeVisible();
});

test("被界面校验挡下的分类改动不给撤销按钮", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const manager = page.getByRole("region", { name: "分类管理" });

  await manager.getByLabel("新分类名称").fill("餐饮");
  await manager.getByRole("button", { name: "添加分类" }).click();
  await expect(manager.getByRole("alert")).toContainText("已有同名分类");
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("被领域层挡下的停用不给撤销按钮", async ({ page }) => {
  await page.evaluate(() => {
    interface StoredCategory {
      type: "expense" | "income";
      disabled: boolean;
    }
    const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
      categories: StoredCategory[];
    };
    // 支出只留第一项可用：停用按钮点下去必然被领域层拒掉，那种改动没资格留撤销。
    let kept = false;
    state.categories = state.categories.map((category) => {
      if (category.type !== "expense") return category;
      const next = { ...category, disabled: kept };
      kept = true;
      return next;
    });
    localStorage.setItem("pocket-ledger.v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();

  const manager = page.getByRole("region", { name: "分类管理" });
  const onlyEnabled = manager.getByRole("button", { name: /^停用/ });
  await expect(onlyEnabled).toHaveCount(1);
  await onlyEnabled.click();
  await expect(manager.getByRole("alert")).toContainText("至少保留一个启用分类");
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

/** 按界面流程删掉一笔：确认框走到底，返回时那条提示里的「撤销」已经挂好。 */
async function deleteWithConfirm(page: Page, note: string) {
  await page
    .getByRole("listitem")
    .filter({ hasText: note })
    .getByRole("button", { name: /^删除/ })
    .click();
  await page
    .getByRole("dialog", { name: "确认删除？" })
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.getByText(note)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();
}

test("删除记录后换主题：撤销窗口跟着这次改动一起结束", async ({ page }) => {
  await addExpense(page, "31.00", "换主题前删掉的那笔");
  await deleteWithConfirm(page, "换主题前删掉的那笔");

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByText("L2 淡雾蓝", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mist");

  // 主题落在 localStorage 里，和记一笔、删一笔是同等待遇的改动：
  // 撤销只认最近那次改动，账本已经走到主题这一步，上一步的按钮就不能再留着。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("删除记录后翻看别的月份：撤销窗口跟着这次改动一起结束", async ({ page }) => {
  const range = page.getByText(/^统计范围：/);
  await addExpense(page, "31.00", "换月份前删掉的那笔");
  await deleteWithConfirm(page, "换月份前删掉的那笔");

  const currentMonth = (await range.textContent()) ?? "";
  await page.getByRole("button", { name: "上一个月" }).click();
  await expect(range).not.toHaveText(currentMonth);

  // 月份不落盘，但它正是撤销要一起还回来的那一屏：用户已经翻走，这一步就不该再撤。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("删除记录后改关键词筛选：撤销窗口跟着这次改动一起结束", async ({ page }) => {
  await addExpense(page, "31.00", "改关键词前删掉的那笔");
  await deleteWithConfirm(page, "改关键词前删掉的那笔");

  await page.locator("#filter-keyword").fill("房租");
  await expect(page.getByRole("listitem").filter({ hasText: "房租" }).first()).toBeVisible();

  // 筛选不落盘，但它同样定义了「按下撤销要还回来的是哪一屏」：换了一个看法，这一步就过期了。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("删除记录后改类型筛选：撤销窗口跟着这次改动一起结束", async ({ page }) => {
  await addExpense(page, "24.00", "留着的那笔支出");
  await addExpense(page, "31.00", "改类型前删掉的那笔");
  await deleteWithConfirm(page, "改类型前删掉的那笔");

  await page.locator("#filter-type").click();
  await page.getByRole("option", { name: "收入" }).click();
  const trigger = page.locator("#filter-type");
  await expect(trigger).toContainText("收入");
  await expect(page.getByText("留着的那笔支出")).toHaveCount(0);

  // 改筛选不会弹出新的提示，也就没有一条消息去顶掉旧的那条：撤销窗口得由改动自己收掉。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("编辑这笔之后：撤销窗口跟着这次改动一起结束", async ({ page }) => {
  await addExpense(page, "24.00", "留着待编辑的那笔");
  await addExpense(page, "31.00", "编辑前删掉的那笔");
  await deleteWithConfirm(page, "编辑前删掉的那笔");

  await page
    .getByRole("listitem")
    .filter({ hasText: "留着待编辑的那笔" })
    .getByRole("button", { name: /^编辑/ })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑这笔" });
  await editor.getByLabel(/金额/).fill("42.00");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(editor).toBeHidden();

  await expect(page.getByText("已更新这笔记录")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "留着待编辑的那笔" })).toContainText(
    "−¥42.00",
  );
  // 改的是账本本身，账本已经走远：那颗按钮撤不回删除，留着只会误导。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("取消预算后保存新预算：撤销窗口跟着这次改动一起结束", async ({ page }) => {
  const budget = page.locator("#budget");
  await budget.getByLabel("每月预算（元）").fill("1");
  await budget.getByRole("button", { name: "保存预算" }).click();

  await budget.getByRole("button", { name: "取消该分类预算" }).click();
  await page
    .getByRole("dialog", { name: "取消该分类预算？" })
    .getByRole("button", { name: "取消预算" })
    .click();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();

  await budget.getByLabel("每月预算（元）").fill("2");
  await budget.getByRole("button", { name: "保存预算" }).click();
  // 保存预算不弹提示，也就没有一条顶掉旧提示的普通消息：撤销窗口得由改动自己收掉。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("原样重存同一个预算不算一次改动：撤销窗口留着，撤销照样管用", async ({ page }) => {
  const budget = page.locator("#budget");
  const amount = budget.getByLabel("每月预算（元）");
  const save = budget.getByRole("button", { name: "保存预算" });

  // 先让「餐饮 = ¥100」真的落到盘里：下面那次重存才谈得上「和现在一模一样」。
  await amount.fill("100");
  await save.click();

  await addExpense(page, "18.00", "重存预算前删掉的那笔");
  await deleteWithConfirm(page, "重存预算前删掉的那笔");

  await armStorageWriteCounter(page);
  const writesBeforeNoop = await readStorageWrites(page);

  await amount.fill("100");
  await save.click();

  // 同一个分类、同一个数额：领域层判它没改，updater 便交回当前引用，writer 也不作真。
  // 于是这一笔既不落盘（降级状态下多落的这一笔，盖掉的正是盘里唯一那份原始数据），
  // 也不关掉上一步的撤销——那颗按钮此刻还好好在屏幕上，没人有权悄悄收走它。
  await page.waitForTimeout(250);
  expect(await readStorageWrites(page)).toBe(writesBeforeNoop);
  await expect(page.getByText("已删除 1 笔记录")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("重存预算前删掉的那笔")).toBeVisible();

  // 反向对照：同一颗按钮，换个数额就是一次真改动——落盘计数器跟着动，撤销窗口跟着结束。
  // 没有这一段，上面那句「一次都没多落」可能只是根本没在记数。
  await addExpense(page, "19.00", "改预算前删掉的那笔");
  await deleteWithConfirm(page, "改预算前删掉的那笔");
  await amount.fill("120");
  await save.click();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await expect.poll(() => readStorageWrites(page)).toBeGreaterThan(writesBeforeNoop);
});

test("编辑这笔却一个字没改，不算一次改动：撤销窗口留着，撤销照样管用", async ({ page }) => {
  await addExpense(page, "24.00", "留着待重存的这笔");
  await addExpense(page, "31.00", "重存编辑前删掉的那笔");
  await deleteWithConfirm(page, "重存编辑前删掉的那笔");

  await armStorageWriteCounter(page);
  const writesBeforeNoop = await readStorageWrites(page);

  const editorRow = page.getByRole("listitem").filter({ hasText: "留着待重存的这笔" });
  await editorRow.getByRole("button", { name: /^编辑/ }).click();
  const editor = page.getByRole("dialog", { name: "编辑这笔" });
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(editor).toBeHidden();

  // 原样存回去既写不到记录，也不该把月份挪一挪：两者都是「改动」，都会关掉上一步的撤销。
  // 更重要的是这句「已更新这笔记录」不能出口——提示是同 id 按字段合并的，
  // 一笔没发生的改动换成一句假的成功说明，代价是用户眼睁睁错过的这颗撤销按钮。
  await page.waitForTimeout(250);
  expect(await readStorageWrites(page)).toBe(writesBeforeNoop);
  await expect(page.getByText("已更新这笔记录")).toHaveCount(0);
  await expect(page.getByText("已删除 1 笔记录")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("重存编辑前删掉的那笔")).toBeVisible();

  // 反向对照：同一个对话框，真的改一个数字就是一次真改动，撤销窗口跟着这次改动一起结束。
  await deleteWithConfirm(page, "重存编辑前删掉的那笔");
  await editorRow.getByRole("button", { name: /^编辑/ }).click();
  await editor.getByLabel(/金额/).fill("45.00");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(editor).toBeHidden();
  await expect(editorRow).toContainText("−¥45.00");
  await expect(page.getByText("已更新这笔记录")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("被领域层挡下的停用同样结束撤销窗口", async ({ page }) => {
  await page.evaluate(() => {
    interface StoredCategory {
      type: "expense" | "income";
      disabled: boolean;
    }
    const state = JSON.parse(localStorage.getItem("pocket-ledger.v1") ?? "{}") as {
      categories: StoredCategory[];
    };
    // 支出只留第一项可用：下面那颗停用按钮点下去必然被领域层拒掉。
    let kept = false;
    state.categories = state.categories.map((category) => {
      if (category.type !== "expense") return category;
      const next = { ...category, disabled: kept };
      kept = true;
      return next;
    });
    localStorage.setItem("pocket-ledger.v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();

  await addExpense(page, "28.00", "停用失败前删掉的那笔");
  await deleteWithConfirm(page, "停用失败前删掉的那笔");

  const manager = page.getByRole("region", { name: "分类管理" });
  await expect(manager.getByRole("button", { name: /^停用/ })).toHaveCount(1);
  await manager.getByRole("button", { name: /^停用/ }).click();
  await expect(manager.getByRole("alert")).toContainText("至少保留一个启用分类");

  // 这次停用被领域层拒掉，一个字都没写成，但用户确实动过手：上一步的撤销就此过期。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("撤销成功后提示收起，不留一颗点不动的按钮", async ({ page }) => {
  await addExpense(page, "31.00", "撤销后收起的那笔");
  await deleteWithConfirm(page, "撤销后收起的那笔");
  await expect(page.getByText("已删除 1 笔记录")).toBeVisible();

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.getByText("撤销后收起的那笔")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await expect(page.getByText("已删除 1 笔记录")).toHaveCount(0);
});

test("已经空了再清空一次不给撤销按钮", async ({ page }) => {
  await wipeFromSettings(page);
  await expect(page.getByText(/还没有记录/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();

  await wipeFromSettings(page);
  // 账本本来就是空的：这一次什么都没删掉，自然也没有可撤的一步。
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await expect(page.getByText(/还没有记录/).first()).toBeVisible();
});

test("停在过去的月份里重复清空同样是空操作：不落盘，也不给撤销", async ({ page }) => {
  const range = page.getByText(/^统计范围：/);
  await armStorageWriteCounter(page);

  // 先确认计数器看得见真改动：清空掉记录与预算的这一步当然要落盘。
  await wipeFromSettings(page);
  await expect(page.getByText(/还没有记录/).first()).toBeVisible();
  await expect.poll(() => readStorageWrites(page)).toBeGreaterThan(0);
  const writesAfterFirstWipe = await readStorageWrites(page);

  // 月份不落盘，所以翻到上个月本身是一次免费的点击。
  const currentMonth = (await range.textContent()) ?? "";
  await page.getByRole("button", { name: "上一个月" }).click();
  await expect(range).not.toHaveText(currentMonth);
  expect(await readStorageWrites(page)).toBe(writesAfterFirstWipe);

  await wipeFromSettings(page);
  // 清空动不到月份视图：上个月里记录与预算一样是空的，这一笔点击照样什么都没改。
  await expect(page.getByText("已清空本机数据")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);

  // 断言「没有多出一次落盘」要等 React 把那一次提交走完，否则读得早点晚点都一样。
  await page.waitForTimeout(250);
  const writesAfterNoop = await readStorageWrites(page);
  expect(writesAfterNoop).toBe(writesAfterFirstWipe);

  // 什么都没改动，就不该多出这两件事：一笔多余的落盘，或者把界面切进安全恢复视图。
  await expect(page.getByText(/安全恢复视图/)).toHaveCount(0);
  await expect(page.getByText(/浏览器拒绝写入本地存储/)).toHaveCount(0);

  // 反向对照：紧接着的一次真改动确实会被这个计数器看见，说明上面那句「一次都没多」不是空断言。
  await page.getByRole("button", { name: "恢复演示数据" }).click();
  await page
    .getByRole("dialog", { name: "恢复演示数据？" })
    .getByRole("button", { name: "恢复演示" })
    .click();
  await expect(page.getByText(/显示 \d+ \/ \d+ 笔/)).toBeVisible();
  await expect.poll(() => readStorageWrites(page)).toBeGreaterThan(writesAfterNoop);
});

test("空账本停在过去的月份时重复清空，不会放行降级状态、盖掉盘里的原始数据", async ({ page }) => {
  const readStored = () => page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));

  const poisoned = "null";
  await page.addInitScript((raw) => {
    localStorage.setItem("pocket-ledger.v1", raw);
  }, poisoned);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await expect(page.getByText(/还没有记录/).first()).toBeVisible();

  await page.getByRole("button", { name: "上一个月" }).click();
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  const warning = page.getByRole("status").filter({ hasText: "安全恢复视图" });
  await expect(warning).toBeVisible();
  await expect(readStored()).resolves.toBe(poisoned);

  await wipeFromSettings(page);
  // 「系统不会自动覆盖原始数据」这句话，靠的是什么都没改到的那一步根本不会落盘。
  await expect(readStored()).resolves.toBe(poisoned);
  await expect(warning).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
});

test("空账本上只清一个关键词时，清空放行的是筛选，不是盘里那份原始数据", async ({ page }) => {
  const readStored = () => page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));

  const poisoned = "null";
  await page.addInitScript((raw) => {
    localStorage.setItem("pocket-ledger.v1", raw);
  }, poisoned);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await expect(page.getByText(/还没有记录/).first()).toBeVisible();

  // 这一次「清空动了东西」全靠筛选条件：记录与预算本来就是空的，月份也停在当月。
  const keyword = page.locator("#filter-keyword");
  await keyword.fill("房租");
  await expect(keyword).toHaveValue("房租");

  const warning = page.getByRole("status").filter({ hasText: "安全恢复视图" });
  await expect(warning).toBeVisible();
  await expect(readStored()).resolves.toBe(poisoned);

  await wipeFromSettings(page);
  // 清掉关键词是真的改动，值得留一步撤销；但它一张账单都没删，
  // 所以既不该落盘，也不该把降级状态放行——那句「系统不会自动覆盖原始数据」说的就是这一笔。
  await expect(readStored()).resolves.toBe(poisoned);
  await expect(warning).toBeVisible();
  await expect(keyword).toHaveValue("");

  // 撤销按整套快照还回来，被清空一起抹掉的筛选条件也得跟着回来，而且同样不该落盘。
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(keyword).toHaveValue("房租");
  await expect(readStored()).resolves.toBe(poisoned);
  await expect(warning).toBeVisible();
});

test("账本已经是演示数据时，恢复演示不给撤销按钮", async ({ page }) => {
  // 首次进来加载的就是同一套演示数据：连着按两次「恢复演示」，第二次一个字都不该改。
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "恢复演示数据" }).click();
  await page
    .getByRole("dialog", { name: "恢复演示数据？" })
    .getByRole("button", { name: "恢复演示" })
    .click();

  await expect(page.getByRole("button", { name: "撤销" })).toHaveCount(0);
  await expect(page.getByText(/显示 \d+ \/ \d+ 笔/)).toBeVisible();
  await expect(page.getByText(/显示 0 \/ 0 笔/)).toHaveCount(0);
});

test("账本已经是演示数据时，带着关键词恢复演示只重置筛选，不多落一笔盘", async ({ page }) => {
  await armStorageWriteCounter(page);

  // 筛选不落盘，所以下面读到的基线就是「恢复演示」这一笔点击独有的开销。
  const keyword = page.locator("#filter-keyword");
  await keyword.fill("房租");
  await expect(keyword).toHaveValue("房租");
  const writesBefore = await readStorageWrites(page);

  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "恢复演示数据" }).click();
  await page
    .getByRole("dialog", { name: "恢复演示数据？" })
    .getByRole("button", { name: "恢复演示" })
    .click();

  // 盘里的内容本来就是这套演示数据：重写一遍同样的字节也是多落一笔盘，
  // 而降级状态下这一笔盖掉的正是唯一那份原始数据——界面上却什么都看不出来，只能从写入这一侧取证。
  await expect(keyword).toHaveValue("");
  await expect(page.getByText(/显示 \d+ \/ \d+ 笔/)).toBeVisible();
  await expect(page.getByText(/显示 0 \/ 0 笔/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();

  // 断言「没有多出一次落盘」要等 React 把那一次提交走完，否则读得早点晚点都一样。
  await page.waitForTimeout(250);
  expect(await readStorageWrites(page)).toBe(writesBefore);

  // 这一步筛条件确实归了这一步的撤销，而还原同样不该顺手落盘。
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(keyword).toHaveValue("房租");
  await page.waitForTimeout(250);
  expect(await readStorageWrites(page)).toBe(writesBefore);

  // 反向对照：紧接着的一次真改动确实会被这个计数器看见，说明上面那两句「一次都没多」不是空断言。
  // 撤销把关键词带了回来，所以先清掉筛选这笔才看得见——筛选不落盘，这一步依旧是免费的。
  await keyword.fill("");
  await expect(keyword).toHaveValue("");
  await addExpense(page, "12.00", "恢复演示之后的对照支出");
  await expect(page.getByText("恢复演示之后的对照支出")).toBeVisible();
  await expect.poll(() => readStorageWrites(page)).toBeGreaterThan(writesBefore);
});

test("导出 JSON 与 CSV：文件名带上今天日期，内容就是刚记下的那一笔", async ({ page }) => {
  await addExpense(page, "88.50", "导出用的午餐");

  const json = await downloadBackup(page, "导出 JSON");
  expect(json.filename).toMatch(/^pocket-ledger-backup-\d{4}-\d{2}-\d{2}\.json$/);
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
  expect(csv.text).toMatch(/^id,type,amount,category,date,note,createdAt\r?\n/);
  const row = csv.text.split("\n").find((line) => line.includes("导出用的午餐"));
  expect(row).toBeDefined();
  // 字符串单元格带引号、数字不带：这一行是用户拿到表格软件里要直接看的。
  expect(row).toContain('"餐饮"');
  expect(row).toContain(",88.5,");
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

  const preview = backupRegion(page).getByRole("alert");
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
  await expect(backupRegion(page).getByRole("alert")).toContainText("将导入");
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
  const preview = backupRegion(page).getByRole("alert");
  await expect(preview).toContainText("将导入 1 笔记录、0 个预算");
  await expect(preview).toContainText(
    "确认导入会覆盖系统保留的那份无法读取的原始数据，覆盖后无法找回。",
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
  // 上面那句「取消时不给撤销」也因此不是空断言：这一步真留下了撤销。
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();
});

test("格式无效的备份文件只说一句无效，账本与提示外的界面都不动", async ({ page }) => {
  await addExpense(page, "33.00", "不该被导入动到的一笔");
  const storedBefore = await page.evaluate(() => localStorage.getItem("pocket-ledger.v1"));

  // 读不出内容的、内容不是账本的、缺 records 的：三样都只能换来同一句话。
  for (const content of ["{not json", "[]", '{"budgets":{"餐饮":100}}']) {
    await pickBackupFile(page, content);
    await expect(page.getByText("备份文件格式无效，请重新导出")).toBeVisible();
    await expect(backupRegion(page).getByRole("alert")).toHaveCount(0);
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
  await expect(backupRegion(page).getByRole("alert")).toContainText("将导入 1 笔记录");
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
  await expect(backupRegion(page).getByRole("alert")).toContainText("将导入 0 笔记录");

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
