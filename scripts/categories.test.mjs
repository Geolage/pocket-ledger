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

test("createCategory rejects duplicate names", () => {
  assert.equal(createCategory("expense", "餐饮", BUILTIN_CATEGORIES), null);
  assert.ok(createCategory("expense", "宠物", BUILTIN_CATEGORIES));
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
