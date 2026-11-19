/* 分类定义：内置分类与自定义分类的规范化与增删改，纯函数不碰 DOM。 */

// 显式写 .ts：scripts 下的单元测试用 node --test 直接加载本模块，Node 的 ESM 解析不会补扩展名。
import {
  CATEGORY_COLOR,
  DEFAULT_COLOR,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type Budgets,
  type CategoryDefinition,
  type LedgerRecord,
  type RecordType,
} from "./ledger.ts";

export interface CategoryMutation {
  categories: CategoryDefinition[];
  records: LedgerRecord[];
  budgets: Budgets;
}

/** 主题里可用的六种类别色令牌，自定义分类按用量轮转取色。 */
const CATEGORY_COLOR_TOKENS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
];

export const BUILTIN_CATEGORIES: CategoryDefinition[] = [
  ...EXPENSE_CATEGORIES.map((name, index): CategoryDefinition => ({
    id: `expense-${index}`,
    type: "expense",
    name,
    color: CATEGORY_COLOR[name] ?? DEFAULT_COLOR,
    disabled: false,
    builtin: true,
  })),
  ...INCOME_CATEGORIES.map((name, index): CategoryDefinition => ({
    id: `income-${index}`,
    type: "income",
    name,
    color: CATEGORY_COLOR[name] ?? DEFAULT_COLOR,
    disabled: false,
    builtin: true,
  })),
];

function categoryKey(type: RecordType, name: string): string {
  return `${type}:${name}`;
}

/** 取当前用得最少的色令牌，平手时按 CATEGORY_COLOR_TOKENS 的声明顺序，保证新分类颜色尽量分散。 */
function nextColor(categories: CategoryDefinition[]): string {
  const counts = CATEGORY_COLOR_TOKENS.map(
    (token) => categories.filter((category) => category.color === token).length,
  );
  let leastUsed = 0;
  for (let index = 1; index < counts.length; index += 1) {
    if (counts[index] < counts[leastUsed]) leastUsed = index;
  }
  return CATEGORY_COLOR_TOKENS[leastUsed];
}

/** 把任意来源的分类定义整理成完整列表：内置分类始终存在，记录里的历史分类会补回来。 */
export function normalizeCategories(input: unknown, records: LedgerRecord[]): CategoryDefinition[] {
  const result = new Map<string, CategoryDefinition>();

  for (const category of BUILTIN_CATEGORIES) {
    result.set(categoryKey(category.type, category.name), { ...category });
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const category = item as Partial<CategoryDefinition>;
      if (
        (category.type !== "expense" && category.type !== "income") ||
        typeof category.name !== "string"
      )
        continue;

      const name = category.name.trim();
      if (!name) continue;

      result.set(categoryKey(category.type, name), {
        id:
          typeof category.id === "string" && category.id ? category.id : `${category.type}:${name}`,
        type: category.type,
        name,
        color:
          typeof category.color === "string" && category.color ? category.color : DEFAULT_COLOR,
        disabled: category.disabled === true,
        builtin: category.builtin === true,
      });
    }
  }

  const list = [...result.values()];
  for (const record of records) {
    const key = categoryKey(record.type, record.category);
    if (!result.has(key)) {
      const category: CategoryDefinition = {
        id: `${record.type}:${record.category}`,
        type: record.type,
        name: record.category,
        color: nextColor(list),
        disabled: false,
        builtin: false,
      };
      result.set(key, category);
      list.push(category);
    }
  }

  return list;
}

export function createCategory(
  type: RecordType,
  name: string,
  categories: CategoryDefinition[],
): CategoryDefinition | null {
  const trimmed = name.trim();
  if (
    !trimmed ||
    categories.some((category) => category.type === type && category.name === trimmed)
  )
    return null;

  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `custom-${Date.now()}`,
    type,
    name: trimmed,
    color: nextColor(categories),
    disabled: false,
    builtin: false,
  };
}

export function renameCategory(
  categories: CategoryDefinition[],
  records: LedgerRecord[],
  budgets: Budgets,
  id: string,
  nextName: string,
): CategoryMutation | null {
  const trimmed = nextName.trim();
  const target = categories.find((category) => category.id === id);
  if (!target || !trimmed) return null;
  // 内置分类的名字是图表、预算与历史记录的键，只能停用不能改名。
  if (target.builtin) return null;
  if (
    categories.some(
      (category) =>
        category.id !== id && category.type === target.type && category.name === trimmed,
    )
  )
    return null;

  const nextCategories = categories.map((category) =>
    category.id === id ? { ...category, name: trimmed } : category,
  );
  const nextRecords = records.map((record) =>
    record.type === target.type && record.category === target.name
      ? { ...record, category: trimmed }
      : record,
  );
  const nextBudgets = { ...budgets };
  if (Object.prototype.hasOwnProperty.call(nextBudgets, target.name)) {
    nextBudgets[trimmed] = nextBudgets[target.name];
    delete nextBudgets[target.name];
  }

  return { categories: nextCategories, records: nextRecords, budgets: nextBudgets };
}

export function toggleCategory(categories: CategoryDefinition[], id: string): CategoryDefinition[] {
  const target = categories.find((category) => category.id === id);
  if (!target) return categories;

  const nextCategories = categories.map((category) =>
    category.id === id ? { ...category, disabled: !category.disabled } : category,
  );
  const enabledCount = nextCategories.filter(
    (category) => category.type === target.type && !category.disabled,
  ).length;
  return enabledCount === 0 ? categories : nextCategories;
}

export function deleteUnusedCategory(
  categories: CategoryDefinition[],
  records: LedgerRecord[],
  budgets: Budgets,
  id: string,
): CategoryMutation | null {
  const target = categories.find((category) => category.id === id);
  if (!target || target.builtin) return null;
  if (records.some((record) => record.type === target.type && record.category === target.name))
    return null;

  const nextBudgets = { ...budgets };
  delete nextBudgets[target.name];

  return {
    categories: categories.filter((category) => category.id !== id),
    records,
    budgets: nextBudgets,
  };
}

export function categoryOptions(
  categories: CategoryDefinition[],
  records: LedgerRecord[],
): string[] {
  const names = new Set(
    categories.filter((category) => !category.disabled).map((category) => category.name),
  );
  for (const record of records) names.add(record.category);
  return [...names];
}
