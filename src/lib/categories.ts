/* 分类定义：内置分类与自定义分类的规范化与增删改，纯函数不碰 DOM。 */

// 显式写 .ts：scripts 下的单元测试用 node --test 直接加载本模块，Node 的 ESM 解析不会补扩展名。
import {
  CATEGORY_COLOR,
  DEFAULT_COLOR,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type Budgets,
  type CategoryDefinition,
  enabledNames,
  type LedgerRecord,
  type RecordType,
} from "./ledger.ts";

export interface CategoryMutation {
  categories: CategoryDefinition[];
  records: LedgerRecord[];
  budgets: Budgets;
}

/** 主题里可用的六种类别色令牌，直接从 CATEGORY_COLOR 的取值去重得到，避免再抄一份清单。 */
const CATEGORY_COLOR_TOKENS = [...new Set(Object.values(CATEGORY_COLOR))];

function freezeBuiltins(list: CategoryDefinition[]): readonly CategoryDefinition[] {
  for (const category of list) Object.freeze(category);
  // 冻结后原地改内置项只会静默失败：内置身份是记录与预算的键，不能被任何消费方改写。
  Object.freeze(list);
  return list;
}

/** 只读是类型层面的保证，冻结是运行时的保证：读侧的函数一律收 readonly 形参，不用做不安全转换。 */
export const BUILTIN_CATEGORIES: readonly CategoryDefinition[] = freezeBuiltins([
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
]);

function categoryKey(type: RecordType, name: string): string {
  return `${type}:${name}`;
}

/** 内置分类的 type:name → 规范定义，用于把存储里的脏数据拉回内置项。 */
const BUILTIN_BY_KEY = new Map(
  BUILTIN_CATEGORIES.map((category) => [categoryKey(category.type, category.name), category]),
);

/** 内置 id 是图表、预算与历史记录认得的身份，任何自定义项都不能占用。 */
const BUILTIN_IDS = new Set(BUILTIN_CATEGORIES.map((category) => category.id));

/** 从存储里读出来的一条分类，只保留可信字段；内置身份一律由 BUILTIN_BY_KEY 决定。 */
interface StoredCategory {
  id: string;
  type: RecordType;
  name: string;
  color: string;
  disabled: boolean;
}

function parseStoredCategory(item: unknown): StoredCategory | null {
  if (!item || typeof item !== "object") return null;
  const category = item as Partial<CategoryDefinition>;
  if (
    (category.type !== "expense" && category.type !== "income") ||
    typeof category.name !== "string"
  )
    return null;

  const name = category.name.trim();
  if (!name) return null;

  return {
    id: typeof category.id === "string" && category.id ? category.id : `${category.type}:${name}`,
    type: category.type,
    name,
    color: typeof category.color === "string" && category.color ? category.color : DEFAULT_COLOR,
    disabled: category.disabled === true,
  };
}

