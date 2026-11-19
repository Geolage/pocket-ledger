import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DeleteCategoryFailure,
  categoryOptions,
  createCategory,
  deleteUnusedCategory,
  renameCategory,
  toggleCategory,
} from "@/src/lib/categories";
import {
  type Budgets,
  type CategoryColorIndex,
  type CategoryDefinition,
  type LedgerRecord,
  type RecordType,
  budgetSummary,
  categoryColorIndex,
  cents,
  dailyExpenses,
  expensesByCategory,
  fromCents,
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

/** 记录、预算、分类三份持久化状态：跨状态的改动要把它们一起算、一起写回。 */
interface LedgerSnapshot {
  records: LedgerRecord[];
  budgets: Budgets;
  categories: CategoryDefinition[];
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

  // 迁移失败时盘里那份读得出来的原始状态比内存里的安全状态更有价值：一旦落盘就找不回来了。
  // 所以记下那份被降级替换掉的状态，直到用户真的改动账本才恢复落盘。
  const rawPreservedRef = useRef<LedgerState | null>(initial.degraded ? initial.state : null);
  // 降级提示与 rawPreservedRef 是同一件事的两面，所以要一起改：原始状态一旦被用户改动覆盖，
  // 「系统不会自动覆盖原始数据」这句话就不成立了，留着只会误导。
  const [degraded, setDegraded] = useState(initial.degraded);

  /**
   * 放行的唯一入口：write* 与换主题都经过这里。
   * 降级状态下第一次真正的改动就把原始状态让位给新内容，同时收掉界面里的降级提示。
   */
  const releaseRawState = useCallback(() => {
    if (rawPreservedRef.current === null) return;
    rawPreservedRef.current = null;
    setDegraded(false);
  }, []);

  /**
   * 三份写入共用的规矩：updater 收到当下最新的那一份，值换了才算一次真正的改动。
   * 领域层把改动拒掉时 updater 原样返回（重名的新增、停用最后一个启用分类），
   * 那种情况下既不该重渲染，更不该放行降级状态——一笔没成立的改动没有资格覆盖盘里的原始数据。
   */
  const writeRecords = useCallback(
    (update: (current: LedgerRecord[]) => LedgerRecord[]) => {
      const next = update(recordsRef.current);
      if (next !== recordsRef.current) releaseRawState();
      recordsRef.current = next;
      setRecordsState(next);
      return next;
    },
    [releaseRawState],
  );

  const writeBudgets = useCallback(
    (update: (current: Budgets) => Budgets) => {
      const next = update(budgetsRef.current);
      if (next !== budgetsRef.current) releaseRawState();
      budgetsRef.current = next;
      setBudgetsState(next);
      return next;
    },
    [releaseRawState],
  );

  const writeCategories = useCallback(
    (update: (current: CategoryDefinition[]) => CategoryDefinition[]) => {
      const next = update(categoriesRef.current);
      if (next !== categoriesRef.current) releaseRawState();
      categoriesRef.current = next;
      setCategoriesState(next);
      return next;
    },
    [releaseRawState],
  );

  /**
   * 一份快照整套写回：跨状态的改动（改名、删除）由领域层一次算出三份结果，
   * 这里只负责把它们分别写进各自的 ref 与状态，谁也不会被旧闭包盖掉。
   * 调用方必须当场从三份 ref 读出输入再交给领域层，这样 `next` 就是「此刻的最新意图」本身，
   * 而不是某个旧闭包里的副本；整套写回也因此不需要再逐份比对旧值。
   * 引用没变的那一份（删除分类时的 records）撞下同一次引用，React 直接跳过重渲染。
   */
  const commitSnapshot = useCallback(
    (next: LedgerSnapshot) => {
      writeRecords(() => next.records);
      writeBudgets(() => next.budgets);
      writeCategories(() => next.categories);
    },
    [writeRecords, writeBudgets, writeCategories],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 单一写入点：任何状态变化都落盘，失败时如实提示而不是假装保存成功。
  // rawPreservedRef 只由 write*（值真的换了的时候）与 setTheme 清空，所以它还非空就说明
  // 用户什么都没改（首次挂载、StrictMode 的第二次挂载、以及被领域层拒掉的操作都算），
  // 这时落盘就会盖掉盘里唯一那份原始数据。
  useEffect(() => {
    if (rawPreservedRef.current !== null) return;
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
  // 账单一笔要取一次颜色，而分类列表现在能一直加：把色表缓成索引，别每笔都扫一遍全表。
  const categoryColors = useMemo<CategoryColorIndex>(
    () => categoryColorIndex(categories),
    [categories],
  );

  // 存着的分类筛选可能指向一个已经不在候选项里的名字（分类刚被改名或删除），
  // 那样筛出来永远是空列表，界面却还显示着旧名字，等于一个看不见也清不掉的隐藏条件。
  // 对外一律以当前候选项为准归一化：显式的 "all" 与仍存在的分类原样保留，其余按 "all" 处理。
  // 存的那份不动，所以名字改回来、或者换个月份又出现时，用户的选择还能接着用。
  const activeFilters = useMemo<Filters>(
    () =>
      filters.category === "all" || filterCategoryOptions.includes(filters.category)
        ? filters
        : { ...filters, category: "all" },
    [filters, filterCategoryOptions],
  );

  const visibleRecords = useMemo(() => {
    const keyword = activeFilters.keyword.trim().toLowerCase();
    return monthRecords
      .filter((record) => {
        if (activeFilters.type !== "all" && record.type !== activeFilters.type) return false;
        if (activeFilters.category !== "all" && record.category !== activeFilters.category)
          return false;
        if (keyword && !`${record.note} ${record.category}`.toLowerCase().includes(keyword))
          return false;
        return true;
      })
      .sort((a, b) => {
        if (a.date === b.date) return b.createdAt - a.createdAt;
        return a.date < b.date ? 1 : -1;
      });
  }, [monthRecords, activeFilters]);

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

  const setTheme = useCallback(
    (id: ThemeId) => {
      // 换主题同样是一次用户改动：原始状态到这儿就可以被覆盖，降级提示也一并收掉。
      releaseRawState();
      setThemeState(id);
    },
    [releaseRawState],
  );

  const resetDemo = useCallback(() => {
    const seeded = demoState(theme);
    // 演示数据连分类定义一起回到规范内置项，否则改名、停用的残留会跟着演示账本一起留着。
    commitSnapshot(seeded);
    setFilters(EMPTY_FILTERS);
    setView(startOfMonth(new Date()));
  }, [theme, commitSnapshot]);

  const wipeAll = useCallback(() => {
    writeRecords(() => []);
    writeBudgets(() => ({}));
    setFilters(EMPTY_FILTERS);
  }, [writeRecords, writeBudgets]);

  const addCategory = useCallback(
    (type: RecordType, name: string) => {
      const before = categoriesRef.current;
      // 查重在 updater 里对着最新列表做：同一 tick 里刚加进来的分类也算数。
      const next = writeCategories((current) => {
        const created = createCategory(type, name, current);
        return created ? [...current, created] : current;
      });
      // createCategory 被拒时 updater 原样返回，引用没变就说明这条分类没加上。
      return next !== before;
    },
    [writeCategories],
  );

  // 改名会连带动记录与预算：三份状态一起从 ref 读、再整套写回，
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
      commitSnapshot(result);
      return true;
    },
    [commitSnapshot],
  );

  const toggleCategoryAction = useCallback(
    (id: string) => {
      const before = categoriesRef.current;
      // toggleCategory 原样返回表示「最后一个启用分类不能再停用」，引用不变就是被拒了。
      const next = writeCategories((current) => toggleCategory(current, id));
      return next !== before;
    },
    [writeCategories],
  );

  /**
   * 删除成功返回 null，失败返回领域层给出的原因，界面据此区分「还在用」和「删完类型就空了」。
   * records 原样交回同一个引用，所以这里写回的快照其实只动了分类与预算两份。
   */
  const deleteCategoryAction = useCallback(
    (id: string): DeleteCategoryFailure | null => {
      const outcome = deleteUnusedCategory(
        categoriesRef.current,
        recordsRef.current,
        budgetsRef.current,
        id,
      );
      if (!outcome.ok) return outcome.failure;
      commitSnapshot(outcome);
      return null;
    },
    [commitSnapshot],
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
    // 迁移没能完成、页面正在用退回的安全视图：设置里如实说明现状，落盘时机由 rawPreservedRef 把关。
    degraded,
    filters: activeFilters,
    monthRecords,
    monthCount,
    visibleRecords,
    summary,
    ring,
    trend,
    budget,
    filterCategoryOptions,
    categoryColors,
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
