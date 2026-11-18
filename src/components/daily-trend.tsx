import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cents, fromCents, money, monthLabel } from "@/src/lib/ledger";
import type { LedgerApi } from "@/src/hooks/use-ledger";

interface Props {
  ledger: LedgerApi;
}

export function DailyTrend({ ledger }: Props) {
  const { trend, year, month, isCurrentMonth } = ledger;
  const total = trend.reduce((sum, day) => sum + cents(day.amount), 0);
  const max = trend.reduce((value, day) => Math.max(value, day.amount), 0);
  const today = new Date();
  const elapsed = isCurrentMonth ? today.getDate() : trend.length;
  const average = elapsed > 0 ? fromCents(Math.round(total / elapsed)) : 0;
  const peak = trend.reduce((best, day) => (day.amount > best.amount ? day : best), trend[0]);

  return (
    <Card className="gap-4 p-4 shadow-sm">
      <CardHeader className="grid-cols-[1fr_auto] gap-1 px-0">
        <div>
          <CardTitle className="text-[15px]">每日支出趋势</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {monthLabel(year, month)} · 共 {trend.length} 天
          </p>
        </div>
        <Badge variant="secondary" className="tabular-nums">
          日均 {money(average)}
        </Badge>
      </CardHeader>

      <CardContent className="px-0">
        <p className="text-xs text-muted-foreground tabular-nums">
          {max > 0 ? (
            <>
              单日最高 <strong className="font-semibold">{money(max)}</strong>（{month + 1} 月{" "}
              {peak.day} 日）
            </>
          ) : (
            "本月尚无支出"
          )}
        </p>

        <div
          className="mt-2.5 flex h-33 items-end gap-0.5 border-b border-border pt-1"
          role="img"
          aria-label={`${monthLabel(year, month)}每日支出柱状图，最高 ${money(max)}`}
        >
          {trend.map((day) => {
            const height = max > 0 ? Math.max(2, Math.round((day.amount / max) * 100)) : 2;
            const isToday = isCurrentMonth && day.day === today.getDate();
            const label = `${month + 1} 月 ${day.day} 日：${money(day.amount)}`;
            const hasValue = day.amount > 0;
            return (
              <div
                key={day.day}
                tabIndex={hasValue ? 0 : -1}
                role={hasValue ? "img" : undefined}
                aria-label={hasValue ? label : undefined}
                title={label}
                className={[
                  "relative min-w-[3px] flex-1 rounded-t-sm outline-none",
                  "hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
                  hasValue ? "bg-primary opacity-90" : "bg-muted",
                  isToday ? "ring-2 ring-ring" : "",
                ].join(" ")}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>

        <div
          aria-hidden="true"
          className="mt-1.5 flex justify-between text-[11px] text-faint tabular-nums"
        >
          <span>{month + 1}/1</span>
          <span>
            {month + 1}/{Math.ceil(trend.length / 2)}
          </span>
          <span>
            {month + 1}/{trend.length}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
