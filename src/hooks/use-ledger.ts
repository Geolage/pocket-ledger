import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Budgets,
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
import { demoState, loadState, saveState } from "@/src/lib/storage";

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
  const [records, setRecords] = useState<LedgerRecord[]>(initial.state.records);
  const [budgets, setBudgets] = useState<Budgets>(initial.state.budgets);
  const [theme, setThemeState] = useState<ThemeId>(initial.state.theme);
  const [storageAvailable, setStorageAvailable] = useState(initial.available);
  const [view, setView] = useState(() => startOfMonth(new Date()));
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 单一写入点：任何状态变化都落盘，失败时如实提示而不是假装保存成功。
  useEffect(() => {
    const ok = saveState({ records, budgets, theme });
    // The write result is an external-system outcome, so surface it in the UI.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStorageAvailable(ok);
  }, [records, budgets, theme]);

  const year = view.getFullYear();
  const month = view.getMonth();

  const monthRecords = useMemo(() => recordsOfMonth(records, year, month), [records, year, month]);
  const summary = useMemo(() => summarize(monthRecords), [monthRecords]);
  const ring = useMemo(() => expensesByCategory(monthRecords), [monthRecords]);
  const trend = useMemo(
    () => dailyExpenses(monthRecords, year, month),
    [monthRecords, year, month],
  );
  const budget = useMemo(() => budgetSummary(monthRecords, budgets), [monthRecords, budgets]);

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

  const addRecord = useCallback((draft: RecordDraft) => {
    const record: LedgerRecord = {
      id: newId(),
      type: draft.type,
      amount: fromCents(cents(draft.amount)),
      category: draft.category,
      date: draft.date,
      note: draft.note,
      createdAt: Date.now(),
    };
    setRecords((current) => [...current, record]);
    setView(startOfMonth(new Date(`${draft.date}T00:00:00`)));
  }, []);

  const updateRecord = useCallback((id: string, draft: RecordDraft) => {
    setRecords((current) =>
      current.map((record) =>
        record.id === id ? { ...record, ...draft, amount: fromCents(cents(draft.amount)) } : record,
      ),
    );
    setView(startOfMonth(new Date(`${draft.date}T00:00:00`)));
  }, []);

  const deleteRecord = useCallback((id: string) => {
    setRecords((current) => current.filter((record) => record.id !== id));
  }, []);

  const setBudget = useCallback((category: string, amount: number) => {
    setBudgets((current) => ({ ...current, [category]: fromCents(cents(amount)) }));
  }, []);

  const clearBudget = useCallback((category: string) => {
    setBudgets((current) => {
      const next = { ...current };
      delete next[category];
      return next;
    });
  }, []);

  const setTheme = useCallback((id: ThemeId) => setThemeState(id), []);

  const resetDemo = useCallback(() => {
    const seeded = demoState(theme);
    setRecords(seeded.records);
    setBudgets(seeded.budgets);
    setFilters(EMPTY_FILTERS);
    setView(startOfMonth(new Date()));
  }, [theme]);

  const wipeAll = useCallback(() => {
    setRecords([]);
    setBudgets({});
    setFilters(EMPTY_FILTERS);
  }, []);

  const monthCount = monthRecords.length;
  const isCurrentMonth = useMemo(() => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() === month;
  }, [year, month]);

  return {
    records,
    budgets,
    theme,
    view,
    year,
    month,
    isCurrentMonth,
    storageAvailable,
    filters,
    monthRecords,
    monthCount,
    visibleRecords,
    summary,
    ring,
    trend,
    budget,
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
    setTheme,
    resetDemo,
    wipeAll,
    recordById: (id: string) => records.find((record) => isValidRecord(record) && record.id === id),
  };
}

export type LedgerApi = ReturnType<typeof useLedger>;
