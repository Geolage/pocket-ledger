/* 两个 spec 共用的界面动作。放在 e2e/helpers.ts 而不是各写一份：默认 testMatch 只收 *.spec.ts，
   所以这个文件自己不会变成一个测试。 */

import { expect, type Page } from "@playwright/test";

export async function addExpense(page: Page, amount: string, note: string) {
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
export async function armStorageWriteCounter(page: Page) {
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

export const readStorageWrites = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { ledgerStorageWrites: { writes: number } }).ledgerStorageWrites.writes,
  );

/** 按界面流程删掉一笔：确认框走到底，返回时那条提示里的「撤销」已经挂好。 */
export async function deleteWithConfirm(page: Page, note: string) {
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
