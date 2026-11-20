import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
  removeRecordById,
  shiftMonth,
  startOfMonth,
  summarize,
} from "@/src/lib/ledger";
import { type ThemeId, applyTheme } from "@/src/lib/themes";
import {
  type LedgerState,
  demoState,
  ledgerStatesEqual,
  loadState,
  saveState,
} from "@/src/lib/storage";

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

/**
 * 撤销一步要还原的东西，比落盘的那三份多：筛选条件与正在看的月份同样是用户看得见的位置。
 * 删除分类会把筛选打回「全部分类」，恢复演示会把月份跳回本月、筛选清空——只还原数据就等于
 * 悄悄换掉用户正在看的这一屏，所以快照把六份状态一起记下来。
 */
interface UndoSnapshot extends LedgerSnapshot {
  theme: ThemeId;
  filters: Filters;
  view: Date;
}

/**
 * 撤销一次改动：把改动前的整套状态写回去，还原成功返回 true。
 * 只有一步可撤，而且只认最近那次成功的改动——之后的任何一次改动（哪怕它自己没留下撤销）
 * 都会把这里这一步作废，返回 false，不会把账本倒回更远的快照。
 */
export type UndoAction = () => boolean;

/** 删除分类的结论：成功给出撤销动作，失败保留领域层给出的原因，两种情况界面要说的是两句话。 */
export type CategoryDeleteResult =
  { ok: true; undo: UndoAction } | { ok: false; failure: DeleteCategoryFailure };

/**
 * 提示只占一个位置：后一条顶掉前一条，屏幕上因此永远最多只有一个「撤销」按钮，
 * 点到的必然是还作数的那一步。多条提示叠着放的话，压在下面那颗按钮既看不见也点不动。
 */
export const LEDGER_TOAST_ID = "ledger-toast";

/**
 * 撤销只在提示还看得见的那段时间里用得上：默认的 4 秒来不及让人读完再决定，
 * 所以挂着「撤销」的那条单独停留 10 秒。确认框里的说明也照这个数写，两处必须是同一件事。
 */
export const UNDO_TOAST_DURATION_MS = 10_000;

/** 撤销窗口以秒为单位说法一致：界面文案直接由它算出来，免得话和实现对不上。 */
export const UNDO_WINDOW_SECONDS = UNDO_TOAST_DURATION_MS / 1000;

/** 点下去却没还回任何东西时要说清原因：静默失败的按钮会让人以为还要再点两下。 */
const UNDO_STALE_MESSAGE = "这一步已经无法撤销，后续改动已经接管了它。";

/**
 * 按下「撤销」：还回来了就把提示收起，已经过期了就换成一句失败说明。
 * 两种情况都不留那颗点不动的按钮。
 */
function runUndo(undo: UndoAction, event?: { preventDefault(): void }): void {
  if (undo()) {
    toast.dismiss(LEDGER_TOAST_ID);
    return;
  }
  // preventDefault 是与 sonner 的约定：按钮默认会在回调结束后收起提示，
  // 这里要的恰恰是把这条失败说明留在屏幕上。
  event?.preventDefault();
  toast.error(UNDO_STALE_MESSAGE, {
    id: LEDGER_TOAST_ID,
    // 同 id 的提示按字段合并：这两个键要显式清掉，否则过期提示会继承上一条的按钮和 10 秒时长。
    action: undefined,
    duration: undefined,
  });
}

/**
 * 改动结果的统一提示：拿到撤销动作才挂「撤销」按钮，并给足点到它的时间。
 * 被领域层拒掉、或者压根没改成的操作返回 null，那种时候挂一个点了没反应的按钮比不挂更糟。
 *
 * action 与 duration 要显式写成 undefined：同 id 的提示是按字段合并的，省掉这些键就会把
 * 上一步的「撤销」按钮和它的 10 秒时长原样留在新的那句话上。
 */
export function notifyChange(message: string, undo: UndoAction | null = null): void {
  toast(message, {
    id: LEDGER_TOAST_ID,
    duration: undo ? UNDO_TOAST_DURATION_MS : undefined,
    action: undo ? { label: "撤销", onClick: (event) => runUndo(undo, event) } : undefined,
  });
}

const EMPTY_FILTERS: Filters = { type: "all", category: "all", keyword: "" };

