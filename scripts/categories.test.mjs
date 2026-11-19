import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_CATEGORIES,
  MAX_CATEGORY_NAME_LENGTH,
  categoryOptions,
  createCategory,
  deleteCategoryFailure,
  deleteUnusedCategory,
  normalizeCategories,
  renameCategory,
  toggleCategory,
} from "../src/lib/categories.ts";

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

test("normalizeCategories keeps built-ins and adds record-only categories", () => {
  const result = normalizeCategories(undefined, [record({ category: "宠物" })]);
  assert.ok(result.some((category) => category.name === "餐饮" && category.builtin));
  assert.ok(result.some((category) => category.name === "宠物" && !category.builtin));
});

test("normalizeCategories upgrades legacy state stored without categories", () => {
  const result = normalizeCategories(undefined, [record({ category: "宠物" })]);

  // 旧版本只存名字，升级后每一类内置分类都要带回规范 id 与颜色。
  for (const builtin of BUILTIN_CATEGORIES) {
    assert.deepEqual(
      result.find((category) => category.id === builtin.id),
      builtin,
    );
  }

  const pet = result.find((category) => category.name === "宠物");
  assert.equal(pet.builtin, false);
  assert.equal(pet.id, "expense:宠物");
  assert.equal(result.length, BUILTIN_CATEGORIES.length + 1);
});

test("normalizeCategories keeps only the disabled flag of stored built-ins", () => {
  const categories = normalizeCategories(undefined, []);
  const shopping = categories.find((category) => category.name === "购物");
  const canonical = BUILTIN_CATEGORIES.find((category) => category.name === "购物");

  const result = normalizeCategories(toggleCategory(categories, shopping.id), []);
  const again = result.find((category) => category.name === "购物");

  assert.equal(again.disabled, true);
  assert.deepEqual({ ...again, disabled: false }, canonical);

  // 停用之外的字段被脏数据改过也要还原，否则图表与预算就对不上内置分类了。
  const corrupted = normalizeCategories(
    [{ ...canonical, id: "hacked", name: " 餐饮 ", color: "#f00", disabled: true }],
    [],
  );
  const dining = corrupted.find((category) => category.name === "餐饮");
  assert.equal(dining.disabled, true);
  assert.deepEqual({ ...dining, disabled: false }, BUILTIN_CATEGORIES[0]);
});

test("normalizeCategories demotes a custom name that claims to be built-in", () => {
  const result = normalizeCategories(
    [
      {
        id: "income-9",
        type: "income",
        name: "宠物",
        color: "var(--cat-1)",
        disabled: false,
        builtin: true,
      },
    ],
    [],
  );

  const pet = result.find((category) => category.name === "宠物");
  assert.equal(pet.builtin, false);
  assert.equal(pet.type, "income");
  assert.equal(result.filter((category) => category.id === "income-9").length, 1);
  // 内置定义一个都不能少。
  assert.equal(result.length, BUILTIN_CATEGORIES.length + 1);
});

test("normalizeCategories repairs a renamed built-in id without duplicating it", () => {
  // 旧 bug：内置分类被改名后，存储里留着 expense-0 这个 id 和陌生的名字。
  const buggy = BUILTIN_CATEGORIES.map((category) =>
    category.name === "餐饮" ? { ...category, name: "吃饭" } : { ...category },
  );

  const result = normalizeCategories(buggy, [record({ category: "吃饭" })]);

  assert.equal(result.filter((category) => category.id === "expense-0").length, 1);
  assert.equal(result.find((category) => category.id === "expense-0").name, "餐饮");

  const renamed = result.find((category) => category.name === "吃饭");
  assert.equal(renamed.builtin, false);
  assert.notEqual(renamed.id, "expense-0");
  assert.ok(renamed.id.startsWith("expense-0-"), renamed.id);

  assert.equal(new Set(result.map((category) => category.id)).size, result.length);
});

