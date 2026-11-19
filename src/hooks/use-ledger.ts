import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DeleteCategoryFailure,
  categoryOptions,
  createCategory,
  deleteCategoryFailure,
  deleteUnusedCategory,
  renameCategory,
  toggleCategory,
} from "@/src/lib/categories";
import {
  type Budgets,
  type CategoryDefinition,
  type LedgerRecord,
  type RecordType,
  budgetSummary,
  cents,
  fromCents,
  dailyExpenses,
  expensesByCategory,
  isValidRecord,
  newId,
  recordsOfMonth,
  shiftMonth,
  startOfMonth,
  summarize,
} from "@/src/lib/ledger";
import { type ThemeId, applyTheme } from "@/src/lib/themes";
import { type LedgerState, demoState, loadState, saveState } from "@/src/lib/storage";

export interface RecordDraft {
  type: RecordType;
  amount: number;
  category: string;
  date: string;
  note: string;
}

export interface Filters {
  type: "all" | RecordType;
  category: string;
  keyword: string;
}

const EMPTY_FILTERS: Filters = { type: "all", category: "all", keyword: "" };

export function useLedger() {
  const [initial] = useState(() => loadState());
  const [records, setRecordsState] = useState<LedgerRecord[]>(initial.state.records);
  const [budgets, setBudgetsState] = useState<Budgets>(initial.state.budgets);
  const [theme, setThemeState] = useState<ThemeId>(initial.state.theme);
  const [categories, setCategoriesState] = useState<CategoryDefinition[]>(initial.state.categories);
  const [storageAvailable, setStorageAvailable] = useState(initial.available);
  const [view, setView] = useState(() => startOfMonth(new Date()));
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // 记录、预算、分类的所有写入都走下面的 write*：ref 存最新意图，同一 tick 里连着改
  // 不会拿旧闭包的值覆盖掉前一次的结果（分类改名就会同时动这三份状态）。
  // 前提是没有别的写入路径：state setter 一律不外泄。
  const recordsRef = useRef(records);
  const budgetsRef = useRef(budgets);
  const categoriesRef = useRef(categories);

  const writeRecords = useCallback((update: (current: LedgerRecord[]) => LedgerRecord[]) => {
    const next = update(recordsRef.current);
    recordsRef.current = next;
    setRecordsState(next);
  }, []);

  const writeBudgets = useCallback((update: (current: Budgets) => Budgets) => {
    const next = update(budgetsRef.current);
    budgetsRef.current = next;
    setBudgetsState(next);
  }, []);

  const writeCategories = useCallback(
    (update: (current: CategoryDefinition[]) => CategoryDefinition[]) => {
      const next = update(categoriesRef.current);
      categoriesRef.current = next;
      setCategoriesState(next);
    },
    [],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 迁移失败时盘里那份读得出来的原始状态比内存里的安全状态更有价值：一旦落盘就找不回来了。
  // 所以记下那份被降级替换掉的状态，直到用户真的改动了某一部分（引用换了、或主题换了）才恢复落盘。
  // 用「状态还是不是加载时那一份」判断，而不是「第几次执行」，StrictMode 重复挂载也不会提前写盘。
  const rawPreservedRef = useRef<LedgerState | null>(initial.degraded ? initial.state : null);

  // 单一写入点：任何状态变化都落盘，失败时如实提示而不是假装保存成功。
  useEffect(() => {
    const preserved = rawPreservedRef.current;
    if (preserved) {
      // 三份状态还是加载时那一组引用，说明用户什么都没改，此时落盘就会覆盖唯一一份原始数据。
      const untouched =
        preserved.records === records &&
        preserved.budgets === budgets &&
        preserved.theme === theme &&
        preserved.categories === categories;
      if (untouched) return;
      rawPreservedRef.current = null;
    }
    const ok = saveState({ records, budgets, theme, categories });
    // The write result is an external-system outcome, so surface it in the UI.
    setStorageAvailable(ok);
  }, [records, budgets, theme, categories]);

  const year = view.getFullYear();
  const month = view.getMonth();

  const monthRecords = useMemo(() => recordsOfMonth(records, year, month), [records, year, month]);
  const summary = useMemo(() => summarize(monthRecords), [monthRecords]);
  const ring = useMemo(() => expensesByCategory(monthRecords), [monthRecords]);
  const trend = useMemo(
    () => dailyExpenses(monthRecords, year, month),
    [monthRecords, year, month],
  );
  const budget = useMemo(
    () => budgetSummary(monthRecords, budgets, categories),
    [monthRecords, budgets, categories],
  );
  const filterCategoryOptions = useMemo(
    () => categoryOptions(categories, monthRecords),
    [categories, monthRecords],
  );

  const visibleRecords = useMemo(() => {
    const keyword = filters.keyword.trim().toLowerCase();
    return monthRecords
      .filter((record) => {
        if (filters.type !== "all" && record.type !== filters.type) return false;
        if (filters.category !== "all" && record.category !== filters.category) return false;
        if (keyword && !`${record.note} ${record.category}`.toLowerCase().includes(keyword))
          return false;
        return true;
      })
      .sort((a, b) => {
        if (a.date === b.date) return b.createdAt - a.createdAt;
        return a.date < b.date ? 1 : -1;
      });
  }, [monthRecords, filters]);

  const addRecord = useCallback(
    (draft: RecordDraft) => {
      const record: LedgerRecord = {
        id: newId(),
        type: draft.type,
        amount: fromCents(cents(draft.amount)),
        // 分类名是预算与颜色的键，写进状态前就去空格，免得落盘的记录又攒出两个「餐饮」。
        category: draft.category.trim(),
        date: draft.date,
        note: draft.note,
        createdAt: Date.now(),
      };
      writeRecords((current) => [...current, record]);
      setView(startOfMonth(new Date(`${draft.date}T00:00:00`)));
    },
    [writeRecords],
  );

  const updateRecord = useCallback(
    (id: string, draft: RecordDraft) => {
      writeRecords((current) =>
        current.map((record) =>
          record.id === id
            ? {
                ...record,
                ...draft,
                amount: fromCents(cents(draft.amount)),
                category: draft.category.trim(),
              }
            : record,
        ),
      );
      setView(startOfMonth(new Date(`${draft.date}T00:00:00`)));
    },
    [writeRecords],
  );

  const deleteRecord = useCallback(
    (id: string) => {
      writeRecords((current) => current.filter((record) => record.id !== id));
    },
    [writeRecords],
  );

  const setBudget = useCallback(
    (category: string, amount: number) => {
      const name = category.trim();
      writeBudgets((current) => ({ ...current, [name]: fromCents(cents(amount)) }));
    },
    [writeBudgets],
  );

  const clearBudget = useCallback(
    (category: string) => {
      const name = category.trim();
      writeBudgets((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    },
    [writeBudgets],
  );

  const setTheme = useCallback((id: ThemeId) => setThemeState(id), []);

  const resetDemo = useCallback(() => {
    const seeded = demoState(theme);
    writeRecords(() => seeded.records);
    writeBudgets(() => seeded.budgets);
    // 演示数据连分类定义一起回到规范内置项，否则改名、停用的残留会跟着演示账本一起留着。
    writeCategories(() => seeded.categories);
    setFilters(EMPTY_FILTERS);
    setView(startOfMonth(new Date()));
  }, [theme, writeRecords, writeBudgets, writeCategories]);

  const wipeAll = useCallback(() => {
    writeRecords(() => []);
    writeBudgets(() => ({}));
    setFilters(EMPTY_FILTERS);
  }, [writeRecords, writeBudgets]);

  const addCategory = useCallback(
    (type: RecordType, name: string) => {
      const current = categoriesRef.current;
      const created = createCategory(type, name, current);
      if (!created) return false;
      writeCategories(() => [...current, created]);
      return true;
    },
    [writeCategories],
  );

  // 改名与删除都要连带动记录与预算：三份状态一律从 ref 读、再整套写回，
  // 挤在同一 tick 里的预算改动才不会被旧闭包悄悄丢掉。
  const renameCategoryAction = useCallback(
    (id: string, name: string) => {
      const result = renameCategory(
        categoriesRef.current,
        recordsRef.current,
        budgetsRef.current,
        id,
        name,
      );
      if (!result) return false;
      writeCategories(() => result.categories);
      writeRecords(() => result.records);
      writeBudgets(() => result.budgets);
      return true;
    },
    [writeCategories, writeRecords, writeBudgets],
  );

  const toggleCategoryAction = useCallback(
    (id: string) => {
      const current = categoriesRef.current;
      const next = toggleCategory(current, id);
      // toggleCategory 原样返回表示「最后一个启用分类不能再停用」，把结论告诉调用方。
      if (next === current) return false;
      writeCategories(() => next);
      return true;
    },
    [writeCategories],
  );

  /** 删除成功返回 null；失败返回原因，界面据此给出对应的可读提示。 */
  const deleteCategoryAction = useCallback(
    (id: string): DeleteCategoryFailure | null => {
      const result = deleteUnusedCategory(
        categoriesRef.current,
        recordsRef.current,
        budgetsRef.current,
        id,
      );
      if (!result) {
        // 没改成任何东西：把原因原样交出去，界面才能区分「还在用」和「删完类型就空了」。
        return (
          deleteCategoryFailure(categoriesRef.current, recordsRef.current, id) ?? "not-removable"
        );
      }
      writeCategories(() => result.categories);
      writeBudgets(() => result.budgets);
      return null;
    },
    [writeCategories, writeBudgets],
  );

  const monthCount = monthRecords.length;
  const isCurrentMonth = useMemo(() => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() === month;
  }, [year, month]);

  return {
    records,
    budgets,
    theme,
    categories,
    view,
    year,
    month,
    isCurrentMonth,
    storageAvailable,
    // 迁移没能完成、页面正在用退回的安全视图：设置里如实说明现状，落盘时机由上面的 rawPreservedRef 把关。
    degraded: initial.degraded,
    filters,
    monthRecords,
    monthCount,
    visibleRecords,
    summary,
    ring,
    trend,
    budget,
    filterCategoryOptions,
    setView,
    goPrevMonth: () => setView((current) => shiftMonth(current, -1)),
    goNextMonth: () => setView((current) => shiftMonth(current, 1)),
    goCurrentMonth: () => setView(startOfMonth(new Date())),
    setFilters,
    resetFilters: () => setFilters(EMPTY_FILTERS),
    addRecord,
    updateRecord,
    deleteRecord,
    setBudget,
    clearBudget,
    addCategory,
    renameCategoryAction,
    toggleCategoryAction,
    deleteCategoryAction,
    setTheme,
    resetDemo,
    wipeAll,
    recordById: (id: string) => records.find((record) => isValidRecord(record) && record.id === id),
  };
}

export type LedgerApi = ReturnType<typeof useLedger>;
