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

test("主题切换立即生效并在刷新后保留", async ({ page }) => {
  await page.getByRole("heading", { name: "设置" }).scrollIntoViewIfNeeded();
  await page.getByText("L2 淡雾蓝", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mist");

  await page.reload();
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "mist");
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
