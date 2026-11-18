import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { monthLabel } from "@/src/lib/ledger";
import type { LedgerApi } from "@/src/hooks/use-ledger";

interface Props {
  ledger: LedgerApi;
  onAdd: () => void;
}

export function AppToolbar({ ledger, onAdd }: Props) {
  const label = monthLabel(ledger.year, ledger.month);

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:px-6">
      <span className="text-base font-semibold lg:hidden">小账本</span>

      <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="上一个月"
          onClick={ledger.goPrevMonth}
          className="size-8 rounded-full"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <span aria-live="polite" className="min-w-24 text-center text-sm font-medium tabular-nums">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="下一个月"
          onClick={ledger.goNextMonth}
          className="size-8 rounded-full"
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>

      {!ledger.isCurrentMonth && (
        <Button type="button" variant="outline" size="sm" onClick={ledger.goCurrentMonth}>
          回到本月
        </Button>
      )}

      <span className="flex-1" />

      <Button type="button" onClick={onAdd} className="gap-1.5 rounded-full">
        <PlusIcon aria-hidden="true" />
        记一笔
      </Button>
    </header>
  );
}
