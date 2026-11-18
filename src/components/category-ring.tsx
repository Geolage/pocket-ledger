import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { categoryColor, money } from "@/src/lib/ledger";
import type { LedgerApi } from "@/src/hooks/use-ledger";

const RADIUS = 48;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Props {
  ledger: LedgerApi;
}

export function CategoryRing({ ledger }: Props) {
  const { total, slices } = ledger.ring;
  let offset = 0;

  return (
    <Card className="gap-4 p-4 shadow-sm">
      <CardHeader className="grid-cols-[1fr_auto] gap-1 px-0">
        <div>
          <CardTitle className="text-[15px]">消费分类构成</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">按本月支出金额</p>
        </div>
        <CardBadge value={total} />
      </CardHeader>

      <CardContent className="flex flex-col items-center gap-5 px-0 sm:flex-row">
        <div className="relative size-33 shrink-0">
          <svg
            viewBox="0 0 120 120"
            className="block size-full"
            role="img"
            aria-label={describe(slices, total)}
          >
            {slices.length === 0 ? (
              <circle
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                stroke="var(--muted)"
                strokeWidth="18"
              />
            ) : (
              slices.map((slice) => {
                const length = slice.share * CIRCUMFERENCE;
                const dash = `${Math.max(length - 1.5, 0)} ${CIRCUMFERENCE}`;
                const element = (
                  <circle
                    key={slice.category}
                    cx="60"
                    cy="60"
                    r={RADIUS}
                    fill="none"
                    stroke={categoryColor(slice.category)}
                    strokeWidth="18"
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 60 60)"
                  />
                );
                offset += length;
                return element;
              })
            )}
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
            <span className="text-xs text-muted-foreground">共支出</span>
            <strong className="mt-0.5 block text-sm font-semibold tabular-nums">
              {money(total)}
            </strong>
          </div>
        </div>

        {slices.length === 0 ? (
          <p className="text-sm text-muted-foreground">本月还没有支出记录。</p>
        ) : (
          <ul className="flex min-w-0 flex-1 flex-col gap-2">
            {slices.map((slice) => (
              <li
                key={slice.category}
                className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-[13px]"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-sm ring-1 ring-black/5"
                  style={{ background: categoryColor(slice.category) }}
                />
                <span className="truncate text-muted-foreground">{slice.category}</span>
                <span className="font-medium tabular-nums">
                  {money(slice.amount)}
                  <span className="ml-1 text-xs font-normal text-faint">
                    {Math.round(slice.share * 100)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CardBadge({ value }: { value: number }) {
  return (
    <Badge variant="secondary" className="tabular-nums">
      {money(value)}
    </Badge>
  );
}

function describe(slices: { category: string; amount: number }[], total: number): string {
  if (slices.length === 0) return `本月消费分类环形图：暂无支出`;
  return `本月消费分类环形图，共 ${money(total)}：${slices
    .map((slice) => `${slice.category} ${money(slice.amount)}`)
    .join("，")}`;
}