/** 与 React 的 setter 同形：既收新值，也收「拿当下最新值算下一个值」的函数。 */
type Updater<T> = T | ((current: T) => T);

/** 筛选是否就是「没筛」：条件对象每次都是新引用，所以只能按字段比。 */
function isDefaultFilters(filters: Filters): boolean {
  return (
    filters.type === EMPTY_FILTERS.type &&
    filters.category === EMPTY_FILTERS.category &&
    filters.keyword === EMPTY_FILTERS.keyword
  );
}

/** 月份视图是否停在当月：Date 同样是新对象，比年月而不比引用。 */
function isCurrentMonthView(view: Date): boolean {
  const now = new Date();
  return view.getFullYear() === now.getFullYear() && view.getMonth() === now.getMonth();
}

export function useLedger() {
  const [initial] = useState(() => loadState());
  const [records, setRecordsState] = useState<LedgerRecord[]>(initial.state.records);
  const [budgets, setBudgetsState] = useState<Budgets>(initial.state.budgets);
  const [theme, setThemeState] = useState<ThemeId>(initial.state.theme);
  const [categories, setCategoriesState] = useState<CategoryDefinition[]>(initial.state.categories);
  const [storageAvailable, setStorageAvailable] = useState(initial.available);
  const [view, setViewState] = useState(() => startOfMonth(new Date()));
  const [filters, setFiltersState] = useState<Filters>(EMPTY_FILTERS);

  // 六份状态的所有写入都走下面的 write*：ref 存最新意图，同一 tick 里连着改
  // 不会拿旧闭包的值覆盖掉前一次的结果（分类改名就会同时动那三份持久化状态）。
  // 前提是没有别的写入路径：state setter 一律不外泄。
  // 撤销快照同样只读 ref：一次改动要记的是「按下按钮那一刻」的状态，不是某个旧渲染里的闭包值。
  const recordsRef = useRef(records);
  const budgetsRef = useRef(budgets);
  const categoriesRef = useRef(categories);
  const themeRef = useRef(theme);
  const filtersRef = useRef(filters);
  const viewRef = useRef(view);

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

  // 只撤一步：这里存的就是「最近一次成功的破坏性改动」，后来的改动会把它整个换掉，
  // 所以不需要历史栈，也不需要把每一步的快照留着。
  const undoRef = useRef<UndoAction | null>(null);

  /**
   * 上一步撤销作废的唯一入口：所有 write* 在值真的换了时都会经过这里。
   * 「撤销」按钮只有在提示还看得见时才点得到，所以作废的同时要把那条提示收掉——
   * 留着一条只会报错的按钮，比用户压根不知道已经错过了更容易伤人。
   * 本来就没有待撤的改动时什么都不做，免得把别处来的普通提示一起误删。
   */
  const invalidateUndo = useCallback(() => {
    if (undoRef.current === null) return;
    undoRef.current = null;
    toast.dismiss(LEDGER_TOAST_ID);
  }, []);

  /**
   * 三份写入共用的规矩：updater 收到当下最新的那一份，值换了才算一次真正的改动。
   * 领域层把改动拒掉时 updater 原样返回（重名的新增、停用最后一个启用分类），
   * 那种情况下既不该重渲染，更不该放行降级状态——一笔没成立的改动没有资格覆盖盘里的原始数据。
   * 值换了的同时也要把上一步的撤销作废：撤销只承诺还原「最近那次改动」，
   * 账本已经走远还留着按钮，等于允许用户把中间那几步一起抹掉。
   */
  const writeRecords = useCallback(
    (update: (current: LedgerRecord[]) => LedgerRecord[]) => {
      const next = update(recordsRef.current);
      if (next !== recordsRef.current) {
        releaseRawState();
        invalidateUndo();
      }
      recordsRef.current = next;
      setRecordsState(next);
      return next;
    },
    [releaseRawState, invalidateUndo],
  );

  const writeBudgets = useCallback(
    (update: (current: Budgets) => Budgets) => {
      const next = update(budgetsRef.current);
      if (next !== budgetsRef.current) {
        releaseRawState();
        invalidateUndo();
      }
      budgetsRef.current = next;
      setBudgetsState(next);
      return next;
    },
    [releaseRawState, invalidateUndo],
  );

  const writeCategories = useCallback(
    (update: (current: CategoryDefinition[]) => CategoryDefinition[]) => {
      const next = update(categoriesRef.current);
      if (next !== categoriesRef.current) {
        releaseRawState();
        invalidateUndo();
      }
      categoriesRef.current = next;
      setCategoriesState(next);
      return next;
    },
    [releaseRawState, invalidateUndo],
  );

  /** 主题落在 localStorage 里，与那三份数据同等待遇：换了才算一次真正的改动，也才作废上一步撤销。 */
  const writeTheme = useCallback(
    (next: ThemeId) => {
      if (next === themeRef.current) return;
      releaseRawState();
      invalidateUndo();
      themeRef.current = next;
      setThemeState(next);
    },
    [releaseRawState, invalidateUndo],
  );

  // 筛选与月份只决定这一屏看什么，不落盘，所以它们不放行降级状态；
  // 但它们同样是用户看得见的位置，动了上一步的撤销就跟着过期——撤销要还的是「按下按钮那一刻」的那一屏。
  // 留 ref 是因为撤销快照要当场读到用户当下选着的条件与月份。
  const writeFilters = useCallback(
    (update: Updater<Filters>) => {
      const next = typeof update === "function" ? update(filtersRef.current) : update;
      if (next !== filtersRef.current) invalidateUndo();
      filtersRef.current = next;
      setFiltersState(next);
    },
    [invalidateUndo],
  );

  const writeView = useCallback(
    (update: Updater<Date>) => {
      const next = typeof update === "function" ? update(viewRef.current) : update;
      if (next !== viewRef.current) invalidateUndo();
      viewRef.current = next;
      setViewState(next);
    },
    [invalidateUndo],
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

  /** 当场从六份 ref 读出一份快照：记的是最新意图，而不是某个旧闭包里的副本。 */
  const takeSnapshot = useCallback(
    (): UndoSnapshot => ({
      records: recordsRef.current,
      budgets: budgetsRef.current,
      categories: categoriesRef.current,
      theme: themeRef.current,
      filters: filtersRef.current,
      view: viewRef.current,
    }),
    [],
  );

  /**
   * 整套写回走的是与改动同一批 writer，所以撤销之后落盘、降级提示、各项统计都跟着一起回来，
   * 不需要再为撤销单开一条路径。引用没变的那一份撞上同一个引用，React 直接跳过重渲染。
   */
  const restoreSnapshot = useCallback(
    (snapshot: UndoSnapshot) => {
      commitSnapshot(snapshot);
      writeTheme(snapshot.theme);
      writeFilters(snapshot.filters);
      writeView(snapshot.view);
      return true;
    },
    [commitSnapshot, writeTheme, writeFilters, writeView],
  );

  /**
   * 只有改动真的成功才建撤销动作：把快照封进闭包，并登记成当前这一步。
   * 引用比对就是「还是不是最近那次改动」——被后续改动接管过的旧按钮点下去只如实返回 false。
   *
   * 调用时机有讲究：必须放在自己那批 write* 之后。writer 在值真的换了时会先把这一步缴械，
   * 先登记再写入就会把自己刚记下的快照当场作废，按钮也就永远点不动了。
   */
  const armUndo = useCallback(
    (snapshot: UndoSnapshot): UndoAction => {
      const undo: UndoAction = () => {
        if (undoRef.current !== undo) return false;
        undoRef.current = null;
        return restoreSnapshot(snapshot);
      };
      undoRef.current = undo;
      return undo;
    },
    [restoreSnapshot],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 单一写入点：任何状态变化都落盘，失败时如实提示而不是假装保存成功。
  // rawPreservedRef 只由 write*（值真的换了的时候）与 writeTheme 清空，所以它还非空就说明
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
      writeView(startOfMonth(new Date(`${draft.date}T00:00:00`)));
    },
    [writeRecords, writeView],
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
      writeView(startOfMonth(new Date(`${draft.date}T00:00:00`)));
    },
    [writeRecords, writeView],
  );

  /**
   * 删除记录是破坏性改动：动手前记下整套快照，真的删掉至少一条才给出撤销动作。
   * id 已经不在列表里（比如同一笔被删了两次）就是什么都没动：那种情况返回 null，
   * 上一步的撤销也一并收掉——用户又动了一次手，那颗按钮的故事到此为止。
   */
  const deleteRecord = useCallback(
    (id: string): UndoAction | null => {
      const before = takeSnapshot();
      // 存在与否交给领域层判定：filter 每次都造新数组，比引用分不出「删掉一笔」和「没有这一笔」。
      const next = removeRecordById(before.records, id);
      if (!next) {
        invalidateUndo();
        return null;
      }
      writeRecords(() => next);
      return armUndo(before);
    },
    [takeSnapshot, invalidateUndo, writeRecords, armUndo],
  );

  const setBudget = useCallback(
    (category: string, amount: number) => {
      const name = category.trim();
      writeBudgets((current) => ({ ...current, [name]: fromCents(cents(amount)) }));
    },
    [writeBudgets],
  );

  /** 取消预算也留一步撤销；这个分类本来就没有预算时一笔没动，返回 null。 */
  const clearBudget = useCallback(
    (category: string): UndoAction | null => {
      const name = category.trim();
      const before = takeSnapshot();
      // 先把「没有这条预算」挡在写入之前：预算表每次都造新对象，光比引用分不出改没改。
      if (!Object.hasOwn(before.budgets, name)) {
        invalidateUndo();
        return null;
      }
      writeBudgets((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
      return armUndo(before);
    },
    [takeSnapshot, invalidateUndo, writeBudgets, armUndo],
  );

  /**
   * 恢复演示是整套替换，替换掉东西才留一步撤销。
   * 演示数据每次都重新生成记录 id，所以「换没换」比的是用户看得见的那几项（见 ledgerStatesEqual）；
   * 月份与筛选也在这一步的范围内，停在当月、没筛东西，才算真的没得可换。
   * 只把这一屏复位的那一次不算「没得可换」，但也不能把 `seeded` 整套写回：三份都是当场新建的对象，
   * 而 writer 只认引用，会把这一笔当成真改了数据，于是放行降级状态、把盘里同样的内容重写一遍——
   * 用户只是清了个筛选条件，代价却是丢掉唯一那份原始数据。
   */
  const resetDemo = useCallback((): UndoAction | null => {
    const before = takeSnapshot();
    const seeded = demoState(before.theme);
    // 现场比一次落盘的那四份：已经是演示数据就说明这一步动不到任何要落盘的东西。
    const dataIsAlreadyDemo = ledgerStatesEqual(
      {
        records: before.records,
        budgets: before.budgets,
        theme: before.theme,
        categories: before.categories,
      },
      seeded,
    );
    if (dataIsAlreadyDemo && isDefaultFilters(before.filters) && isCurrentMonthView(before.view)) {
      invalidateUndo();
      return null;
    }
    // 演示数据连分类定义一起回到规范内置项，否则改名、停用的残留会跟着演示账本一起留着。
    // 数据本来就是这套时跳过整份写回：筛选与月份动的是这一屏，不需要盘里跟着重抄一遍。
    if (!dataIsAlreadyDemo) commitSnapshot(seeded);
    writeFilters(EMPTY_FILTERS);
    writeView(startOfMonth(new Date()));
    return armUndo(before);
  }, [takeSnapshot, invalidateUndo, commitSnapshot, writeFilters, writeView, armUndo]);

  /**
   * 清空动的是记录、预算与筛选，所以「本来就什么都没得清」也只由这三样说了算：三项都空 / 默认，
   * 这一步就在任何 writer 之前返回 null。
   * 月份视图不归清空管（快照里记的就是当下那个月，写回等于没动它），所以它不能进这个判断——
   * 停在过去的月份里点清空，记录与预算照样一笔没少，那仍然是一次什么都没改到的点击。
   * 光靠这个判断还不够：账本已经空着、只筛了一个关键词时，清空确实清掉了东西（那个筛选条件），
   * 于是往下走，而 `[]` 与 `{}` 都是新引用，writer 会把这一笔当成真改了数据，照样放行降级状态、
   * 把盘里唯一那份原始数据盖掉。所以两份持久化写入自己让位：没东西可清就原样返回，
   * 「改动到底成没成」交回给引用比对去认——领域层拒掉的那笔既不落盘，也不该落盘。
   * 真的清了东西、或者只是清掉了筛选，都留一步撤销：它按整套快照还回来，
   * 被清空一起抹掉的筛选条件也跟着回到清空之前。
   */
  const wipeAll = useCallback((): UndoAction | null => {
    const before = takeSnapshot();
    if (
      before.records.length === 0 &&
      Object.keys(before.budgets).length === 0 &&
      isDefaultFilters(before.filters)
    ) {
      invalidateUndo();
      return null;
    }
    writeRecords((current) => (current.length === 0 ? current : []));
    writeBudgets((current) => (Object.keys(current).length === 0 ? current : {}));
    writeFilters(EMPTY_FILTERS);
    return armUndo(before);
  }, [takeSnapshot, invalidateUndo, writeRecords, writeBudgets, writeFilters, armUndo]);

  /**
   * 新增成功返回撤销动作，被领域层拒掉返回 null：界面据此决定要不要挂上「撤销」按钮。
   * 被拒掉的那次点击同样动了用户的界面（哪怕什么都没写成），上一步的撤销窗口就此结束——
   * 撤销只认「最近那次改动」，中间隔了一次操作就不该再假装还认。
   */
  const addCategory = useCallback(
    (type: RecordType, name: string): UndoAction | null => {
      const before = takeSnapshot();
      // 查重在 updater 里对着最新列表做：同一 tick 里刚加进来的分类也算数。
      const next = writeCategories((current) => {
        const created = createCategory(type, name, current);
        return created ? [...current, created] : current;
      });
      // createCategory 被拒时 updater 原样返回，引用没变就说明这条分类没加上。
      if (next === before.categories) {
        invalidateUndo();
        return null;
      }
      return armUndo(before);
    },
    [takeSnapshot, invalidateUndo, writeCategories, armUndo],
  );

  // 改名会连带动记录与预算：三份状态一起从快照读、再整套写回，
  // 挤在同一 tick 里的预算改动才不会被旧闭包悄悄丢掉。
  const renameCategoryAction = useCallback(
    (id: string, name: string): UndoAction | null => {
      const before = takeSnapshot();
      const result = renameCategory(before.categories, before.records, before.budgets, id, name);
      if (!result) {
        invalidateUndo();
        return null;
      }
      commitSnapshot(result);
      return armUndo(before);
    },
    [takeSnapshot, invalidateUndo, commitSnapshot, armUndo],
  );

  const toggleCategoryAction = useCallback(
    (id: string): UndoAction | null => {
      const before = takeSnapshot();
      // toggleCategory 原样返回表示「最后一个启用分类不能再停用」，引用不变就是被拒了。
      const next = writeCategories((current) => toggleCategory(current, id));
      if (next === before.categories) {
        invalidateUndo();
        return null;
      }
      return armUndo(before);
    },
    [takeSnapshot, invalidateUndo, writeCategories, armUndo],
  );

  /**
   * 删得掉就给出撤销动作，删不掉就说清为什么删不掉，界面据此区分「还能撤」和「还在用 / 最后一个启用项」。
   * records 原样交回同一个引用，所以这里写回的快照其实只动了分类与预算两份。
   */
  const deleteCategoryAction = useCallback(
    (id: string): CategoryDeleteResult => {
      const before = takeSnapshot();
      const outcome = deleteUnusedCategory(before.categories, before.records, before.budgets, id);
      if (!outcome.ok) {
        invalidateUndo();
        return outcome;
      }
      commitSnapshot(outcome);
      return { ok: true, undo: armUndo(before) };
    },
    [takeSnapshot, invalidateUndo, commitSnapshot, armUndo],
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
    // 视图与筛选对外还是原来那两个名字，实现换成 ref 版的 writer：
    // 撤销快照读的是同一份 ref，写回去才不会撞上「setter 不外泄」这条前提。
    setView: writeView,
    goPrevMonth: () => writeView((current) => shiftMonth(current, -1)),
    goNextMonth: () => writeView((current) => shiftMonth(current, 1)),
    goCurrentMonth: () => writeView(startOfMonth(new Date())),
    setFilters: writeFilters,
    resetFilters: () => writeFilters(EMPTY_FILTERS),
    addRecord,
    updateRecord,
    deleteRecord,
    setBudget,
    clearBudget,
    addCategory,
    renameCategoryAction,
    toggleCategoryAction,
    deleteCategoryAction,
    // 换主题是一次真正的用户改动：放行降级状态、收掉提示都由 writeTheme 负责。
    setTheme: writeTheme,
    resetDemo,
    wipeAll,
    recordById: (id: string) => records.find((record) => isValidRecord(record) && record.id === id),
  };
}

export type LedgerApi = ReturnType<typeof useLedger>;
