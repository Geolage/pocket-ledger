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

test("降级视图如实说明安全恢复，不承诺没上线的导出备份", async ({ page }) => {
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
