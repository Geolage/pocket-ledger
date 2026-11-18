import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { money } from "@/src/lib/ledger";
import type { LedgerApi } from "@/src/hooks/use-ledger";

interface Props {
  ledger: LedgerApi;
}

export function SummaryCards({ ledger }: Props) {
  const { summary, budget } = ledger;
  const hasBudget = budget.rows.length > 0;

  const cards = [
    {
      label: "本月收入",
      value: money(summary.income),
      foot: `${summary.incomeCount} 笔入账`,
      tone: "text-positive",
    },
    {
      label: "本月支出",
      value: money(summary.expense),
      foot: `${summary.expenseCount} 笔支出`,
      tone: "text-foreground",
    },
    {
      label: "本月结余",
      value: money(summary.balance),
      foot: summary.balance < 0 ? "本月支出超过收入" : "收入减支出",
      tone: summary.balance < 0 ? "text-negative" : "text-foreground",
    },
    {
      label: "预算剩余",
      value: hasBudget ? money(budget.remaining) : "—",
      foot: hasBudget
        ? budget.overCount > 0
          ? `${budget.overCount} 个分类已超支`
          : `总预算 ${money(budget.totalBudget)}`
        : "未设置分类预算",
      tone: hasBudget && budget.remaining < 0 ? "text-negative" : "text-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="gap-1 p-4 shadow-sm">
          <p className="text-[13px] font-medium text-muted-foreground">{card.label}</p>
          <p className={cn("mt-1 text-[26px] leading-tight font-semibold tracking-tight tabular-nums", card.tone)}>
            {card.value}
          </p>
          <p className="text-xs text-faint tabular-nums">{card.foot}</p>
        </Card>
      ))}
    </div>
  );
}
