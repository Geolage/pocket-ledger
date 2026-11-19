import { useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "@/src/components/app-sidebar";
import { AppToolbar } from "@/src/components/app-toolbar";
import { BillsSection } from "@/src/components/bills-section";
import { BudgetSection } from "@/src/components/budget-section";
import { CategoryRing } from "@/src/components/category-ring";
import { ConfirmDialog, type ConfirmRequest } from "@/src/components/confirm-dialog";
import { DailyTrend } from "@/src/components/daily-trend";
import { MobileNav } from "@/src/components/mobile-nav";
import { OverBudgetNotice } from "@/src/components/over-budget-notice";
import { RecordDialog } from "@/src/components/record-dialog";
import { SettingsSection } from "@/src/components/settings-section";
import { SummaryCards } from "@/src/components/summary-cards";
import { useActiveSection } from "@/src/hooks/use-active-section";
import { useLedger, type RecordDraft } from "@/src/hooks/use-ledger";
import { describeRecord, type LedgerRecord, monthLabel } from "@/src/lib/ledger";

export default function App() {
  const ledger = useLedger();
  const [active, setActive] = useActiveSection();
  const [recordDialog, setRecordDialog] = useState<{ open: boolean; record: LedgerRecord | null }>({
    open: false,
    record: null,
  });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const period = monthLabel(ledger.year, ledger.month);

  function saveRecord(draft: RecordDraft) {
    const editing = recordDialog.record;
    if (editing) {
      ledger.updateRecord(editing.id, draft);
      toast("已更新这笔记录");
    } else {
      ledger.addRecord(draft);
      toast(draft.type === "income" ? "已记一笔收入" : "已记一笔支出");
    }
  }

  function askDelete(record: LedgerRecord) {
    setConfirm({
      title: "确认删除？",
      body: describeRecord(record),
      hint: "删除后无法恢复，本月统计会立即重新计算。",
      okLabel: "删除",
      destructive: true,
      onConfirm: () => {
        ledger.deleteRecord(record.id);
        toast("已删除 1 笔记录");
      },
    });
  }

  function askClearBudget(category: string) {
    if (!ledger.budgets[category]) {
      toast(`${category} 还没有设置预算`);
      return;
    }
    setConfirm({
      title: "取消该分类预算？",
      body: `${category} 的每月预算将被移除，本月概览不再统计它。`,
      hint: "账单本身不受影响。",
      okLabel: "取消预算",
      onConfirm: () => {
        ledger.clearBudget(category);
        toast(`${category} 的预算已取消`);
      },
    });
  }

  function askResetDemo() {
    setConfirm({
      title: "恢复演示数据？",
      body: "当前账本会被替换为一套虚构的演示账单，主题设置保留。",
      hint: "演示数据的金额、商户与人物均为虚构。",
      okLabel: "恢复演示",
      destructive: true,
      onConfirm: () => {
        ledger.resetDemo();
        toast("已恢复演示数据");
      },
    });
  }

  function askWipe() {
    setConfirm({
      title: "清空所有数据？",
      body: "将删除本机保存的全部账单与预算，此操作无法恢复。",
      hint: "之后可以用「恢复演示数据」重新载入示例。",
      okLabel: "清空",
      destructive: true,
      onConfirm: () => {
        ledger.wipeAll();
        toast("已清空本机数据");
      },
    });
  }

  return (
    <div className="flex min-h-svh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:border focus:bg-card focus:px-4 focus:py-2 focus:text-sm"
      >
        跳到主要内容
      </a>

      <AppSidebar
        ledger={ledger}
        active={active}
        onNavigate={setActive}
        className="sticky top-0 hidden h-svh w-64 shrink-0 lg:flex"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppToolbar ledger={ledger} onAdd={() => setRecordDialog({ open: true, record: null })} />

        <main id="main" className="flex flex-1 flex-col gap-6 px-4 py-5 lg:px-6">
          <h1 className="sr-only">小账本 Pocket Ledger · 本地个人收支记录</h1>

          <section id="overview" className="scroll-mt-20">
            <div className="mb-4">
              <h2 className="text-xl font-semibold tracking-tight">本月概览</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                统计范围：{period}
                {ledger.isCurrentMonth ? "（进行中）" : ""}
              </p>
            </div>

            <SummaryCards ledger={ledger} />

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
              <CategoryRing ledger={ledger} />
              <DailyTrend ledger={ledger} />
            </div>

            <OverBudgetNotice ledger={ledger} />
          </section>

          <BillsSection
            ledger={ledger}
            onAdd={() => setRecordDialog({ open: true, record: null })}
            onEdit={(record) => setRecordDialog({ open: true, record })}
            onDelete={askDelete}
          />

          <BudgetSection ledger={ledger} onClearBudget={askClearBudget} />

          <SettingsSection ledger={ledger} onResetDemo={askResetDemo} onWipe={askWipe} />

          <footer className="mt-auto border-t border-border pt-4 text-xs text-faint">
            小账本 Pocket Ledger ·
            本地演示账本。所有金额、商户与人物均为虚构数据，仅用于展示界面与交互。
          </footer>
        </main>

        <MobileNav
          active={active}
          onNavigate={setActive}
          onAdd={() => setRecordDialog({ open: true, record: null })}
        />
      </div>

      <RecordDialog
        key={recordDialog.open ? (recordDialog.record?.id ?? "new") : "closed"}
        open={recordDialog.open}
        record={recordDialog.record}
        categories={ledger.categories}
        onOpenChange={(open) => setRecordDialog((current) => ({ ...current, open }))}
        onSave={saveRecord}
      />

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />

      <Toaster theme="light" position="bottom-center" />
    </div>
  );
}