test("normalizeCategories trims record categories so names stay unique", () => {
  const result = normalizeCategories(undefined, [
    record({ id: "a", category: " 餐饮 " }),
    record({ id: "b", category: " 宠物 " }),
    record({ id: "c", category: "   " }),
  ]);

  // " 餐饮 " 与 "餐饮" 必须合成一条：预算与颜色按名字取值，分开就会各算一半。
  assert.equal(result.filter((category) => category.name === "餐饮").length, 1);
  assert.equal(result.length, BUILTIN_CATEGORIES.length + 1);

  const pet = result.find((category) => category.name === "宠物");
  assert.equal(pet.id, "expense:宠物");
  assert.ok(!result.some((category) => category.name !== category.name.trim()));
});

test("BUILTIN_CATEGORIES is frozen so consumers cannot corrupt the canonical list", () => {
  assert.ok(Object.isFrozen(BUILTIN_CATEGORIES));
  for (const category of BUILTIN_CATEGORIES) assert.ok(Object.isFrozen(category));

  // 下发给状态里的必须是副本，否则一次原地赋值就把内置身份改没了。
  const list = normalizeCategories(undefined, []);
  assert.notEqual(list[0], BUILTIN_CATEGORIES[0]);
  assert.ok(!Object.isFrozen(list[0]));
});

test("createCategory rejects duplicate names", () => {
  assert.equal(createCategory("expense", "餐饮", BUILTIN_CATEGORIES), null);
  assert.equal(createCategory("expense", "   ", BUILTIN_CATEGORIES), null);
  assert.ok(createCategory("expense", "宠物", BUILTIN_CATEGORIES));
});

test("createCategory rejects a name used by the opposite type", () => {
  // Budgets 按名字存，两种类型共用一个名字会让其中一份预算永远读不到。
  assert.equal(createCategory("income", "餐饮", BUILTIN_CATEGORIES), null);
  assert.equal(createCategory("expense", "工资", BUILTIN_CATEGORIES), null);

  const customIncome = {
    id: "c1",
    type: "income",
    name: "宠物",
    color: "var(--cat-2)",
    disabled: false,
    builtin: false,
  };
  assert.equal(createCategory("expense", "宠物", [...BUILTIN_CATEGORIES, customIncome]), null);
});

test("createCategory gives new custom categories distinct colors", () => {
  const categories = normalizeCategories(undefined, []);
  const first = createCategory("expense", "宠物", categories);
  const second = createCategory("expense", "健身", [...categories, first]);

  // 内置分类已占满六种色，自定义分类仍要拿到尚未用满的令牌，而不是共用一个。
  assert.match(first.color, /^var\(--cat-[1-6]\)$/);
  assert.match(second.color, /^var\(--cat-[1-6]\)$/);
  assert.notEqual(first.color, second.color);
});

test("createCategory rejects names longer than MAX_CATEGORY_NAME_LENGTH", () => {
  const exactly = "一".repeat(MAX_CATEGORY_NAME_LENGTH);

  // 长度闸门在领域层，不在界面：绕过表单直接调用也存不进超长名字。
  assert.equal(createCategory("expense", `${exactly}二`, BUILTIN_CATEGORIES), null);
  assert.ok(createCategory("expense", exactly, BUILTIN_CATEGORIES));
  // 上限按去掉首尾空格后的名字算，否则界面放过、领域层拦下就自相矛盾了。
  assert.ok(createCategory("expense", `   ${exactly}   `, BUILTIN_CATEGORIES));
});

