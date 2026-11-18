import { PieChartIcon, ReceiptTextIcon, SettingsIcon, WalletIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { money } from "@/src/lib/ledger";
import type { LedgerApi } from "@/src/hooks/use-ledger";
import type { SectionId } from "@/src/hooks/use-active-section";

const NAV: Array<{ id: SectionId; label: string; icon: typeof WalletIcon }> = [
  { id: "overview", label: "概览", icon: WalletIcon },
  { id: "bills", label: "账单", icon: ReceiptTextIcon },
  { id: "budget", label: "预算", icon: PieChartIcon },
  { id: "settings", label: "设置", icon: SettingsIcon },
];

interface Props {
  ledger: LedgerApi;
  active: SectionId;
  onNavigate: (id: SectionId) => void;
  className?: string;
}

export function AppSidebar({ ledger, active, onNavigate, className }: Props) {
  return (
    <aside
      className={cn(
        "flex-col gap-5 border-r border-sidebar-border bg-sidebar px-4 py-5",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
        >
          小
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className="flex items-baseline gap-1.5">
            <span className="text-lg leading-none font-semibold tracking-tight">小账本</span>
            <span className="text-[9px] font-medium tracking-[0.16em] text-faint uppercase">
              Pocket Ledger
            </span>
          </span>
          <Badge variant="secondary" className="px-2 py-0.5 text-[11px]">
            演示账本
          </Badge>
        </span>
      </div>

      <nav aria-label="页面区块" className="flex flex-col gap-0.5">
        {NAV.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active === id ? "page" : undefined}
            onClick={() => onNavigate(id)}
            className={cn(
              "flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              active === id && "bg-accent font-medium text-accent-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </a>
        ))}
      </nav>

      <div className="mt-auto rounded-xl border border-border bg-surface-soft p-3.5">
        <p className="text-xs text-muted-foreground">本月结余</p>
        <p className="mt-0.5 text-xl leading-tight font-semibold tabular-nums">
          {money(ledger.summary.balance)}
        </p>
        <p className="mt-0.5 text-xs text-faint tabular-nums">
          {ledger.budget.rows.length > 0
            ? `预算剩余 ${money(ledger.budget.remaining)}`
            : "尚未设置预算"}
        </p>
      </div>

      <p className="text-xs leading-relaxed text-faint">
        账单只保存在这台设备的浏览器里，不连接任何银行账户。
      </p>
    </aside>
  );
}
