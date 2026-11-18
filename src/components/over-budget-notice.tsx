import { money } from "@/src/lib/ledger";
import type { LedgerApi } from "@/src/hooks/use-ledger";

interface Props {
  ledger: LedgerApi;
}

export function OverBudgetNotice({ ledger }: Props) {
  const { rows, overCount } = ledger.budget;
  if (rows.length === 0 || overCount === 0) return null;

  const details = rows
    .filter((row) => row.over)
    .map((row) => `${row.category} 超出 ${money(row.spent - row.budget)}`)
    .join("；");

  return (
    <div
      role="status"
      className="mt-3 rounded-lg border border-destructive/25 border-l-4 border-l-destructive bg-destructive/8 px-3.5 py-3 text-[13px] text-negative"
    >
      <strong className="font-semibold">{overCount} 个分类已超出预算：</strong> {details}。
    </div>
  );
}