/** 给 id 让路：首选 id 已被占用时按 -2、-3 递增，保证列表里不会出现同 id 的双胞胎。 */
function uniqueId(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) return preferred;
  let suffix = 2;
  while (used.has(`${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}

/** 取当前用得最少的色令牌，平手时按 CATEGORY_COLOR_TOKENS 的声明顺序，保证新分类颜色尽量分散。 */
function nextColor(categories: readonly CategoryDefinition[]): string {
  const counts = CATEGORY_COLOR_TOKENS.map(
    (token) => categories.filter((category) => category.color === token).length,
  );
  let leastUsed = 0;
  for (let index = 1; index < counts.length; index += 1) {
    if (counts[index] < counts[leastUsed]) leastUsed = index;
  }
  return CATEGORY_COLOR_TOKENS[leastUsed];
}

/**
 * 把任意来源的分类定义整理成完整列表：内置分类的名字与 id 由代码说了算，
 * 存储里只有停用状态会被保留；记录里的历史分类会补回来。
 */
export function normalizeCategories(
  input: unknown,
  records: readonly LedgerRecord[],
): CategoryDefinition[] {
  const result = new Map<string, CategoryDefinition>();

  for (const category of BUILTIN_CATEGORIES) {
    result.set(categoryKey(category.type, category.name), { ...category });
  }

  const usedIds = new Set(BUILTIN_IDS);

  if (Array.isArray(input)) {
    for (const item of input) {
      const stored = parseStoredCategory(item);
      if (!stored) continue;

      const key = categoryKey(stored.type, stored.name);
      const builtin = BUILTIN_BY_KEY.get(key);
      if (builtin) {
        // 命中内置名字：无论存储里写着什么 id 或 builtin，都回到规范定义，只继承停用状态。
        const canonical = result.get(key) ?? builtin;
        result.set(key, { ...canonical, disabled: canonical.disabled || stored.disabled });
        continue;
      }

      // 未命中内置名字的项都是自定义分类：自称 builtin 的脏数据在这里被降级，
      // 沿用内置 id 的脏数据（旧版重命名遗留）也会被换成新的唯一 id。
      const id = uniqueId(stored.id, usedIds);
      usedIds.add(id);
      result.set(key, {
        id,
        type: stored.type,
        name: stored.name,
        color: stored.color,
        disabled: stored.disabled,
        builtin: false,
      });
    }
  }

  const list = [...result.values()];
  for (const record of records) {
    // 记录里的分类同样先去空格，否则 "餐饮" 与 " 餐饮 " 会各占一个名字，预算与颜色都对不上。
    const name = record.category.trim();
    if (!name) continue;
    const key = categoryKey(record.type, name);
    if (!result.has(key)) {
      const id = uniqueId(`${record.type}:${name}`, usedIds);
      usedIds.add(id);
      const category: CategoryDefinition = {
        id,
        type: record.type,
        name,
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

/**
 * 名字是否已被占用。预算与颜色查找都以名字为键，所以唯一性跨支出与收入两种类型，
 * 否则 "工资" 建两条会让其中一条的预算悄悄失效。
 */
function nameTaken(
  categories: readonly CategoryDefinition[],
  name: string,
  exceptId?: string,
): boolean {
  return categories.some((category) => category.name === name && category.id !== exceptId);
}

export function createCategory(
  type: RecordType,
  name: string,
  categories: readonly CategoryDefinition[],
): CategoryDefinition | null {
  const trimmed = name.trim();
  if (!trimmed || nameTaken(categories, trimmed)) return null;

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
  categories: readonly CategoryDefinition[],
  records: readonly LedgerRecord[],
  budgets: Budgets,
  id: string,
  nextName: string,
): CategoryMutation | null {
  const trimmed = nextName.trim();
  const target = categories.find((category) => category.id === id);
  if (!target || !trimmed) return null;
  // 内置分类的名字是图表、预算与历史记录的键，只能停用不能改名。
  if (target.builtin) return null;
  // 改名后没有实际变化（含只有空格的输入）时返回 null：调用方若不检查就会白丢预算键。
  if (trimmed === target.name) return null;
  if (nameTaken(categories, trimmed, id)) return null;

  const nextCategories = categories.map((category) =>
    category.id === id ? { ...category, name: trimmed } : category,
  );
  // 记录与预算的分类名在落盘前就去过空格，这里再按去空格的值比对，
  // 内存里遗留的脏名字也能一起改名，不会留下半条预算。
  const nextRecords = records.map((record) =>
    record.type === target.type && record.category.trim() === target.name
      ? { ...record, category: trimmed }
      : record,
  );
  const nextBudgets = { ...budgets };
  const budgetKey = Object.keys(nextBudgets).find(
    (key) => key.trim() === target.name && key !== trimmed,
  );
  if (budgetKey !== undefined) {
    nextBudgets[trimmed] = nextBudgets[budgetKey];
    delete nextBudgets[budgetKey];
  }

  return { categories: nextCategories, records: nextRecords, budgets: nextBudgets };
}

/**
 * 停用是唯一会原样返回入参的操作（被拒时调用方靠引用相同判断失败），
 * 所以这里保留可写形参，不接 readonly 的内置清单。
 */
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

/**
 * 删除被拦下来的三种原因，界面要分开解释，混成一句就不诚实了：
 * - in-use：还有账单在用这个名字，删掉记录与预算就成孤儿；
 * - last-enabled：删完这个类型一个启用分类都不剩，记一笔与预算会没有候选项；
 * - not-removable：目标不存在，或者是内置分类（内置项只能停用，不能删）。
 */
export type DeleteCategoryFailure = "in-use" | "last-enabled" | "not-removable";

export function deleteCategoryFailure(
  categories: readonly CategoryDefinition[],
  records: readonly LedgerRecord[],
  id: string,
): DeleteCategoryFailure | null {
  const target = categories.find((category) => category.id === id);
  if (!target || target.builtin) return "not-removable";
  // 比对去空格后的名字：脏记录仍在使用这个分类时不能删，否则预算与记录就成孤儿。
  if (
    records.some((record) => record.type === target.type && record.category.trim() === target.name)
  )
    return "in-use";

  // 每个类型都要留下至少一个启用分类：候选项、预算行与图表都靠它兜底，删完就什么都选不出来了。
  const remainingEnabled = categories.filter(
    (category) => category.type === target.type && !category.disabled && category.id !== target.id,
  ).length;
  return remainingEnabled === 0 ? "last-enabled" : null;
}

export function deleteUnusedCategory(
  categories: readonly CategoryDefinition[],
  records: readonly LedgerRecord[],
  budgets: Budgets,
  id: string,
): CategoryMutation | null {
  if (deleteCategoryFailure(categories, records, id) !== null) return null;
  const target = categories.find((category) => category.id === id);
  if (!target) return null; // 上一道闸门已经保证了目标存在，这里只是给返回值一个交代。

  const nextBudgets = { ...budgets };
  for (const key of Object.keys(nextBudgets)) {
    if (key.trim() === target.name) delete nextBudgets[key];
  }

  return {
    categories: categories.filter((category) => category.id !== id),
    records: [...records],
    budgets: nextBudgets,
  };
}

export function categoryOptions(
  categories: readonly CategoryDefinition[],
  records: readonly LedgerRecord[],
): string[] {
  const names = new Set([
    ...enabledNames(categories, "expense"),
    ...enabledNames(categories, "income"),
  ]);
  for (const record of records) {
    // 候选项与预算、颜色同用分类名当键，这里同样先去空格，剩下的空名字不进列表。
    const name = record.category.trim();
    if (name) names.add(name);
  }
  return [...names];
}
