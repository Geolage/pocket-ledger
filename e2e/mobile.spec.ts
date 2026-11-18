import { expect, test } from "@playwright/test";

test("手机底部导航记一笔并切换到预算区块", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "移动端导航" });
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "记一笔" }).click();

  const dialog = page.getByRole("dialog", { name: "记一笔" });
  await dialog.getByLabel(/金额/).fill("15.20");
  await dialog.getByLabel(/备注/).fill("手机端测试");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("手机端测试")).toBeVisible();

  await nav.getByRole("link", { name: "预算" }).click();
  await expect(page).toHaveURL(/#budget$/);
  await expect(page.getByRole("heading", { name: "分类预算" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("320px 窄屏不产生横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本月概览" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("navigation", { name: "移动端导航" })).toBeVisible();
});