test("renameCategory rejects names longer than MAX_CATEGORY_NAME_LENGTH", () => {
  const categories = normalizeCategories(undefined, [record({ category: "宠物" })]);
  const target = categories.find((category) => category.name === "宠物");
  const records = [record({ category: "宠物" })];
  const budgets = { 宠物: 300 };
  const tooLong = "猫".repeat(MAX_CATEGORY_NAME_LENGTH + 1);

  assert.equal(renameCategory(categories, records, budgets, target.id, tooLong), null);
  // 被拒就是什么都没动：分类名、记录与预算都保持原样。
  assert.equal(categories.find((category) => category.id === target.id).name, "宠物");
  assert.deepEqual(records, [record({ category: "宠物" })]);
  assert.deepEqual(budgets, { 宠物: 300 });

  const result = renameCategory(
    categories,
    records,
    budgets,
    target.id,
    "猫".repeat(MAX_CATEGORY_NAME_LENGTH),
  );
  assert.ok(result);
  assert.equal(
    result.categories.find((category) => category.id === target.id).name.length,
    MAX_CATEGORY_NAME_LENGTH,
  );
});

test("renameCategory updates the definition, records, and budgets", () => {
  const categories = normalizeCategories(undefined, [record({ category: "宠物" })]);
  const target = categories.find((category) => category.name === "宠物");
  const result = renameCategory(
    categories,
    [record({ category: "宠物" })],
    { 宠物: 300 },
    target.id,
    "猫粮",
  );

  assert.ok(result);
  assert.equal(result.categories.find((category) => category.id === target.id).name, "猫粮");
  assert.equal(result.records[0].category, "猫粮");
  assert.deepEqual(result.budgets, { 猫粮: 300 });
});

test("renameCategory keeps built-in names and leaves records and budgets alone", () => {
  const categories = normalizeCategories(undefined, []);
  const builtin = categories.find((category) => category.name === "餐饮");
  const records = [record({ category: "餐饮" })];
  const budgets = { 餐饮: 4000 };

  const result = renameCategory(categories, records, budgets, builtin.id, "吃饭");

  assert.equal(result, null);
  // 返回 null 表示没有任何改动：调用方保留原记录与预算，重载后内置分类名依旧。
  assert.deepEqual(records, [record({ category: "餐饮" })]);
  assert.deepEqual(budgets, { 餐饮: 4000 });
  assert.ok(
    normalizeCategories(categories, records).some(
      (category) => category.id === builtin.id && category.name === "餐饮",
    ),
  );
});

test("renameCategory returns null for a no-op rename and keeps the budget", () => {
  const categories = normalizeCategories(undefined, [record({ category: "宠物" })]);
  const target = categories.find((category) => category.name === "宠物");
  const records = [record({ category: "宠物" })];
  const budgets = { 宠物: 300 };

  // 改名没变化也必须返回 null：调用方若照样写回三份状态，键名一错就把预算丢了。
  assert.equal(renameCategory(categories, records, budgets, target.id, "宠物"), null);
  assert.equal(renameCategory(categories, records, budgets, target.id, "  宠物  "), null);
  assert.equal(renameCategory(categories, records, budgets, target.id, "   "), null);
  assert.deepEqual(budgets, { 宠物: 300 });
  assert.deepEqual(records, [record({ category: "宠物" })]);
});

test("renameCategory rejects a name used by the opposite type and keeps the budget", () => {
  const custom = [
    {
      id: "c-expense",
      type: "expense",
      name: "宠物",
      color: "var(--cat-2)",
      disabled: false,
      builtin: false,
    },
    {
      id: "c-income",
      type: "income",
      name: "健身",
      color: "var(--cat-4)",
      disabled: false,
      builtin: false,
    },
  ];
  const categories = [...BUILTIN_CATEGORIES, ...custom];
  const records = [record({ id: "i1", type: "income", category: "健身" })];
  const budgets = { 健身: 200 };

  assert.equal(renameCategory(categories, records, budgets, "c-expense", "健身"), null);
  assert.deepEqual(budgets, { 健身: 200 });
  assert.deepEqual(records, [record({ id: "i1", type: "income", category: "健身" })]);
});

test("toggleCategory disables a category but keeps at least one enabled", () => {
  const expense = BUILTIN_CATEGORIES.filter((category) => category.type === "expense");
  const result = toggleCategory(expense, expense[0].id);
  assert.equal(result.find((category) => category.id === expense[0].id).disabled, true);

  const onlyOne = [
    {
      id: "x",
      type: "expense",
      name: "餐饮",
      color: "var(--cat-1)",
      disabled: false,
      builtin: true,
    },
  ];
  assert.deepEqual(toggleCategory(onlyOne, "x"), onlyOne);
});

