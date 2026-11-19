import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CircleAlertIcon } from "lucide-react";
import { categoriesFor, cents, fromCents, money } from "@/src/lib/ledger";
import type { LedgerApi } from "@/src/hooks/use-ledger";

interface Props {
  ledger: LedgerApi;
  onClearBudget: (category: string) => void;
}

export function BudgetSection({ ledger, onClearBudget }: Props) {
  // 预算只能挂在启用中的支出分类上：自定义分类进候选，停用的分类要跟着出去。
  const options = categoriesFor("expense", ledger.categories);
  const [picked, setPicked] = useState("");
  const category = options.includes(picked) ? picked : options[0];
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!category) {
      setError("请先在「分类管理」里启用至少一个支出分类。");
      return;
    }
    const raw = amount.replace(/[，,\s¥]/g, "");
    const value = Number(raw);
    if (raw === "" || Number.isNaN(value) || value < 0) {
      setError("请输入不小于 0 的预算金额");
      return;
    }
    if (value > 999999) {
      setError("预算金额请不超过 ¥999,999");
      return;
    }
    setError("");
    ledger.setBudget(category, fromCents(cents(value)));
    setAmount("");
  }

  return (
    <section id="budget" className="scroll-mt-20">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">分类预算</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          为每个支出分类设置每月预算，超出时这里和本月概览都会提示。
        </p>
      </div>

      {ledger.budget.rows.length === 0 ? (
        <p className="mb-3 rounded-xl border border-dashed border-input bg-surface-soft px-4 py-6 text-center text-[13px] text-muted-foreground">
          还没有设置任何分类预算，用下面的表单添加第一个。
        </p>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ledger.budget.rows.map((row) => (
            <Card
              key={row.category}
              className={["gap-2 p-4 shadow-sm", row.over ? "border-destructive" : ""].join(" ")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{row.category}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {money(row.spent)} / {money(row.budget)}
                </p>
              </div>
              <Progress
                value={Math.min(100, row.pct)}
                aria-label={`${row.category} 预算使用 ${Math.round(row.pct)}%`}
                className={[
                  "h-2 bg-muted",
                  row.over
                    ? "[&>[data-slot=progress-indicator]]:bg-destructive"
                    : row.near
                      ? "[&>[data-slot=progress-indicator]]:bg-warning"
                      : "[&>[data-slot=progress-indicator]]:bg-primary",
                ].join(" ")}
              />
              <p
                className={[
                  "text-xs tabular-nums",
                  row.over ? "font-medium text-negative" : "text-muted-foreground",
                ].join(" ")}
              >
                {row.over
                  ? `已超支 ${money(row.spent - row.budget)}`
                  : `剩余 ${money(row.remaining)} · 已用 ${Math.round(row.pct)}%`}
              </p>
            </Card>
          ))}
        </div>
      )}

      <form
        onSubmit={submit}
        noValidate
        className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto] lg:items-end"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="budget-category">分类</Label>
          <Select value={category} onValueChange={setPicked}>
            <SelectTrigger id="budget-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="budget-amount">每月预算（元）</Label>
          <Input
            id="budget-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="例如 1500"
            value={amount}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">保存预算</Button>
          <Button type="button" variant="outline" onClick={() => onClearBudget(category)}>
            取消该分类预算
          </Button>
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-center gap-1.5 text-[13px] text-negative sm:col-span-2 lg:col-span-3"
          >
            <CircleAlertIcon className="size-4" aria-hidden="true" />
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
