import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_CATEGORIES,
  categoryOptions,
  createCategory,
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

test("createCategory rejects duplicate names", () => {
  assert.equal(createCategory("expense", "餐饮", BUILTIN_CATEGORIES), null);
  assert.ok(createCategory("expense", "宠物", BUILTIN_CATEGORIES));
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

  assert.equal(
    deleteUnusedCategory(categories, [record({ category: "宠物" })], {}, custom.id),
    null,
  );
  assert.equal(deleteUnusedCategory(categories, [record()], {}, "expense-0"), null);

  const result = deleteUnusedCategory(categories, [record()], { 宠物: 100 }, custom.id);
  assert.ok(result);
  assert.ok(!result.categories.some((category) => category.id === custom.id));
  assert.deepEqual(result.budgets, {});
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