test("deleteUnusedCategory only removes unused custom categories", () => {
  const custom = {
    id: "c1",
    type: "expense",
    name: "宠物",
    color: "var(--cat-2)",
    disabled: false,
    builtin: false,
  };
  const categories = [...BUILTIN_CATEGORIES, custom];

  assert.deepEqual(
    deleteUnusedCategory(categories, [record({ category: "宠物" })], {}, custom.id),
    { ok: false, failure: "in-use" },
  );
  assert.deepEqual(deleteUnusedCategory(categories, [record()], {}, "expense-0"), {
    ok: false,
    failure: "not-removable",
  });

  const records = [record()];
  const result = deleteUnusedCategory(categories, records, { 宠物: 100 }, custom.id);
  assert.ok(result.ok);
  assert.ok(!result.categories.some((category) => category.id === custom.id));
  assert.deepEqual(result.budgets, {});

  // 删除不动任何账单：交回的必须是传进来那一个引用，复制一份就会让记录状态白变一次身份。
  assert.equal(result.records, records);
});

test("deleteUnusedCategory refuses to leave a type without any enabled category", () => {
  const custom = {
    id: "c1",
    type: "expense",
    name: "宠物",
    color: "var(--cat-2)",
    disabled: false,
    builtin: false,
  };
  // 内置支出全停用，只剩这条自定义分类可用：删掉它记一笔就再也选不出支出分类了。
  const categories = [
    ...BUILTIN_CATEGORIES.map((category) =>
      category.type === "expense" ? { ...category, disabled: true } : { ...category },
    ),
    custom,
  ];
  const records = [record({ category: "餐饮" })];
  const budgets = { 宠物: 100, 餐饮: 4000 };

  assert.equal(deleteCategoryFailure(categories, records, custom.id), "last-enabled");
  assert.deepEqual(deleteUnusedCategory(categories, records, budgets, custom.id), {
    ok: false,
    failure: "last-enabled",
  });

  // 拒绝就是什么都没动：预算键、分类列表与启用数量都保持原样。
  assert.deepEqual(budgets, { 宠物: 100, 餐饮: 4000 });
  assert.equal(categories.filter((category) => category.id === custom.id).length, 1);
  assert.equal(
    categories.filter((category) => category.type === "expense" && !category.disabled).length,
    1,
  );
});

test("the last-enabled delete rule only applies to a still-enabled target", () => {
  // 内置支出全停用：这个类型现在一个启用分类都不剩，是既成事实，不是删除造成的。
  const disabledBuiltins = BUILTIN_CATEGORIES.map((category) =>
    category.type === "expense" ? { ...category, disabled: true } : { ...category },
  );
  const custom = {
    id: "c1",
    type: "expense",
    name: "宠物",
    color: "var(--cat-2)",
    disabled: false,
    builtin: false,
  };
  const records = [record({ category: "餐饮" })];

  // 目标还启用着：删掉它候选项就空了，照样拦。
  assert.equal(
    deleteCategoryFailure([...disabledBuiltins, custom], records, custom.id),
    "last-enabled",
  );

  // 目标已经停用：它本来就不在任何候选项里，删掉不减少启用项，得放行。
  const stopped = { ...custom, disabled: true };
  assert.equal(deleteCategoryFailure([...disabledBuiltins, stopped], records, stopped.id), null);

  const result = deleteUnusedCategory(
    [...disabledBuiltins, stopped],
    records,
    { 宠物: 100 },
    stopped.id,
  );
  assert.ok(result.ok);
  assert.ok(!result.categories.some((category) => category.id === stopped.id));
  assert.deepEqual(result.budgets, {});
  assert.equal(
    result.categories.filter((category) => category.type === "expense" && !category.disabled)
      .length,
    0,
  );
});

test("deleteUnusedCategory explains why a deletion was rejected", () => {
  const custom = {
    id: "c1",
    type: "expense",
    name: "宠物",
    color: "var(--cat-2)",
    disabled: false,
    builtin: false,
  };
  const categories = [...BUILTIN_CATEGORIES, custom];

  assert.equal(deleteCategoryFailure(categories, [record({ category: "宠物" })], "c1"), "in-use");
  assert.equal(deleteCategoryFailure(categories, [], "expense-0"), "not-removable");
  assert.equal(deleteCategoryFailure(categories, [], "missing-id"), "not-removable");
  assert.equal(deleteCategoryFailure(categories, [], custom.id), null);
});

test("deleteUnusedCategory still deletes once the type keeps an enabled category", () => {
  const custom = {
    id: "c1",
    type: "expense",
    name: "宠物",
    color: "var(--cat-2)",
    disabled: false,
    builtin: false,
  };
  // 内置支出只停用其余项，留一个启用：这时删掉自定义分类仍然要放行。
  const categories = [
    ...BUILTIN_CATEGORIES.map((category) =>
      category.type === "expense"
        ? { ...category, disabled: category.name !== "餐饮" }
        : { ...category },
    ),
    custom,
  ];

  assert.equal(deleteCategoryFailure(categories, [record()], custom.id), null);
  const result = deleteUnusedCategory(categories, [record()], { 宠物: 100 }, custom.id);
  assert.ok(result.ok);
  assert.ok(!result.categories.some((category) => category.id === custom.id));
  assert.deepEqual(result.budgets, {});
  assert.equal(
    result.categories.filter((category) => category.type === "expense" && !category.disabled)
      .length,
    1,
  );
});

test("categoryOptions includes enabled categories and categories used by records", () => {
  const categories = normalizeCategories(undefined, [record({ category: "宠物" })]);
  const disabled = toggleCategory(
    categories,
    categories.find((category) => category.name === "购物").id,
  );
  const options = categoryOptions(disabled, [record({ category: "购物" })]);

  assert.ok(options.includes("餐饮"));
  assert.ok(options.includes("宠物"));
  assert.ok(options.includes("购物"));
});

test("categoryOptions trims record categories and skips space-only names", () => {
  const options = categoryOptions(BUILTIN_CATEGORIES, [
    record({ category: " 宠物 " }),
    record({ category: "   " }),
  ]);

  assert.ok(options.includes("宠物"));
  // 候选项也是按名字取预算与颜色的，多一个 " 宠物 " 就多一个选不到的选项。
  assert.ok(!options.some((name) => name !== name.trim()), String(options));
});

test("renameCategory retargets records and budgets written with stray spaces", () => {
  const categories = normalizeCategories(undefined, [record({ category: "宠物" })]);
  const target = categories.find((category) => category.name === "宠物");

  const result = renameCategory(
    categories,
    [record({ category: " 宠物 " })],
    { " 宠物 ": 300 },
    target.id,
    "猫粮",
  );

  assert.ok(result);
  assert.equal(result.records[0].category, "猫粮");
  assert.deepEqual(result.budgets, { 猫粮: 300 });
});

test("deleteUnusedCategory refuses to drop a category used with stray spaces", () => {
  const custom = {
    id: "c1",
    type: "expense",
    name: "宠物",
    color: "var(--cat-2)",
    disabled: false,
    builtin: false,
  };
  const categories = [...BUILTIN_CATEGORIES, custom];

  assert.deepEqual(
    deleteUnusedCategory(categories, [record({ category: " 宠物 " })], { " 宠物 ": 100 }, "c1"),
    { ok: false, failure: "in-use" },
  );

  const result = deleteUnusedCategory(categories, [record()], { " 宠物 ": 100, 餐饮: 50 }, "c1");
  assert.ok(result.ok);
  assert.deepEqual(result.budgets, { 餐饮: 50 });
});
